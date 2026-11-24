package com.z2846852.bodytrace;

import android.content.Context;
import android.media.MediaPlayer;
import android.speech.tts.TextToSpeech;
import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Google Translate web audio (unofficial), cached locally, with Android TTS fallback.
 * Only whole example words are accepted; isolated IPA remains in IpaSamplePlayer.
 */
final class ExampleSpeechPlayer {
    private final Context context;
    private final Consumer<String> report;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final File cache;
    private TextToSpeech tts;
    private boolean ttsReady;
    private MediaPlayer player;
    private int generation;
    private long retryAfter;
    private String pendingWord;
    private Locale pendingLocale;
    private boolean closed;

    ExampleSpeechPlayer(Context context, Consumer<String> report) {
        this.context = context.getApplicationContext();
        this.report = report;
        cache = new File(this.context.getCacheDir(), "example_speech");
        cache.mkdirs();
    }

    void speak(String word, Locale locale) {
        if (closed || word == null || word.isEmpty()) return;
        stopPlayback();
        final int request = ++generation;
        final String language = "zh".equals(locale.getLanguage()) ? "zh-CN" : "en";
        final File target = new File(cache, digest(language + ":" + word) + ".mp3");
        if (target.isFile() && target.length() > 100 && play(target, request)) return;
        if (System.currentTimeMillis() < retryAfter) {
            fallback(word, locale, request);
            return;
        }
        report.accept("正在获取 Google 例词发音…");
        network.execute(() -> {
            boolean success = false;
            try {
                if (request != generation || closed) return;
                success = download(word, language, target, request);
            } catch (Exception ignored) { }
            final boolean ready = success;
            main.post(() -> {
                if (request != generation || closed) return;
                if (ready && play(target, request)) return;
                retryAfter = System.currentTimeMillis() + 60_000;
                fallback(word, locale, request);
            });
        });
    }

    private boolean download(String word, String language, File target, int request) {
        String[][] endpoints = {
            {"https://translate.googleapis.com/translate_tts", "gtx"},
            {"https://translate.google.com/translate_tts", "tw-ob"},
            {"https://clients5.google.com/translate_tts", "gtx"}
        };
        for (String[] endpoint : endpoints) {
            if (request != generation || closed) return false;
            HttpURLConnection connection = null;
            File tmp = new File(cache, target.getName() + "." + request + ".tmp");
            try {
                String query = "ie=UTF-8&client=" + endpoint[1] + "&tl=" +
                    URLEncoder.encode(language, "UTF-8") + "&q=" + URLEncoder.encode(word, "UTF-8");
                connection = (HttpURLConnection)new URL(endpoint[0] + "?" + query).openConnection();
                connection.setConnectTimeout(2000);
                connection.setReadTimeout(3000);
                connection.setRequestProperty("User-Agent", "Mozilla/5.0");
                if (connection.getResponseCode() != 200) continue;
                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buffer = new byte[4096];
                    int total = 0, n;
                    while ((n = in.read(buffer)) != -1) {
                        if (request != generation || closed || (total += n) > 512 * 1024)
                            throw new IOException("Cancelled or oversized audio");
                        out.write(buffer, 0, n);
                    }
                }
                if (tmp.length() < 100 || !isMp3(tmp)) continue;
                if (target.exists()) target.delete();
                if (tmp.renameTo(target)) return true;
            } catch (Exception ignored) {
            } finally {
                if (connection != null) connection.disconnect();
                if (tmp.exists()) tmp.delete();
            }
        }
        return false;
    }

    private boolean isMp3(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            int a = in.read(), b = in.read(), c = in.read();
            return (a == 'I' && b == 'D' && c == '3') ||
                (a == 255 && (b & 224) == 224);
        }
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 16; i++) s.append(String.format(Locale.ROOT, "%02x", bytes[i] & 255));
            return s.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private boolean play(File file, int request) {
        try {
            player = new MediaPlayer();
            player.setDataSource(file.getAbsolutePath());
            player.setOnCompletionListener(mp -> {
                if (player == mp) { player.release(); player = null; }
            });
            player.prepare();
            if (request != generation || closed) { stopPlayback(); return false; }
            player.start();
            report.accept("Google 发音：" + pendingLabel(file));
            return true;
        } catch (Exception e) {
            stopPlayback();
            file.delete();
            return false;
        }
    }

    private String pendingLabel(File file) { return "已播放（本地缓存）"; }

    private void fallback(String word, Locale locale, int request) {
        if (request != generation || closed) return;
        pendingWord = word;
        pendingLocale = locale;
        if (ttsReady) { speakPending(request); return; }
        if (tts != null) return;
        report.accept("Google 发音不可用，正在启用系统语音…");
        tts = new TextToSpeech(context, status -> main.post(() -> {
            if (closed || tts == null) return;
            if (status != TextToSpeech.SUCCESS) {
                tts.shutdown(); tts = null;
                report.accept("Google 和系统语音均不可用");
                return;
            }
            ttsReady = true;
            speakPending(generation);
        }));
    }

    private void speakPending(int request) {
        if (closed || request != generation || pendingWord == null || tts == null) return;
        if (tts.setLanguage(pendingLocale) < TextToSpeech.LANG_AVAILABLE) {
            report.accept("系统 TTS 缺少对应语言包");
            return;
        }
        tts.setSpeechRate(0.87f);
        String word = pendingWord;
        pendingWord = null;
        int result = tts.speak(word, TextToSpeech.QUEUE_FLUSH, null, "example_" + request);
        report.accept(result == TextToSpeech.SUCCESS ? "系统语音：" + word : "系统语音播放失败");
    }

    private void stopPlayback() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (tts != null) tts.stop();
    }

    void close() {
        closed = true;
        generation++;
        stopPlayback();
        if (tts != null) { tts.shutdown(); tts = null; }
        network.shutdownNow();
    }
}
