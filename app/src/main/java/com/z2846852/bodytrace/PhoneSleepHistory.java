package com.z2846852.bodytrace;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.os.Process;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Local, on-demand UsageStatsManager history scanner.
 * Calls queryEvents(0, now), asking the OS for ALL CURRENTLY RETAINED events
 * rather than guessing whether the vivo ROM keeps 7, 14 or another number
 * of days. Android documents that the event history is only kept for a few
 * days; this class never claims older missing dates were "no activity".
 *
 * Stores only nightly summaries and counts, not per-app usage information.
 */
final class PhoneSleepHistory {
    private static final String FILE="phone_sleep_reports.json";
    private static final int MAX_SCANNED=300_000;
    private static final int MAX_FILE=4*1024*1024;
    private final Context context;
    private final AtomicFile store;

    PhoneSleepHistory(Context context){
        this.context=context.getApplicationContext();
        this.store=new AtomicFile(new File(context.getFilesDir(),FILE));
    }

    boolean hasUsageAccess(){
        AppOpsManager apps=(AppOpsManager)context.getSystemService(Context.APP_OPS_SERVICE);
        if(apps==null)return false;
        int mode=apps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),context.getPackageName());
        return mode==AppOpsManager.MODE_ALLOWED;
    }

    private JSONObject status(String state,String note)throws Exception {
        return new JSONObject().put("type","phone_sleep")
            .put("state",state).put("message",note)
            .put("timezone","Asia/Shanghai")
            .put("usage_access",hasUsageAccess());
    }

    private JSONObject readStore() throws Exception {
        try(InputStream in=store.openRead();
            ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] chunk=new byte[16384];int length;
            while((length=in.read(chunk))!=-1){
                if(out.size()+length>MAX_FILE)
                    throw new SecurityException("手机睡眠历史文件异常过大");
                out.write(chunk,0,length);
            }
            JSONObject result=new JSONObject(new String(
                out.toByteArray(),StandardCharsets.UTF_8));
            return result.optInt("schema")==1?result:new JSONObject();
        }catch(java.io.FileNotFoundException missing){
            return new JSONObject();
        }
    }

    private void saveStore(Map<String,JSONObject> reports)throws Exception {
        JSONObject data=new JSONObject().put("schema",1);
        JSONArray values=new JSONArray();
        for(JSONObject report:reports.values())values.put(report);
        data.put("reports",values);
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_FILE)throw new IllegalStateException("手机睡眠历史记录容量达到上限");
        FileOutputStream stream=null;
        try{
            stream=store.startWrite();
            stream.write(bytes);
            store.finishWrite(stream);
        }catch(Exception failure){
            if(stream!=null)store.failWrite(stream);
            throw failure;
        }
    }

    private static Map<String,JSONObject> mergeStored(JSONObject stored) {
        Map<String,JSONObject> map=new LinkedHashMap<>();
        JSONArray records=stored.optJSONArray("reports");
        if(records!=null){
            for(int i=0;i<records.length();i++){
                JSONObject report=records.optJSONObject(i);
                if(report!=null){
                    String date=report.optString("day","");
                    if(date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")&&
                        "screen_idle_opportunity_v1".equals(report.optString("model")))
                        map.put(date,report);
                }
            }
        }
        return map;
    }

    JSONObject scanAllRetainedEvents() throws Exception {
        if(!hasUsageAccess())
            return status("permission_required",
                "需要一次性开启系统“使用情况访问权限”；不需要每天授权。");

        UsageStatsManager manager=(UsageStatsManager)context.getSystemService(
            Context.USAGE_STATS_SERVICE);
        if(manager==null)
            return status("unsupported","系统未提供使用情况记录接口");

        long now=System.currentTimeMillis();
        // 0 is intentionally NOT a 7-day window. Android itself controls
        // which events still exist in its protected usage history database.
        UsageEvents events=manager.queryEvents(0L,now+1L);
        if(events==null)
            return status("no_events","系统未返回使用事件，手机需要解锁并确认使用情况权限");

        ArrayList<PhoneSleepInference.Event> relevant=new ArrayList<>();
        UsageEvents.Event event=new UsageEvents.Event();
        long earliest=Long.MAX_VALUE,latest=0;
        int scanned=0;
        boolean truncated=false;
        while(events.hasNextEvent()){
            if(scanned>=MAX_SCANNED){truncated=true;break;}
            events.getNextEvent(event);
            scanned++;
            int type=event.getEventType();
            if(type!=PhoneSleepInference.SCREEN_ON &&
               type!=PhoneSleepInference.SCREEN_OFF &&
               type!=PhoneSleepInference.KEYGUARD_HIDDEN &&
               type!=PhoneSleepInference.KEYGUARD_SHOWN &&
               type!=PhoneSleepInference.STARTUP &&
               type!=PhoneSleepInference.SHUTDOWN)
                continue;
            long timestamp=event.getTimeStamp();
            if(timestamp<=0||timestamp>now+60000L)continue;
            relevant.add(new PhoneSleepInference.Event(timestamp,type));
            earliest=Math.min(earliest,timestamp);
            latest=Math.max(latest,timestamp);
        }
        if(relevant.isEmpty()){
            JSONObject empty=status("no_events",scanned>0?
                "系统返回了使用记录，但没有可用于睡眠推测的屏幕和解锁事件。":
                "系统没有返回可读取的历史事件。");
            empty.put("events_scanned",scanned);
            empty.put("truncated",truncated);
            return empty;
        }

        List<PhoneSleepInference.Night> nights=
            PhoneSleepInference.infer(relevant,now);
        Map<String,JSONObject> records=mergeStored(readStore());
        int created=0;
        JSONArray insufficient=new JSONArray();
        for(PhoneSleepInference.Night night:nights){
            if("candidate".equals(night.state)){
                if(!records.containsKey(night.day)){
                    JSONObject record=new JSONObject()
                        .put("day",night.day)
                        .put("model","screen_idle_opportunity_v1")
                        .put("screen_off_ms",night.offMs)
                        .put("next_screen_on_ms",night.onMs)
                        .put("inactive_window_ms",night.gapMs)
                        .put("screen_on_events",night.screenOn)
                        .put("unlock_events",night.unlock)
                        .put("screen_off_events",night.screenOff)
                        .put("created_ms",now)
                        .put("note",night.reason);
                    records.put(night.day,record);
                    created++;
                }
            }else{
                JSONObject missing=new JSONObject()
                    .put("day",night.day).put("state","insufficient")
                    .put("message",night.reason)
                    .put("screen_on_events",night.screenOn)
                    .put("unlock_events",night.unlock);
                insufficient.put(missing);
            }
        }
        if(created>0)saveStore(records);
        JSONArray history=new JSONArray();
        records.values().stream()
            .sorted((a,b)->b.optString("day").compareTo(a.optString("day")))
            .forEach(history::put);
        JSONObject result=status("ready",
            "按系统实际可读事件扫描完成；这里只是手机使用间隔，不是已证实的睡眠时间。");
        result.put("history",history);
        result.put("insufficient",insufficient);
        result.put("created_count",created);
        result.put("total_count",history.length());
        result.put("nights_examined",nights.size());
        result.put("events_scanned",scanned);
        result.put("evidence_events",relevant.size());
        result.put("first_event_ms",earliest);
        result.put("last_event_ms",latest);
        result.put("truncated",truncated);
        return result;
    }
}
