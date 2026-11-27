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
    private double afterSum;
    private long outcomeRevision;
    synchronized long outcomeRevision(){return outcomeRevision;}
    private String ladderKey="";
    private int ladderLevel,ladderLength;
    private final ArrayDeque<Double> baseline=new ArrayDeque<>();
    private long last=-1, lastEnd, began;
    FeedbackExperiment(Context c){this.c=c;this.prefs=c.getSharedPreferences(PREF,0);}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,0);}
    private static String night(){return java.time.LocalDateTime.now().minusHours(12).toLocalDate().toString();}
    private static int nightCount(SharedPreferences p){return night().equals(p.getString("night",""))?p.getInt("nightCount",0):0;}
    static synchronized JSONObject summary(Context c)throws Exception{
        SharedPreferences p=prefs(c);
        return new JSONObject().put("trials",p.getInt("trials",0)).put("observed",p.getInt("observed",0))
            .put("stopped",p.getInt("stopped",0)).put("controls",p.getInt("controls",0))
            .put("controlStopped",p.getInt("controlStopped",0)).put("controlObserved",p.getInt("controlObserved",0))
            .put("soundLimit",p.getInt("soundLimit",100)).put("vibrationLimit",p.getInt("vibrationLimit",100))
            .put("last",new JSONObject(p.getString("last","{}"))).put("excluded",excluded(p))
            .put("channels",channels(p)).put("nightCount",nightCount(p))
            .put("soundDurationLimit",p.getInt("soundDurationLimit",5000)).put("vibrationDurationLimit",p.getInt("vibrationDurationLimit",2000))
            .put("types",types(p)).put("candidates",candidates(p)).put("vibration_threshold",thresholdSummary(p)).put("self_report",reportStatus(c)).put("recent_trials",dashboardTrials(p));
    }
    // A bounded nightly read model for the live dashboard; JSONL remains the full audit log.
    private static synchronized JSONArray recentTrials(SharedPreferences p)throws Exception{
        if(!night().equals(p.getString("dashboard_night","")))return new JSONArray();
        return new JSONArray(p.getString("dashboard_trials","[]"));
    }
    private static synchronized void rememberTrial(SharedPreferences p,JSONObject settings,String outcome,int valid,int hits)throws Exception{
        JSONArray old=recentTrials(p),rows=new JSONArray();
        String id=settings.optString("id");
        JSONObject row=new JSONObject().put("id",id).put("session_id",settings.optString("session_id"))
            .put("time_ms",settings.optLong("started_ms",settings.optLong("time_ms"))).put("mode",settings.optString("mode"))
            .put("control",settings.optBoolean("control")).put("soundEnabled",settings.optBoolean("soundEnabled"))
            .put("vibrate",settings.optBoolean("vibrate")).put("sound",settings.optString("sound"))
            .put("volume",settings.optInt("volume")).put("direct_gain_percent",settings.optInt("direct_gain_percent")).put("direct_repeats",settings.optInt("direct_repeats",1)).put("vibrationPattern",settings.optString("vibrationPattern"))
            .put("vibrationAmplitude",settings.optInt("vibrationAmplitude")).put("vibrationMs",settings.optInt("vibrationMs"))
            .put("actualVibrationMs",settings.optInt("actualVibrationMs")).put("actualSoundMs",settings.optInt("actualSoundMs"))
            .put("level",settings.optInt("ladder_level",-1)+1).put("result",outcome)
            .put("screen_on",settings.optBoolean("screen_on_during_observation")).put("valid_seconds",valid).put("snore_seconds",hits);
        JSONObject reports=new JSONObject(p.getString("dashboard_reports","{}"));
        if(!night().equals(p.getString("dashboard_night","")))reports=new JSONObject();
        for(int i=0;i<old.length();i++){JSONObject x=old.optJSONObject(i);if(x!=null&&!id.equals(x.optString("id")))rows.put(x);}
        rows.put(row);
        JSONArray bounded=new JSONArray();JSONObject kept=new JSONObject();
        for(int i=Math.max(0,rows.length()-16);i<rows.length();i++){JSONObject x=rows.getJSONObject(i);bounded.put(x);String k=x.optString("id");if(reports.has(k))kept.put(k,reports.get(k));}
        if(!p.edit().putString("dashboard_night",night()).putString("dashboard_trials",bounded.toString()).putString("dashboard_reports",kept.toString()).commit())
            throw new IOException("实验面板记录保存失败");
    }
    private static synchronized JSONArray dashboardTrials(SharedPreferences p)throws Exception{
        JSONArray rows=recentTrials(p);JSONObject reports=new JSONObject(p.getString("dashboard_reports","{}"));
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);JSONObject checks=reports.optJSONObject(row.optString("id"));row.put("reports",checks==null?new JSONObject():checks);}
        return rows;
    }
    private static JSONObject thresholdSummary(SharedPreferences p)throws Exception{
        if(!night().equals(p.getString("vth_night","")))return new JSONObject();
        String[] fields=p.getString("vth_key","").split(":");
        JSONObject result=new JSONObject().put("next_level",p.getInt("vth_level",0)+1).put("length",p.getInt("vth_length",0))
            .put("upper_failures",p.getInt("vth_upper_failures",0)).put("trials",p.getInt("vth_trials",0))
            .put("last",new JSONObject(p.getString("vth_last","{}")));
        if(fields.length==5){
            int[][] ladder=FeedbackPolicy.vibrationLadder(Integer.parseInt(fields[0]),Integer.parseInt(fields[1]),Integer.parseInt(fields[2]));
            JSONArray rows=new JSONArray();
            for(int i=0;i<ladder.length;i++)rows.put(new JSONObject().put("level",i+1).put("amplitude",ladder[i][0]).put("duration_ms",ladder[i][1])
                .put("stopped",p.getInt("vth_ok_"+i,0)).put("continued",p.getInt("vth_no_"+i,0)));
            result.put("levels",rows);
        }
        return result;
    }
    static synchronized JSONObject reportStatus(Context c)throws Exception{
        SharedPreferences p=prefs(c);
        JSONObject last=new JSONObject(p.getString("last","{}"));
        String session=SleepRecorderService.currentSessionId();
        boolean adjustable="direct".equals(last.optString("mode"))&&session.equals(last.optString("session_id"))&&SleepRecorderService.isCurrentDirectTrial(last.optString("id"));
        boolean linked=adjustable||FeedbackPolicy.reportLink(session,last.optString("session_id"),System.currentTimeMillis()-last.optLong("started_ms",last.optLong("time_ms",0)));
        String id=linked?last.optString("id"):"";
        JSONObject saved=new JSONObject(p.getString("self_report_latest","{}"));
        if(!session.equals(saved.optString("session_id"))||!id.equals(saved.optString("trial_id"))||(!linked&&System.currentTimeMillis()-saved.optLong("time_ms",0)>120000))saved=new JSONObject();
        return new JSONObject().put("session_id",session).put("trial_id",id).put("cue",linked?last:new JSONObject()).put("checked",saved).put("gain_adjustable",adjustable);
    }
    static synchronized JSONObject selfReport(Context c,String kind,String expectedTrial)throws Exception{
        if(!Arrays.asList("felt_vibration","heard_snoring","aware_snoring","turned_side","awake_unsure","gain_hold","gain_too_strong").contains(kind))throw new IllegalArgumentException("未知自报项目");
        JSONObject state=reportStatus(c);
        String session=state.optString("session_id"),trial=state.optString("trial_id");
        boolean adjustable=state.optBoolean("gain_adjustable");
        boolean gainAction=kind.equals("gain_hold")||kind.equals("gain_too_strong");
        if(session.isEmpty()&&!adjustable)throw new IllegalStateException("请先开始录音或等待直接反馈");
        if(gainAction&&!adjustable)throw new IllegalStateException("没有可调节的当前反馈，请刷新");
        if(!trial.equals(expectedTrial))throw new IllegalStateException("近期刺激已变化，请刷新后确认");
        JSONObject checked=state.optJSONObject("checked");
        if(checked==null)checked=new JSONObject();
        if(checked.optBoolean(kind))return state;
        long now=System.currentTimeMillis();
        JSONObject event=new JSONObject().put("kind","self_report").put("report",kind).put("session_id",session)
            .put("trial_id",trial).put("linked",!trial.isEmpty()).put("time_ms",now);
        if(!trial.isEmpty())event.put("cue",state.optJSONObject("cue"));
        if(!session.isEmpty())SleepRecorderService.recordSelfReport(c,event);
        append(c,event);
        checked.put("session_id",session).put("trial_id",trial).put("time_ms",now).put(kind,true);
        SharedPreferences p=prefs(c);SharedPreferences.Editor edit=p.edit().putString("self_report_latest",checked.toString());
        if(!trial.isEmpty()&&night().equals(p.getString("dashboard_night",""))){
            JSONObject reports=new JSONObject(p.getString("dashboard_reports","{}"));
            JSONObject checks=reports.optJSONObject(trial);if(checks==null)checks=new JSONObject();
            checks.put(kind,now);reports.put(trial,checks);edit.putString("dashboard_reports",reports.toString());
        }
        if(!edit.commit())throw new IOException("自报状态保存失败");
        int next=-1;
        if(adjustable&&!kind.equals("awake_unsure"))next=SleepRecorderService.reportDirectGain(trial,kind.equals("gain_too_strong"));
        if(next>0){append(c,new JSONObject().put("kind","gain_adjustment").put("trial_id",trial).put("time_ms",now).put("reason",kind).put("next_gain",next));state.put("next_gain",next);}
        return state.put("checked",checked);
    }
    private static JSONObject channels(SharedPreferences p)throws Exception{
        JSONObject out=new JSONObject();for(String k:new String[]{"sound","vib","mix"})out.put(k,new JSONObject().put("observed",p.getInt("observed_"+k,0)).put("stopped",p.getInt("stopped_"+k,0)));return out;
    }
    private static JSONObject types(SharedPreferences p)throws Exception{
        JSONObject out=new JSONObject();
        for(String k:p.getAll().keySet())if(k.startsWith("n_")&&!k.startsWith("n_recipe_")){
            String type=k.substring(2);if(!type.endsWith("|off")&&!type.startsWith("off|"))continue;
            int n=p.getInt(k,0);out.put(type,new JSONObject().put("observed",n).put("stopped",p.getInt("ok_"+type,0)));
        }return out;
    }
    private static JSONArray candidates(SharedPreferences p)throws Exception{
        ArrayList<JSONObject> all=new ArrayList<>();
        for(Map.Entry<String,?> entry:p.getAll().entrySet())if(entry.getKey().startsWith("best_")&&entry.getValue() instanceof String){
            String k=entry.getKey().substring(5);
            try{
                JSONObject x=new JSONObject((String)entry.getValue());
                if(!allowed(p,x))continue;
                int n=p.getInt("n_"+k,0),ok=p.getInt("ok_"+k,0);
                all.add(x.put("observed",n).put("stopped",ok).put("rank",FeedbackPolicy.rank(ok,n,p.getInt("accept_"+k,0))));
            }catch(Exception ignored){}
        }
        all.sort((a,b)->Double.compare(b.optDouble("rank"),a.optDouble("rank")));
        JSONArray out=new JSONArray();for(int i=0;i<Math.min(5,all.size());i++)out.put(all.get(i));return out;
    }
    private static boolean allowed(SharedPreferences p,JSONObject x){
        boolean a=x.optBoolean("soundEnabled"),b=x.optBoolean("vibrate");
        return !(a&&(p.getBoolean("deny_sound_"+x.optString("sound"),false)||p.getBoolean("deny_rhythm_"+x.optString("soundRhythm"),false)||x.optInt("volume")>p.getInt("soundLimit",100)||x.optInt("actualSoundMs")>p.getInt("soundDurationLimit",5000))
            ||b&&(p.getBoolean("deny_vib_"+x.optString("vibrationPattern"),false)||x.optInt("vibrationAmplitude")>p.getInt("vibrationLimit",100)||x.optInt("actualVibrationMs")>p.getInt("vibrationDurationLimit",2000))
            ||p.getBoolean("deny_pair_"+key(x),false));
    }
    private static JSONArray excluded(SharedPreferences p){
        JSONArray a=new JSONArray();for(Map.Entry<String,?> e:p.getAll().entrySet())if(e.getKey().startsWith("deny_")&&Boolean.TRUE.equals(e.getValue()))a.put(e.getKey());return a;
    }
    static synchronized void restore(Context c,String key)throws Exception{
        SharedPreferences p=prefs(c);
        if(!key.startsWith("deny_")&&!key.equals("soundLimit")&&!key.equals("vibrationLimit")&&!key.equals("soundDurationLimit")&&!key.equals("vibrationDurationLimit"))throw new IllegalArgumentException("未知限制");
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
    static synchronized void writeJournal(Context c,OutputStream out)throws Exception{
        File file=journal(c);if(file.isFile())try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}out.flush();
    }
    static synchronized void excludeType(Context c,String kind,String id)throws Exception{
        String prefix;
        if("sound".equals(kind)){prefix="deny_sound_";if(!(CueLibrary.validId(id)||DreamCueSynth.supports(id)||Arrays.asList("soft","low","double","bell").contains(id)))throw new IllegalArgumentException("未知声音");}
        else if("vibration".equals(kind)){prefix="deny_vib_";if(!Arrays.asList("continuous","triplet","rising","falling","shortlong").contains(id)&&!VibrationLibrary.validId(id))throw new IllegalArgumentException("未知震动");}
        else if("rhythm".equals(kind)){prefix="deny_rhythm_";if(!Arrays.asList("single","triplet","rising","falling","shortlong").contains(id))throw new IllegalArgumentException("未知节奏");}
        else throw new IllegalArgumentException("未知刺激类型");
        append(c,new JSONObject().put("kind","exclude").put("time_ms",System.currentTimeMillis()).put("key",prefix+id));
        if(!prefs(c).edit().putBoolean(prefix+id,true).commit())throw new IOException("排除类型失败");
    }
    static synchronized void rejectRecent(Context c)throws Exception{
        JSONObject x=new JSONObject(prefs(c).getString("last","{}"));
        if(System.currentTimeMillis()-x.optLong("time_ms",0)>120000)throw new IllegalStateException("没有最近2分钟的刺激，反馈已停止");
        reject(c,"mixed");
    }
    static synchronized void reject(Context c,String scope)throws Exception{
        SharedPreferences p=prefs(c);JSONObject e=new JSONObject(p.getString("last","{}"));if(e.length()==0)throw new IllegalStateException("没有已执行的实验");
        SharedPreferences.Editor edit=p.edit();
        if("sound".equals(scope)&&e.optBoolean("soundEnabled"))edit.putInt("soundLimit",FeedbackPolicy.lowerLimit(p.getInt("soundLimit",100),e.optInt("volume")));
        else if("vibration".equals(scope)&&e.optBoolean("vibrate"))edit.putInt("vibrationLimit",FeedbackPolicy.lowerLimit(p.getInt("vibrationLimit",100),e.optInt("vibrationAmplitude")));
        else if("soundType".equals(scope)&&e.optBoolean("soundEnabled"))edit.putBoolean("deny_sound_"+e.optString("sound"),true);
        else if("vibrationType".equals(scope)&&e.optBoolean("vibrate"))edit.putBoolean("deny_vib_"+e.optString("vibrationPattern"),true);
        else if("soundRhythm".equals(scope)&&e.optBoolean("soundEnabled"))edit.putBoolean("deny_rhythm_"+e.optString("soundRhythm"),true);
        else if("soundDuration".equals(scope)&&e.optBoolean("soundEnabled")&&e.optInt("actualSoundMs")>0)edit.putInt("soundDurationLimit",FeedbackPolicy.lowerLimit(p.getInt("soundDurationLimit",5000),e.optInt("actualSoundMs")));
        else if("vibrationDuration".equals(scope)&&e.optBoolean("vibrate")&&e.optInt("actualVibrationMs")>0)edit.putInt("vibrationDurationLimit",FeedbackPolicy.lowerLimit(p.getInt("vibrationDurationLimit",2000),e.optInt("actualVibrationMs")));
        else if("mixed".equals(scope))edit.putBoolean("deny_pair_"+key(e),true);
        else if("acceptable".equals(scope)){
            String id=e.optString("id");if(!p.getBoolean("accepted_"+id,false))edit.putBoolean("accepted_"+id,true).putInt("accept_"+key(e),p.getInt("accept_"+key(e),0)+1);
        }else throw new IllegalArgumentException("选择与最近实验匹配的反馈类型");
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
    synchronized void observe(long second,double score,boolean muted,long now,double threshold,boolean screenOn)throws Exception{
        boolean gap=last>=0&&second!=last+1;last=second;
        if(gap||muted||screenOn)baseline.clear();
        if(!muted&&!screenOn){if(score<threshold)quiet++;else quiet=0;if(quiet>=10)attempts=0;baseline.addLast(score);while(baseline.size()>30)baseline.removeFirst();}
        if(pending==null||!observing)return;
        if(screenOn)pending.put("screen_on_during_observation",true);
        if(now<lastEnd)return;
        if(muted){if("vibration_threshold".equals(pending.optString("mode"))&&samples>0)finish("incomplete");return;}
        if(gap&&(samples>0||"vibration_threshold".equals(pending.optString("mode")))){finish("incomplete");return;}
        samples++;afterSum+=score;if(score>=pending.optDouble("threshold",.15))hits++;
        if(samples>=30)finish(FeedbackPolicy.reduced(samples,hits)?"stopped":"continued");
    }
    synchronized void close()throws Exception{if(pending!=null)finish("incomplete");}
    synchronized boolean observingThreshold(){return pending!=null&&"vibration_threshold".equals(pending.optString("mode"));}
    private void finish(String result)throws Exception{
        JSONObject e=new JSONObject().put("kind","outcome").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis())
            .put("result",result).put("valid_seconds",samples).put("snore_seconds",hits).put("mean_score",samples>0?afterSum/samples:0).put("settings",pending);
        append(c,e);
        boolean control=pending.optBoolean("control");SharedPreferences.Editor ed=prefs.edit();
        if("vibration_threshold".equals(pending.optString("mode"))){
            int level=pending.optInt("ladder_level",-1),length=pending.optInt("ladder_length",0);
            if(level>=0&&level<length&&pending.optString("ladder_key").equals(prefs.getString("vth_key",""))&&night().equals(prefs.getString("vth_night",""))){
                boolean screen=pending.optBoolean("screen_on_during_observation");
                ed.putString("vth_last",new JSONObject().put("level",level+1).put("result",result).put("control",control)
                    .put("screen_on",screen).put("amplitude",pending.optInt("vibrationAmplitude")).put("duration_ms",pending.optInt("actualVibrationMs"))
                    .put("valid_seconds",samples).put("snore_seconds",hits).toString());
                if(!control&&!"incomplete".equals(result)){
                    boolean stopped="stopped".equals(result);
                    String count=(stopped?"vth_ok_":"vth_no_")+level;
                    ed.putInt(count,prefs.getInt(count,0)+1);
                    if(stopped||!screen)ed.putInt("vth_level",FeedbackPolicy.nextVibrationLevel(level,length,result));
                    if(level==length-1&&!screen)ed.putInt("vth_upper_failures",stopped?0:prefs.getInt("vth_upper_failures",0)+1);
                }
            }
        }
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
        if(!ed.commit())throw new IOException("实验统计保存失败");
        rememberTrial(prefs,pending,result,samples,hits);
        if(!pending.optString("session_id").isEmpty()&&SleepRecorderService.isCurrentSession(pending.optString("session_id"))){
            try{SleepRecorderService.recordSelfReport(c,new JSONObject().put("kind","trial_outcome").put("session_id",pending.optString("session_id"))
                .put("trial_id",pending.optString("id")).put("time_ms",System.currentTimeMillis()).put("result",result)
                .put("control",control).put("valid_seconds",samples).put("snore_seconds",hits).put("screen_on",pending.optBoolean("screen_on_during_observation")));}
            catch(Exception ex){android.util.Log.w("SleepFeedback","session outcome journal",ex);}
        }
        outcomeRevision++;pending=null;observing=false;samples=hits=0;afterSum=0;
    }
    private String[] compatibleRhythms(String sound,String[] rhythms,int limit){
        long clipMs=0;
        if(CueLibrary.validId(sound)){
            clipMs=CueLibrary.pcmFile(c,sound).length()*1000/(2*CuePcm.RATE);
            if(clipMs<=0)return new String[0];
        }
        ArrayList<String> out=new ArrayList<>();
        for(String rhythm:rhythms)if(FeedbackPolicy.rhythmFits(rhythm,clipMs,limit))out.add(rhythm);
        return out.toArray(new String[0]);
    }
    synchronized SnoreFeedbackController.Settings choose(SnoreFeedbackController.Settings s,long now,long enabledAt)throws Exception{
        if(began!=enabledAt){began=enabledAt;sessionCues=0;attempts=0;if(pending!=null)finish("incomplete");}
        if(pending!=null){if(now-lastEnd>90000)finish("incomplete");else return null;}
        if(!FeedbackPolicy.canStart(s.soundEnabled,s.vibrate,sessionCues,s.maxCues,now,lastEnd,System.currentTimeMillis()-enabledAt,s.delayMinutes*60000L)
            ||!FeedbackPolicy.nightBudget(nightCount(prefs),s.maxCues,prefs.getLong("lastTrialWall",0),System.currentTimeMillis()))return null;
        if(("limited".equals(s.mode)||"stairs".equals(s.mode))&&attempts>=3)return null;
        SnoreFeedbackController.Settings x=SnoreFeedbackController.Settings.parse(s.json().toString());
        x.soundMax=Math.min(x.soundMax,prefs.getInt("soundLimit",100));
        x.vibrationMax=Math.min(x.vibrationMax,prefs.getInt("vibrationLimit",100));
        x.soundMsMax=Math.min(x.soundMsMax,prefs.getInt("soundDurationLimit",5000));
        x.vibrationMsMax=Math.min(x.vibrationMsMax,prefs.getInt("vibrationDurationLimit",2000));
        if(x.soundMax==0||x.soundMsMax<150)x.soundEnabled=false;if(x.vibrationMax==0||x.vibrationMsMax<100)x.vibrate=false;
        if(!x.soundEnabled&&!x.vibrate)return null;
        if("vibration_threshold".equals(s.mode)){
            if(!x.vibrate||!FeedbackPolicy.thresholdBudget(nightCount(prefs),s.maxCues,prefs.getLong("lastTrialWall",0),System.currentTimeMillis(),now-lastEnd)
                    ||System.currentTimeMillis()-enabledAt<Math.max(30,s.delayMinutes)*60000L)return null;
            // The caller's 300-second envelope gate already requires three
            // AI-confirmed rises and a fresh one; do not require clustered hits.
            x.soundEnabled=false;
            int[][] ladder=FeedbackPolicy.vibrationLadder(x.vibrationMin,x.vibrationMax,x.vibrationMsMax);
            if(ladder.length==0||prefs.getBoolean("deny_vib_"+x.vibrationPattern,false)||prefs.getBoolean("deny_pair_"+key(x.json()),false))return null;
            String key=x.vibrationMin+":"+x.vibrationMax+":"+x.vibrationMsMax+":"+x.vibrationPattern+":"+x.vibrationCompatibility;
            if(!night().equals(prefs.getString("vth_night",""))||!key.equals(prefs.getString("vth_key",""))){
                SharedPreferences.Editor reset=prefs.edit().putString("vth_night",night()).putString("vth_key",key)
                    .putInt("vth_level",0).putInt("vth_length",ladder.length).putInt("vth_upper_failures",0).putInt("vth_trials",0).remove("vth_last");
                for(String k:prefs.getAll().keySet())if(k.startsWith("vth_ok_")||k.startsWith("vth_no_"))reset.remove(k);
                if(!reset.commit())throw new IOException("阈值实验初始化失败");
            }
            if(prefs.getInt("vth_upper_failures",0)>=2)return null;
            ladderKey=key;ladderLength=ladder.length;ladderLevel=Math.max(0,Math.min(ladderLength-1,prefs.getInt("vth_level",0)));
            x.vibrationAmplitude=ladder[ladderLevel][0];x.vibrationMs=ladder[ladderLevel][1];
            return x;
        }
        int trial=prefs.getInt("trials",0);
        if("explore".equals(s.mode)||"adaptive".equals(s.mode)){
            String[] sounds=pool(s.soundPool,s.sound,"deny_sound_"),vibs=pool(s.vibrationPool,s.vibrationPattern,"deny_vib_"),rhythms=pool(s.soundRhythmPool,s.soundRhythm,"deny_rhythm_");
            ArrayList<String> usableSounds=new ArrayList<>();
            for(String sound:sounds)if(compatibleRhythms(sound,rhythms,x.soundMsMax).length>0)usableSounds.add(sound);
            sounds=usableSounds.toArray(new String[0]);
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
                ArrayList<JSONObject> ranked=new ArrayList<>();
                for(JSONObject o:options){String k=key(o);int n=prefs.getInt("n_"+k,0),ok=prefs.getInt("ok_"+k,0);if(n>=1&&ok>0)ranked.add(o);}
                ranked.sort((a,b)->Double.compare(FeedbackPolicy.rank(prefs.getInt("ok_"+key(b),0),prefs.getInt("n_"+key(b),0),prefs.getInt("accept_"+key(b),0)),FeedbackPolicy.rank(prefs.getInt("ok_"+key(a),0),prefs.getInt("n_"+key(a),0),prefs.getInt("accept_"+key(a),0))));
                if(!ranked.isEmpty())pick=ranked.get(trial%Math.min(3,ranked.size()));
            }
            x.soundEnabled=pick.optBoolean("soundEnabled");x.vibrate=pick.optBoolean("vibrate");x.sound=pick.optString("sound");x.vibrationPattern=pick.optString("vibrationPattern");
            int step=(trial/3)%3,vstep=(trial/9+step)%3;
            x.volume=FeedbackPolicy.coarseRange(x.soundMin,x.soundMax,step);x.vibrationAmplitude=FeedbackPolicy.coarseRange(x.vibrationMin,x.vibrationMax,vstep);
            x.vibrationMs=new int[]{200,500,1000}[vstep];x.soundMs=new int[]{300,800,1500}[step];
            String[] feasible=x.soundEnabled?compatibleRhythms(x.sound,rhythms,x.soundMsMax):new String[]{"single"};
            x.soundRhythm=feasible[(trial/3)%feasible.length];
            if("adaptive".equals(s.mode)&&trial%5!=0){
                JSONObject best=new JSONObject(prefs.getString("best_"+key(pick),"{}"));
                x.volume=best.optInt("volume",x.volume);x.vibrationAmplitude=best.optInt("vibrationAmplitude",x.vibrationAmplitude);
                x.vibrationMs=best.optInt("vibrationMs",x.vibrationMs);x.soundMs=best.optInt("soundMs",x.soundMs);
                String bestRhythm=best.optString("soundRhythm",x.soundRhythm);
                if(Arrays.asList(feasible).contains(bestRhythm))x.soundRhythm=bestRhythm;
                // Coordinate refinement: alter only one actuator at a time.
                if(trial%5==1){if(x.soundEnabled)x.volume=Math.max(1,x.volume-5);else x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude-5);}
                if(trial%5==2&&x.vibrate)x.vibrationAmplitude=Math.max(x.vibrationMin,x.vibrationAmplitude-5);
                if(trial%5==3&&x.soundEnabled&&!CueLibrary.validId(x.sound))x.soundMs=Math.max(150,x.soundMs-200);
                if(trial%5==4&&x.vibrate)x.vibrationMs=Math.max(100,x.vibrationMs-100);
            }
            // All selected clips already fit the learned duration bound.
            if(x.soundEnabled&&CueLibrary.validId(x.sound))x.soundMs=0;
            else if(x.soundEnabled&&!"single".equals(x.soundRhythm)&&x.soundMs>0)x.soundMs=Math.max(180,x.soundMs);
            x.volume=Math.max(Math.min(x.soundMin,x.soundMax),x.volume);
            x.vibrationAmplitude=Math.max(Math.min(x.vibrationMin,x.vibrationMax),x.vibrationAmplitude);
        }else if("stairs".equals(s.mode)){
            x.volume=Math.max(1,x.volume*(attempts+1)/3);x.vibrationAmplitude=Math.max(1,x.vibrationAmplitude*(attempts+1)/3);
        }
        x.volume=Math.max(1,FeedbackPolicy.cap(x.volume,x.soundMax,100));x.vibrationAmplitude=Math.max(1,FeedbackPolicy.cap(x.vibrationAmplitude,x.vibrationMax,100));
        if(x.soundMs>0)x.soundMs=Math.min(x.soundMs,x.soundMsMax);
        x.vibrationMs=Math.min(x.vibrationMs,x.vibrationMsMax);
        if(x.soundEnabled&&prefs.getBoolean("deny_rhythm_"+x.soundRhythm,false))return null;
        if(x.soundEnabled&&prefs.getBoolean("deny_sound_"+x.sound,false)||x.vibrate&&prefs.getBoolean("deny_vib_"+x.vibrationPattern,false)||prefs.getBoolean("deny_pair_"+key(x.json()),false))return null;
        return x;
    }
    synchronized boolean begin(SnoreFeedbackController.Settings x,long now,String session)throws Exception{
        if(pending!=null)return false;
        int trial=prefs.getInt("trials",0);boolean control=("control".equals(x.mode)&&java.util.concurrent.ThreadLocalRandom.current().nextInt(3)==0)||("adaptive".equals(x.mode)&&java.util.concurrent.ThreadLocalRandom.current().nextInt(5)==0)||("vibration_threshold".equals(x.mode)&&prefs.getInt("vth_trials",0)%4==3);
        pending=x.json().put("id",UUID.randomUUID().toString()).put("kind","trial").put("time_ms",System.currentTimeMillis()).put("session_id",session).put("control",control);
        if("vibration_threshold".equals(x.mode))pending.put("ladder_key",ladderKey).put("ladder_level",ladderLevel).put("ladder_length",ladderLength);
        double sum=0;int beforeHits=0;for(double value:baseline){sum+=value;if(value>=x.threshold)beforeHits++;}
        pending.put("baseline_seconds",baseline.size()).put("baseline_snore_seconds",beforeHits).put("baseline_mean_score",baseline.isEmpty()?0:sum/baseline.size());
        x.trialId=pending.optString("id");samples=hits=0;afterSum=0;observing=false;sessionCues++;attempts++;lastEnd=now+6000;
        append(c,pending);
        SharedPreferences.Editor progress=prefs.edit().putInt("trials",trial+1).putInt("controls",prefs.getInt("controls",0)+(control?1:0)).putString("night",night()).putInt("nightCount",nightCount(prefs)+1).putLong("lastTrialWall",System.currentTimeMillis());
        if("vibration_threshold".equals(x.mode))progress.putInt("vth_trials",prefs.getInt("vth_trials",0)+1);
        if(!progress.commit())throw new IOException("实验进度保存失败");
        rememberTrial(prefs,pending,"pending",0,0);
        return control;
    }
    synchronized void started(SnoreFeedbackController.Settings selected)throws Exception{
        if(pending==null)return;
        pending.put("actualSoundMs",selected.actualSoundMs).put("actualVibrationMs",selected.actualVibrationMs).put("started_ms",System.currentTimeMillis());
        if(!pending.optBoolean("control")&&!prefs.edit().putString("last",pending.toString()).commit())throw new IOException("最近实验保存失败");
        rememberTrial(prefs,pending,"pending",0,0);
        append(c,new JSONObject().put("kind","started").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis()).put("actualSoundMs",selected.actualSoundMs).put("actualVibrationMs",selected.actualVibrationMs));
    }
    synchronized void executed(boolean ok)throws Exception{
        if(pending==null)return;
        if(!ok){finish("incomplete");return;}
        lastEnd=android.os.SystemClock.elapsedRealtime()+1500;observing=true;
        if(!pending.optBoolean("control")&&!prefs.edit().putString("last",pending.toString()).commit())throw new IOException("最近实验保存失败");
        append(c,new JSONObject().put("kind","executed").put("id",pending.optString("id")).put("time_ms",System.currentTimeMillis()).put("control",pending.optBoolean("control")));
    }
}