package com.z2846852.bodytrace;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Real human IPA samples bundled in the APK; no TTS synthesis or network
 *  access. Some diphthongs have no licensed isolated recording. */
final class IpaSamplePlayer {
    interface Report { void onStatus(String message); }
    private static final Map<String,String> FILES;
    static{
        HashMap<String,String> m=new HashMap<>();
        String[][] files={
            {"iː","ii.mp3"},{"i","ii.mp3"},{"ɪ","i.mp3"},{"ʊ","u.mp3"},
            {"uː","uu.mp3"},{"e","e.mp3"},{"ɛ","e.mp3"},
            {"ə","schwa.mp3"},{"ɜː","er.mp3"},{"ɝ","er.mp3"},
            {"ɔː","oo.mp3"},{"ɔ","oo.mp3"},{"æ","ae.mp3"},{"ʌ","uh.mp3"},
            {"ɑː","aa.mp3"},{"ɑ","aa.mp3"},{"ɒ","o.mp3"},
            {"p","p.mp3"},{"b","b.mp3"},{"t","t.mp3"},{"d","d.mp3"},
            {"k","k.mp3"},{"g","g.mp3"},{"ɡ","g.mp3"},
            {"f","f.mp3"},{"v","v.mp3"},{"θ","th.mp3"},{"ð","dh.mp3"},
            {"s","s.mp3"},{"z","z.mp3"},{"ʃ","sh.mp3"},{"ʒ","zh.mp3"},
            {"tʃ","ch.mp3"},{"dʒ","dj.mp3"},{"m","m.mp3"},{"n","n.mp3"},
            {"ŋ","ng.mp3"},{"l","l.mp3"},{"r","r.mp3"},{"ɹ","r.mp3"},
            {"j","y.mp3"},{"w","w.mp3"},{"h","h.mp3"},
            {"ʂ","retroflex_sh.ogg"},{"ɨ","central_i.ogg"}
        };
        for(String[] f:files)m.put(f[0],f[1]);
        FILES=Collections.unmodifiableMap(m);
    }
    private final Context context;
    private final Report report;
    private final Handler main=new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Runnable fadeTask,repeatTask;
    private int repeats;
    private int fadeGeneration=0;
    private String symbol;

    IpaSamplePlayer(Context context,Report report){
        this.context=context.getApplicationContext();
        this.report=report;
    }

    void stop(){
        ++fadeGeneration;
        if(fadeTask!=null){main.removeCallbacks(fadeTask);fadeTask=null;}
        if(repeatTask!=null){main.removeCallbacks(repeatTask);repeatTask=null;}
        if(player!=null){
            try{player.setOnCompletionListener(null);player.stop();}catch(Exception ignored){}
            try{player.release();}catch(Exception ignored){}
            player=null;
        }
    }

    /** Cached local file only because assets may be ZIP-compressed by aapt. */
    private File localFile(String name)throws Exception{
        File dir=new File(context.getCacheDir(),"ipa_audio");
        if(!dir.isDirectory()&&!dir.mkdirs())
            throw new IllegalStateException("无法创建本机音标音频缓存");
        File audio=new File(dir,name);
        if(audio.length()>500)return audio;
        File staging=new File(dir,name+".tmp");
        try(InputStream in=context.getAssets().open("ipa_audio/"+name);
            FileOutputStream out=new FileOutputStream(staging)){
            byte[] buffer=new byte[8192];int n;
            while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
        }
        if(staging.length()<500||!staging.renameTo(audio)){
            staging.delete();
            throw new IllegalStateException("音标录音缺失或拷贝失败");
        }
        return audio;
    }

    void play(String requested){
        stop();
        symbol=requested;
        String file=FILES.get(requested);
        if(file==null){
            report.onStatus("/"+requested+"/ 暂无授权的独立真人录音；可听对应的完整例词。");
            return;
        }
        try{
            MediaPlayer p=new MediaPlayer();
            player=p;
            p.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            p.setDataSource(localFile(file).getAbsolutePath());
            p.prepare();
            // Slight slowdown is applied to the real sound, never by TTS.
            if(Build.VERSION.SDK_INT>=23)try{
                p.setPlaybackParams(new PlaybackParams().setSpeed(0.90f));
            }catch(Exception ignored){}
            p.setVolume(0f,0f);
            repeats=0;
            p.setOnCompletionListener(media->{
                if(media!=player)return;
                if(++repeats<2){
                    repeatTask=()->{
                        if(media==player)try{startCycle(media);}catch(Exception ex){stop();}
                    };
                    main.postDelayed(repeatTask,170);
                }else stop();
            });
            startCycle(p);
            report.onStatus("正在播放真人录音 /"+requested+"/（柔和音量，重复两遍）");
        }catch(Exception ex){
            stop();
            report.onStatus("无法播放真人音标 /"+requested+"/："+ex.getClass().getSimpleName());
        }
    }

    private void startCycle(MediaPlayer p){
        final int generation=++fadeGeneration;
        p.seekTo(0);
        p.setVolume(0f,0f);
        p.start();
        final long started=android.os.SystemClock.uptimeMillis();
        final long duration=Math.max(250,p.getDuration());
        final float peak=0.52f;
        final long rise=Math.min(100,duration/4);
        final long fall=Math.min(160,duration/4);
        final Runnable[] ticker=new Runnable[1];
        ticker[0]=()->{
            if(player!=p||generation!=fadeGeneration)return;
            long elapsed=android.os.SystemClock.uptimeMillis()-started;
            float fadeIn=Math.min(1f,(float)elapsed/Math.max(1,rise));
            float fadeOut=Math.min(1f,(float)(duration-elapsed)/Math.max(1,fall));
            float volume=peak*Math.max(0f,Math.min(fadeIn,fadeOut));
            p.setVolume(volume,volume);
            if(elapsed<duration)main.postDelayed(ticker[0],30);
        };
        fadeTask=ticker[0];
        main.post(fadeTask);
    }
}
