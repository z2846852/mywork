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
 * Private, on-device screen activity history and human-reviewed sleep candidates.
 * System event retention is controlled by Android, not by a guessed 7-day limit.
 * Manual decisions are never replaced by later automatic scans.
 */
final class PhoneSleepHistory {
    private static final String FILE="phone_sleep_reports.json";
    private static final String MODEL="phone_activity_v2";
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

    private JSONObject readStore()throws Exception {
        try(InputStream in=store.openRead();
            ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] chunk=new byte[16384];int length;
            while((length=in.read(chunk))!=-1){
                if(out.size()+length>MAX_FILE)
                    throw new SecurityException("手机行为历史文件异常过大");
                out.write(chunk,0,length);
            }
            JSONObject result=new JSONObject(new String(
                out.toByteArray(),StandardCharsets.UTF_8));
            int schema=result.optInt("schema");
            return schema==1||schema==2?result:new JSONObject();
        }catch(java.io.FileNotFoundException missing){
            return new JSONObject();
        }
    }

    private void saveStore(Map<String,JSONObject> reports)throws Exception {
        JSONObject data=new JSONObject().put("schema",2);
        JSONArray values=new JSONArray();
        for(JSONObject report:reports.values())values.put(report);
        data.put("reports",values);
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_FILE)
            throw new IllegalStateException("手机行为历史记录容量达到上限");
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

    private static String idFor(long start){return "p"+start;}
    private static Map<String,JSONObject> mergeStored(JSONObject stored)throws Exception {
        Map<String,JSONObject> map=new LinkedHashMap<>();
        JSONArray records=stored.optJSONArray("reports");
        if(records==null)return map;
        for(int i=0;i<records.length();i++){
            JSONObject report=records.optJSONObject(i);
            if(report==null)continue;
            String day=report.optString("day","");
            long from=report.optLong("screen_off_ms");
            long to=report.optLong("next_screen_on_ms");
            if(!day.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")||
               from<=0||to<=from)continue;
            String model=report.optString("model");
            if("screen_idle_opportunity_v1".equals(model)){
                // Non-destructive migration: preserve historical intervals.
                report.put("model",MODEL);
                report.put("id",idFor(from));
                report.put("sleep_status","suspected");
                report.put("reviewed",false);
                report.put("prompted",true); // Do not flood with legacy prompts.
                report.put("short_use_count",0);
                report.put("short_use_ms",0);
                report.put("note","旧版本记录，仍可人工确认；不是实测睡眠");
            }else if(!MODEL.equals(model))continue;
            String id=report.optString("id",idFor(from));
            if(!id.matches("p[0-9]{10,16}"))id=idFor(from);
            report.put("id",id);
            map.put(id,report);
        }
        return map;
    }

    private static JSONObject overlapping(Map<String,JSONObject> saved,
                                          PhoneSleepInference.Night window){
        for(JSONObject record:saved.values()){
            long a=record.optLong("screen_off_ms");
            long b=record.optLong("next_screen_on_ms");
            long overlap=Math.min(b,window.onMs)-Math.max(a,window.offMs);
            long shorter=Math.min(b-a,window.gapMs);
            // Handles a former single screen-off interval extended by merging
            // brief time checks, without duplicating previously reviewed nights.
            if(shorter>0 && overlap>0 && overlap*10>=shorter*7)
                return record;
        }
        return null;
    }

    private static JSONArray sortedHistory(Map<String,JSONObject> saved){
        JSONArray result=new JSONArray();
        saved.values().stream()
            .sorted((a,b)->Long.compare(b.optLong("screen_off_ms"),
                                        a.optLong("screen_off_ms")))
            .forEach(result::put);
        return result;
    }

    /** Call only for explicit user input; accept a known local candidate ID. */
    synchronized void review(String id,String decision)throws Exception {
        if(id==null||!id.matches("p[0-9]{10,16}"))
            throw new IllegalArgumentException("无效记录编号");
        if(!"confirmed_sleep".equals(decision)&&
           !"not_sleep".equals(decision)&&
           !"unknown".equals(decision))
            throw new IllegalArgumentException("无效确认状态");
        Map<String,JSONObject> saved=mergeStored(readStore());
        JSONObject item=saved.get(id);
        if(item==null)throw new IllegalArgumentException("记录不存在，请重新扫描");
        item.put("sleep_status",decision)
            .put("reviewed",true)
            .put("prompted",true)
            .put("reviewed_ms",System.currentTimeMillis());
        saveStore(saved);
    }

    synchronized JSONObject scanAllRetainedEvents()throws Exception {
        if(!hasUsageAccess())
            return status("permission_required",
                "需要一次性开启系统“使用情况访问权限”；不需要每天授权。");

        UsageStatsManager manager=(UsageStatsManager)context.getSystemService(
            Context.USAGE_STATS_SERVICE);
        if(manager==null)
            return status("unsupported","系统未提供使用情况记录接口");

        long now=System.currentTimeMillis();
        UsageEvents events=manager.queryEvents(0L,now+1L);
        if(events==null)
            return status("no_events","系统没有返回可读取的使用事件");

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
               type!=PhoneSleepInference.USER_INTERACTION &&
               type!=PhoneSleepInference.SCREEN_OFF &&
               type!=PhoneSleepInference.KEYGUARD_HIDDEN &&
               type!=PhoneSleepInference.KEYGUARD_SHOWN &&
               type!=PhoneSleepInference.STARTUP &&
               type!=PhoneSleepInference.SHUTDOWN)continue;
            long timestamp=event.getTimeStamp();
            if(timestamp<=0||timestamp>now+60000L)continue;
            relevant.add(new PhoneSleepInference.Event(timestamp,type));
            earliest=Math.min(earliest,timestamp);
            latest=Math.max(latest,timestamp);
        }
        JSONObject stored=readStore();
        Map<String,JSONObject> saved=mergeStored(stored);
        if(relevant.isEmpty()){
            JSONObject empty=status("no_events",scanned>0?
                "系统返回了使用记录，但没有可用于推测休息的屏幕事件。":
                "系统没有返回可读取的历史事件。");
            empty.put("history",sortedHistory(saved))
                .put("events_scanned",scanned).put("truncated",truncated);
            if(stored.optInt("schema")!=2 && !saved.isEmpty())saveStore(saved);
            return empty;
        }

        List<PhoneSleepInference.Night> windows=
            PhoneSleepInference.infer(relevant,now);
        int created=0;
        boolean dirty=stored.optInt("schema")!=2;
        JSONArray incomplete=new JSONArray();
        for(PhoneSleepInference.Night window:windows){
            if("pending".equals(window.state)){
                incomplete.put(new JSONObject()
                    .put("day",window.day).put("state","pending")
                    .put("message",window.reason));
                continue;
            }
            if(window.gapMs<PhoneSleepInference.MIN_GAP)continue;
            JSONObject record=saved.get(idFor(window.offMs));
            if(record==null)record=overlapping(saved,window);
            if(record==null){
                record=new JSONObject()
                    .put("id",idFor(window.offMs))
                    .put("model",MODEL)
                    .put("created_ms",now)
                    .put("reviewed",false)
                    .put("prompted",false);
                saved.put(record.getString("id"),record);
                created++;
                dirty=true;
            }
            if(record.optBoolean("reviewed",false)){
                // Preserve both the manually selected label and its evidence.
                continue;
            }
            String updatedStatus="candidate".equals(window.state)?
                "suspected":"unknown";
            // Existing unreviewed candidate can be refined by a new scan.
            if(record.optLong("screen_off_ms")!=window.offMs ||
               record.optLong("next_screen_on_ms")!=window.onMs ||
               !updatedStatus.equals(record.optString("sleep_status")) ||
               record.optLong("short_use_ms")!=window.shortUseMs ||
               record.optInt("short_use_count")!=window.shortUseCount)
                dirty=true;
            record.put("day",window.day)
                .put("model",MODEL)
                .put("screen_off_ms",window.offMs)
                .put("next_screen_on_ms",window.onMs)
                .put("inactive_window_ms",window.gapMs)
                .put("short_use_count",window.shortUseCount)
                .put("short_use_ms",window.shortUseMs)
                .put("screen_on_events",window.screenOn)
                .put("unlock_events",window.unlock)
                .put("screen_off_events",window.screenOff)
                .put("sleep_status",updatedStatus)
                .put("note",window.reason);
        }
        // A single first-time prompt; all new records remain directly editable.
        // Mark them all prompted so reopening the page never creates a pop-up loop.
        JSONObject prompt=null;
        for(JSONObject record:saved.values()){
            if(record.optBoolean("reviewed")||record.optBoolean("prompted"))continue;
            if(prompt==null ||
               ("unknown".equals(record.optString("sleep_status")) &&
                !"unknown".equals(prompt.optString("sleep_status"))) ||
               (record.optString("sleep_status")
                  .equals(prompt.optString("sleep_status")) &&
                record.optLong("screen_off_ms")>prompt.optLong("screen_off_ms")))
                prompt=record;
        }
        String promptId=prompt==null?"":prompt.optString("id");
        if(prompt!=null){
            for(JSONObject record:saved.values()){
                if(!record.optBoolean("reviewed")&&!record.optBoolean("prompted"))
                    record.put("prompted",true);
            }
            dirty=true;
        }
        if(dirty)saveStore(saved);

        JSONObject result=status("ready",
            "已扫描系统仍保留的屏幕事件；未使用手机不等于实际睡眠。");
        result.put("history",sortedHistory(saved))
            .put("insufficient",incomplete)
            .put("prompt_id",promptId)
            .put("created_count",created)
            .put("total_count",saved.size())
            .put("events_scanned",scanned)
            .put("evidence_events",relevant.size())
            .put("first_event_ms",earliest)
            .put("last_event_ms",latest)
            .put("truncated",truncated);
        return result;
    }
}
