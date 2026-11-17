package com.z2846852.bodytrace;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native networking, local encrypted state and offline-first training event queue. */
public final class MainActivity extends Activity {
    private WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SecureStore vault;
    private final GitHubApi github = new GitHubApi();
    private static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);

    @Override @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(13, 17, 23));
        getWindow().setNavigationBarColor(Color.rgb(13, 17, 23));
        vault = new SecureStore(getApplicationContext());
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true); // Only local trusted HTML; network is performed in native Java.
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true; // Never navigate to a remote page with the privileged bridge.
            }
        });
        web.addJavascriptInterface(new Bridge(), "BodyTraceNative");
        setContentView(web);
        try {
            String html = readAsset("index.html");
            web.loadDataWithBaseURL("https://bodytrace.invalid/", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            web.loadData("<h1>本地界面加载失败</h1>", "text/html", "UTF-8");
        }
    }

    private String readAsset(String name) throws Exception {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void reply(JSONObject object) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(
                    "window.bodyTraceReceive && window.bodyTraceReceive(" + object.toString() + ")", null);
        });
    }

    private JSONObject message(String kind) {
        JSONObject j = new JSONObject();
        try { j.put("type", kind); } catch (Exception ignored) { }
        return j;
    }

    private void error(String message) {
        try {
            JSONObject j = message("error");
            j.put("message", message);
            reply(j);
        } catch (Exception ignored) { }
    }

    private void restore() {
        try {
            String token = vault.read("token");
            JSONObject status = message("status");
            status.put("connected", token != null && !token.isEmpty());
            status.put("repo", "z2846852/-");
            reply(status);
            String csv = vault.read("workouts");
            String measurements = vault.read("measurements");
            if (csv != null) {
                JSONObject cached = message("data");
                cached.put("csv", csv);
                cached.put("measurements", measurements == null ? "" : measurements);
                cached.put("cached", true);
                reply(cached);
            }
            int pending = new JSONArray(vault.read("pending") == null ? "[]" : vault.read("pending")).length();
            JSONObject q = message("pending");
            q.put("count", pending);
            reply(q);
            if (token != null && !token.isEmpty()) {
                syncInternal(token);
            }
        } catch (Exception e) {
            error("本机缓存不可读取；可以断开后重新连接。");
        }
    }

    private void syncInternal(String token) {
        try {
            String csv = github.readFile(token, "data/workouts.csv");
            String measurements;
            try { measurements = github.readFile(token, "data/measurements.csv"); }
            catch (Exception ignored) { measurements = ""; }
            vault.write("workouts", csv);
            vault.write("measurements", measurements);
            JSONObject result = message("data");
            result.put("csv", csv);
            result.put("measurements", measurements);
            result.put("cached", false);
            reply(result);
            drainPending(token);
        } catch (Exception e) {
            error("同步失败：" + safeMessage(e));
        }
    }

    private void drainPending(String token) throws Exception {
        String str = vault.read("pending");
        JSONArray pending = new JSONArray(str == null ? "[]" : str);
        while (pending.length() > 0) {
            JSONObject event = pending.getJSONObject(0);
            github.createEvent(token, event);
            JSONArray remaining = new JSONArray();
            for (int i = 1; i < pending.length(); ++i) remaining.put(pending.getJSONObject(i));
            vault.write("pending", remaining.toString());
            pending = remaining;
            JSONObject saved = message("saved");
            saved.put("event", event);
            reply(saved);
        }
        JSONObject result = message("pending");
        result.put("count", 0);
        reply(result);
    }

    private static String safeMessage(Exception e) {
        String s = e.getMessage();
        return s == null ? "未知错误" : s.length() > 140 ? s.substring(0, 140) : s;
    }

    private static JSONObject validatedEvent(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!day.toString().equals(date) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("训练日期不合法");
        }
        String id = input.getString("exercise_id");
        String ex;
        switch (id) {
            case "adductor": case "abductor": case "lateral_raise": case "row":
            case "assisted_pullup": case "smith_bench": case "chest_press":
            case "pec_deck": case "reverse_fly": case "vertical_traction":
                ex = id; break;
            default: throw new IllegalArgumentException("暂不支持该训练动作");
        }
        int reps = input.getInt("reps");
        double kg = input.getDouble("kg");
        if (reps < 1 || reps > 200 || !Double.isFinite(kg) || kg < 0 || kg > 500
                || Math.rint(kg * 10) != kg * 10) {
            throw new IllegalArgumentException("重量须为0–500kg、最多一位小数；次数1–200");
        }
        JSONObject result = new JSONObject();
        result.put("schema_version", 1);
        result.put("id", UUID.randomUUID().toString());
        result.put("date", date);
        result.put("exercise_id", ex);
        result.put("reps", reps);
        result.put(ex.equals("assisted_pullup") ? "assistance_kg" : "load_kg", kg);
        result.put("created_at", OffsetDateTime.now(BEIJING).toString());
        result.put("source", "bodytrace-android");
        return result;
    }

    private final class Bridge {
        @JavascriptInterface public void ready() {
            worker.execute(MainActivity.this::restore);
        }
        @JavascriptInterface public void connect(String rawToken) {
            worker.execute(() -> {
                String token = rawToken == null ? "" : rawToken.trim();
                if (token.length() < 20 || token.length() > 300) {
                    error("请粘贴有效的 GitHub fine-grained token。");
                    return;
                }
                try {
                    String csv = github.readFile(token, "data/workouts.csv");
                    vault.write("token", token);
                    vault.write("workouts", csv);
                    JSONObject status = message("status");
                    status.put("connected", true);
                    status.put("repo", "z2846852/-");
                    reply(status);
                    syncInternal(token);
                } catch (Exception e) {
                    error("连接失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void sync() {
            worker.execute(() -> {
                try {
                    String token = vault.read("token");
                    if (token == null) { error("请先连接 GitHub"); return; }
                    syncInternal(token);
                } catch (Exception e) { error(safeMessage(e)); }
            });
        }
        @JavascriptInterface public void save(String eventJson) {
            worker.execute(() -> {
                try {
                    JSONObject event = validatedEvent(eventJson);
                    String raw = vault.read("pending");
                    JSONArray pending = new JSONArray(raw == null ? "[]" : raw);
                    pending.put(event);
                    vault.write("pending", pending.toString());
                    JSONObject queued = message("queued");
                    queued.put("event", event);
                    queued.put("count", pending.length());
                    reply(queued);
                    String token = vault.read("token");
                    if (token != null) {
                        try { drainPending(token); }
                        catch (Exception e) { error("记录已在手机排队，暂未上传：" + safeMessage(e)); }
                    }
                } catch (Exception e) {
                    error("记录失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void disconnect() {
            worker.execute(() -> {
                vault.clear();
                JSONObject result = message("disconnected");
                reply(result);
            });
        }
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        worker.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("BodyTraceNative");
            web.destroy();
            web = null;
        }
    }
}
