package com.z2846852.bodytrace;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.*;
import java.io.*;
import java.util.*;
/** Native session scheduler. User limits are hard constraints; absence of response is not absence of awakening. */
final class FeedbackExperiment {
    private static final String PREF="sleep_feedback_learning_v1";
    private final Context c;
    private final SharedPreferences prefs;
    private JSONObject pending;
    private int samples, hits, quiet, attempts, sessionCues;
    private long last=-1, lastEnd, began;
    FeedbackExperiment(Context c){this.c=c;this.prefs=c.getSharedPreferences(PREF,0);}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,0);}
    static synchronized JSONObject summary(Context c)throws Exception{
        SharedPreferences p=prefs(c);
        return new JSONObject().put("trials",p.getInt("trials",0)).put("observed",p.getInt("observed",0))
            .put("stopped",p.getInt("stopped",0)).put("controls",p.getInt("controls",0))
            .put("controlStopped",p.getInt("controlStopped",0)).put("controlObserved",p.getInt("controlObserved",0))
            .put("soundLimit",p.getInt("soundLimit",100)).put("vibrationLimit",p.getInt("vibrationLimit",100))
            .put("last",new JSONObject(p.getString("last","{}")));
    }
    private static File journal(Context c){return new File(c.getFilesDir(),"sleep-feedback-experiments.jsonl");}
    static synchronized void append(Context c,JSONObject e)throws Exception{
        try(FileOutputStream out=new FileOutputStream(journal(c),true)){out.write((e.toString()+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));out.getFD().sync();}
    }
    static synchronized String export(Context c)throws Exception{
        File file=journal(c);if(!file.exists())return "";
        if(file.length()>4*1024*1024)throw new IOException("实验日志超过4MB；请分段导出");
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream b=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)b.write(buf,0,n);return b.toString("UTF-8");}
    }
    static synchronized void reject(Context c,String scope)throws Exception{
        SharedPreferences p=prefs(c);JSONObject e=new JSONObject(p.getString("last","{}"));if(e.length()==0)throw new IllegalStateException("没有已执行的实验");
        SharedPreferences.Editor edit=p.edit();
        if("sound".equals(scope)&&e.optBoolean("soundEnabled"))edit.putInt("soundLimit",Math.min(p.getInt("soundLimit",100),Math.max(0,e.optInt("volume")-1)));
        else if("vibration".equals(scope)&&e.optBoolean("vibrate"))edit.putInt("vibrationLimit",Math.min(p.getInt("vibrationLimit",100),Math.max(0,e.optInt("vibrationAmplitude")-1)));
        else if("soundType".equals(scope)&&e.optBoolean("soundEnabled"))edit.putBoolean("deny_sound_"+e.optString("sound"),true);
        else if("vibrationType".equals(scope)&&e.optBoolean("vibrate"))edit.putBoolean("deny_vib_"+e.optString("vibrationPattern"),true);
        else if("mixed".equals(scope))edit.putBoolean("deny_pair_"+key(e),true);
        else if(!"acceptable".equals(scope))throw new IllegalArgumentException("选择与最近实验匹配的反馈类型");
        JSONObject note=new JSONObject().put("kind","human").put("time_ms",System.currentTimeMillis()).put("trial",e.optString("id")).put("scope",scope).put("settings",e);
        append(c,note);if(!edit.commit())throw new IOException("排除规则保存失败");
    }
    static String key(JSONObject e){return (e.optBoolean("soundEnabled")?e.optString("sound"):"off")+"|"+(e.optBoolean("vibrate")?e.optString("vibrationPattern"):"off");}
    private String[] pool(String raw,String fallback,String prefix){
        ArrayList<String> out=new ArrayList<>();
        for(String v:raw.split(","))if(!v.isEmpty()&&!prefs.getBoolean(prefix+v,false)&&(!CueLibrary.validId(v)||CueLibrary.file(c,v).isFile()))out.add(v);
        if(out.isEmpty()&&raw.isEmpty()&&!prefs.getBoolean(prefix+fallback,false))out.add(fallback);
        return out.toArray(new String[0]);
    }
    synchronized void observe(long second,double score,boolean muted,long now)throws Exception{
        boolean gap=last>=0&&second!=last+1;last=second;
        if(!muted){if(score<.15)quiet++;else quiet=0;if(quiet>=10)attempts=0;}
        if(pending==null)return;
        if(now<lastEnd||muted)return;
        if(gap&&samples>0){finish("incomplete");return;}
        samples++;if(score>=pending.optDouble("threshold",.15))hits++;
        if(samples>=30)finish(hits<=3?"stopped":"continued");
    }
    synchronized void close()throws Exception{if(pending!=null)finish("incomplete");}
    private void finish(String result)throws Exception{
        JSONObject e=new JSONObject().put("kind","outcome").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis())
            .put("result",result).put("valid_seconds",samples).put("snore_seconds",hits).put("settings",pending);
        append(c,e);
        boolean control=pending.optBoolean("control");SharedPreferences.Editor ed=prefs.edit();
        if(!"incomplete".equals(result)){
            String observed=control?"controlObserved":"observed",stopped=control?"controlStopped":"stopped";
            ed.putInt(observed,prefs.getInt(observed,0)+1);
            if("stopped".equals(result))ed.putInt(stopped,prefs.getInt(stopped,0)+1);
            if(!control){String k=key(pending);ed.putInt("n_"+k,prefs.getInt("n_"+k,0)+1);
                if("stopped".equals(result))ed.putInt("ok_"+k,prefs.getInt("ok_"+k,0)+1);
                if("stopped".equals(result))ed.putString("best_"+k,pending.toString());}
        }
        if(!ed.commit())throw new IOException("实验统计保存失败");pending=null;samples=hits=0;
    }
    synchronized SnoreFeedbackController.Settings choose(SnoreFeedbackController.Settings s,long now,long enabledAt)throws Exception{
        if(began!=enabledAt){began=enabledAt;sessionCues=0;attempts=0;if(pending!=null)finish("incomplete");}
        if(pending!=null){if(now-lastEnd>90000)finish("incomplete");else return null;}
        if(System.currentTimeMillis()-enabledAt<s.delayMinutes*60000L||sessionCues>=s.maxCues||now-lastEnd<60000||(!s.soundEnabled&&!s.vibrate))return null;
        if(("limited".equals(s.mode)||"stairs".equals(s.mode))&&attempts>=3)return null;
        SnoreFeedbackController.Settings x=SnoreFeedbackController.Settings.parse(s.json().toString());
        x.soundMax=Math.min(x.soundMax,prefs.getInt("soundLimit",100));
        x.vibrationMax=Math.min(x.vibrationMax,prefs.getInt("vibrationLimit",100));
        if(x.soundMax==0)x.soundEnabled=false;if(x.vibrationMax==0)x.vibrate=false;
        if(!x.soundEnabled&&!x.vibrate)return null;
        int trial=prefs.getInt("trials",0);
        if("explore".equals(s.mode)||"adaptive".equals(s.mode)){
            String[] sounds=pool(s.soundPool,s.sound,"deny_sound_"),vibs=pool(s.vibrationPool,s.vibrationPattern,"deny_vib_");
            ArrayList<JSONObject> options=new ArrayList<>();
            for(int channel=0;channel<3;channel++){
                boolean a=channel!=2,b=channel!=0;
                if(a&&!x.soundEnabled||b&&!x.vibrate)continue;
                for(String sound:a?sounds:new String[]{"soft"})for(String vib:b?vibs:new String[]{"triplet"}){
                    JSONObject p=new JSONObject().put("soundEnabled",a).put("vibrate",b).put("sound",sound).put("vibrationPattern",vib);
                    if(!prefs.getBoolean("deny_pair_"+key(p),false))options.add(p);
                }
            }
            if(options.isEmpty())return null;
            JSONObject pick=options.get(trial%options.size());
            if("adaptive".equals(s.mode)&&trial%5!=0){
                double best=-1;for(JSONObject o:options){String k=key(o);int n=prefs.getInt("n_"+k,0);if(n>=3){double v=(prefs.getInt("ok_"+k,0)+1.0)/(n+2);if(v>best){best=v;pick=o;}}}
            }
            x.soundEnabled=pick.optBoolean("soundEnabled");x.vibrate=pick.optBoolean("vibrate");x.sound=pick.optString("sound");x.vibrationPattern=pick.optString("vibrationPattern");
            int step=(trial/options.size())%3;
            x.volume=Math.max(1,x.soundMax*(step+1)/3);x.vibrationAmplitude=Math.max(1,x.vibrationMax*(step+1)/3);
            x.vibrationMs=new int[]{200,500,1000}[step];x.soundMs=new int[]{300,800,1500}[step];
            if("adaptive".equals(s.mode)&&trial%5!=0){
                JSONObject best=new JSONObject(prefs.getString("best_"+key(pick),"{}"));
                x.volume=best.optInt("volume",x.volume);x.vibrationAmplitude=best.optInt("vibrationAmplitude",x.vibrationAmplitude);
                x.vibrationMs=best.optInt("vibrationMs",x.vibrationMs);x.soundMs=best.optInt("soundMs",x.soundMs);
            }
            // Avoid truncating spoken clips.
            if(CueLibrary.validId(x.sound))x.soundMs=0;
        }else if("stairs".equals(s.mode)){
            x.volume=Math.max(1,x.volume*(attempts+1)/3);x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude*(attempts+1)/3);
        }
        x.volume=Math.max(1,Math.min(x.volume,x.soundMax));x.vibrationAmplitude=Math.max(1,Math.min(x.vibrationAmplitude,x.vibrationMax));
        if(x.soundEnabled&&prefs.getBoolean("deny_sound_"+x.sound,false)||x.vibrate&&prefs.getBoolean("deny_vib_"+x.vibrationPattern,false)||prefs.getBoolean("deny_pair_"+key(x.json()),false))return null;
        return x;
    }
    synchronized boolean begin(SnoreFeedbackController.Settings x,long now,String session)throws Exception{
        if(pending!=null)return false;
        int trial=prefs.getInt("trials",0);boolean control="control".equals(x.mode)&&trial%3==0||"adaptive".equals(x.mode)&&trial%5==4;
        pending=x.json().put("id",UUID.randomUUID().toString()).put("kind","trial").put("time_ms",System.currentTimeMillis()).put("session_id",session).put("control",control);
        samples=hits=0;sessionCues++;attempts++;lastEnd=now+6000;
        append(c,pending);
        if(!prefs.edit().putInt("trials",trial+1).putInt("controls",prefs.getInt("controls",0)+(control?1:0)).commit())throw new IOException("实验进度保存失败");
        return control;
    }
    synchronized void executed(boolean ok)throws Exception{
        if(pending==null)return;
        if(!ok){finish("incomplete");return;}
        lastEnd=android.os.SystemClock.elapsedRealtime()+1500;
        if(!pending.optBoolean("control")&&!prefs.edit().putString("last",pending.toString()).commit())throw new IOException("最近实验保存失败");
        append(c,new JSONObject().put("kind","executed").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis()).put("control",pending.optBoolean("control")));
    }
}