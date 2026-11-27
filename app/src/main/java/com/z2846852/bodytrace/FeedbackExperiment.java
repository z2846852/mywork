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
    private boolean observing;
    private long last=-1, lastEnd, began;
    FeedbackExperiment(Context c){this.c=c;this.prefs=c.getSharedPreferences(PREF,0);}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,0);}
    static synchronized JSONObject summary(Context c)throws Exception{
        SharedPreferences p=prefs(c);
        return new JSONObject().put("trials",p.getInt("trials",0)).put("observed",p.getInt("observed",0))
            .put("stopped",p.getInt("stopped",0)).put("controls",p.getInt("controls",0))
            .put("controlStopped",p.getInt("controlStopped",0)).put("controlObserved",p.getInt("controlObserved",0))
            .put("soundLimit",p.getInt("soundLimit",100)).put("vibrationLimit",p.getInt("vibrationLimit",100))
            .put("last",new JSONObject(p.getString("last","{}"))).put("excluded",excluded(p))
            .put("channels",channels(p));
    }
    private static JSONObject channels(SharedPreferences p)throws Exception{
        JSONObject out=new JSONObject();for(String k:new String[]{"sound","vib","mix"})out.put(k,new JSONObject().put("observed",p.getInt("observed_"+k,0)).put("stopped",p.getInt("stopped_"+k,0)));return out;
    }
    private static JSONArray excluded(SharedPreferences p){
        JSONArray a=new JSONArray();for(Map.Entry<String,?> e:p.getAll().entrySet())if(e.getKey().startsWith("deny_")&&Boolean.TRUE.equals(e.getValue()))a.put(e.getKey());return a;
    }
    static synchronized void restore(Context c,String key)throws Exception{
        SharedPreferences p=prefs(c);
        if(!key.startsWith("deny_")&&!key.equals("soundLimit")&&!key.equals("vibrationLimit"))throw new IllegalArgumentException("未知限制");
        if(!p.edit().remove(key).commit())throw new IOException("恢复限制失败");
        append(c,new JSONObject().put("kind","restore").put("key",key).put("time_ms",System.currentTimeMillis()));
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
        if("sound".equals(scope)&&e.optBoolean("soundEnabled"))edit.putInt("soundLimit",FeedbackPolicy.lowerLimit(p.getInt("soundLimit",100),e.optInt("volume")));
        else if("vibration".equals(scope)&&e.optBoolean("vibrate"))edit.putInt("vibrationLimit",FeedbackPolicy.lowerLimit(p.getInt("vibrationLimit",100),e.optInt("vibrationAmplitude")));
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
        for(String v:raw.split(","))if(!v.isEmpty()&&!v.equals("__none__")&&!prefs.getBoolean(prefix+v,false)&&(!CueLibrary.validId(v)||CueLibrary.file(c,v).isFile()))out.add(v);
        if(out.isEmpty()&&raw.isEmpty()&&!prefs.getBoolean(prefix+fallback,false))out.add(fallback);
        return out.toArray(new String[0]);
    }
    synchronized void observe(long second,double score,boolean muted,long now)throws Exception{
        boolean gap=last>=0&&second!=last+1;last=second;
        if(!muted){if(score<.15)quiet++;else quiet=0;if(quiet>=10)attempts=0;}
        if(pending==null||!observing)return;
        if(now<lastEnd||muted)return;
        if(gap&&samples>0){finish("incomplete");return;}
        samples++;if(score>=pending.optDouble("threshold",.15))hits++;
        if(samples>=30)finish(FeedbackPolicy.reduced(samples,hits)?"stopped":"continued");
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
                if("stopped".equals(result)){
                    JSONObject old=new JSONObject(prefs.getString("best_"+k,"{}"));
                    int cost=(pending.optBoolean("soundEnabled")?pending.optInt("volume"):0)+(pending.optBoolean("vibrate")?pending.optInt("vibrationAmplitude"):0);
                    int oldCost=(old.optBoolean("soundEnabled")?old.optInt("volume"):0)+(old.optBoolean("vibrate")?old.optInt("vibrationAmplitude"):0);
                    if(old.length()==0||cost<=oldCost)ed.putString("best_"+k,pending.toString());
                }
                // Track separate channels only on pure trials; mixed outcomes cannot be attributed.
                String channel=pending.optBoolean("soundEnabled")&&pending.optBoolean("vibrate")?"mix":pending.optBoolean("soundEnabled")?"sound":"vib";
                ed.putInt("observed_"+channel,prefs.getInt("observed_"+channel,0)+1);
                if("stopped".equals(result))ed.putInt("stopped_"+channel,prefs.getInt("stopped_"+channel,0)+1);}
        }
        if(!ed.commit())throw new IOException("实验统计保存失败");pending=null;observing=false;samples=hits=0;
    }
    synchronized SnoreFeedbackController.Settings choose(SnoreFeedbackController.Settings s,long now,long enabledAt)throws Exception{
        if(began!=enabledAt){began=enabledAt;sessionCues=0;attempts=0;if(pending!=null)finish("incomplete");}
        if(pending!=null){if(now-lastEnd>90000)finish("incomplete");else return null;}
        if(!FeedbackPolicy.canStart(s.soundEnabled,s.vibrate,sessionCues,s.maxCues,now,lastEnd,System.currentTimeMillis()-enabledAt,s.delayMinutes*60000L))return null;
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
            // Sample channel families first, then types; pure sound failure never bans a mixed family.
            ArrayList<JSONObject> family=new ArrayList<>();int familyIndex=trial%3;
            for(JSONObject o:options)if((o.optBoolean("soundEnabled")?o.optBoolean("vibrate")?1:0:2)==familyIndex)family.add(o);
            if(family.isEmpty())family=options;
            JSONObject pick=family.get((trial/3)%family.size());
            if("adaptive".equals(s.mode)&&trial%5!=0){
                double best=-1;for(JSONObject o:options){String k=key(o);int n=prefs.getInt("n_"+k,0);if(n>=3){double v=(prefs.getInt("ok_"+k,0)+1.0)/(n+2);if(v>best){best=v;pick=o;}}}
            }
            x.soundEnabled=pick.optBoolean("soundEnabled");x.vibrate=pick.optBoolean("vibrate");x.sound=pick.optString("sound");x.vibrationPattern=pick.optString("vibrationPattern");
            int step=(trial/3)%3,vstep=(trial/9+step)%3;
            x.volume=FeedbackPolicy.coarse(x.soundMax,step);x.vibrationAmplitude=FeedbackPolicy.coarse(x.vibrationMax,vstep);
            x.vibrationMs=new int[]{200,500,1000}[vstep];x.soundMs=new int[]{300,800,1500}[step];
            x.soundRhythm="single"; // The selected built-in motif already has its own rhythm.
            if(x.soundEnabled&&!CueLibrary.validId(x.sound)&&trial%4==3)x.soundRhythm="triplet";
            if("adaptive".equals(s.mode)&&trial%5!=0){
                JSONObject best=new JSONObject(prefs.getString("best_"+key(pick),"{}"));
                x.volume=best.optInt("volume",x.volume);x.vibrationAmplitude=best.optInt("vibrationAmplitude",x.vibrationAmplitude);
                x.vibrationMs=best.optInt("vibrationMs",x.vibrationMs);x.soundMs=best.optInt("soundMs",x.soundMs);
                x.soundRhythm=best.optString("soundRhythm",x.soundRhythm);
                // Coordinate refinement: alter only one actuator at a time.
                if(trial%5==1){if(x.soundEnabled)x.volume=Math.max(1,x.volume-5);else x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude-5);}
                if(trial%5==2&&x.vibrate)x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude-5);
            }
            // Avoid truncating spoken clips.
            if(CueLibrary.validId(x.sound)){x.soundMs=0;x.soundRhythm="single";}
        }else if("stairs".equals(s.mode)){
            x.volume=Math.max(1,x.volume*(attempts+1)/3);x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude*(attempts+1)/3);
        }
        x.volume=Math.max(1,FeedbackPolicy.cap(x.volume,x.soundMax,100));x.vibrationAmplitude=Math.max(1,FeedbackPolicy.cap(x.vibrationAmplitude,x.vibrationMax,100));
        if(x.soundEnabled&&prefs.getBoolean("deny_sound_"+x.sound,false)||x.vibrate&&prefs.getBoolean("deny_vib_"+x.vibrationPattern,false)||prefs.getBoolean("deny_pair_"+key(x.json()),false))return null;
        return x;
    }
    synchronized boolean begin(SnoreFeedbackController.Settings x,long now,String session)throws Exception{
        if(pending!=null)return false;
        int trial=prefs.getInt("trials",0);boolean control=("control".equals(x.mode)&&java.util.concurrent.ThreadLocalRandom.current().nextInt(3)==0)||("adaptive".equals(x.mode)&&java.util.concurrent.ThreadLocalRandom.current().nextInt(5)==0);
        pending=x.json().put("id",UUID.randomUUID().toString()).put("kind","trial").put("time_ms",System.currentTimeMillis()).put("session_id",session).put("control",control);
        x.trialId=pending.optString("id");samples=hits=0;observing=false;sessionCues++;attempts++;lastEnd=now+6000;
        append(c,pending);
        if(!prefs.edit().putInt("trials",trial+1).putInt("controls",prefs.getInt("controls",0)+(control?1:0)).commit())throw new IOException("实验进度保存失败");
        return control;
    }
    synchronized void started()throws Exception{
        if(pending!=null&&!pending.optBoolean("control")&&!prefs.edit().putString("last",pending.toString()).commit())throw new IOException("最近实验保存失败");
    }
    synchronized void executed(boolean ok)throws Exception{
        if(pending==null)return;
        if(!ok){finish("incomplete");return;}
        lastEnd=android.os.SystemClock.elapsedRealtime()+1500;observing=true;
        if(!pending.optBoolean("control")&&!prefs.edit().putString("last",pending.toString()).commit())throw new IOException("最近实验保存失败");
        append(c,new JSONObject().put("kind","executed").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis()).put("control",pending.optBoolean("control")));
    }
}