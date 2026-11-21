package com.z2846852.bodytrace;

import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONObject;

/**
 * Minimal read-only vivo Health ContentProvider diagnostic.
 *
 * This is NOT a generic vivo WATCH 5 API. The watch must first sync sleep
 * information into the vivo Health phone app. The observed private provider
 * is firmware-dependent and protected by a signature|privileged permission.
 * No root, accessibility scraping, auto-grant or network transfer is attempted.
 *
 * Independent implementation. Provider discovery and field names informed by
 * publicly documented X200 Pro / Akari Pulse experiments (AGPL source not used).
 */
final class VivoSleepProbe {
    static final String PERMISSION="com.vivo.health.widget.permission";
    static final String AUTHORITY="com.vivo.health.provider";
    static final Uri URI=Uri.parse("content://com.vivo.health.provider/sleep");

    private final Context context;
    VivoSleepProbe(Context context){this.context=context.getApplicationContext();}

    private JSONObject state(String capability,String message) throws Exception {
        return new JSONObject()
            .put("type","vivo_sleep")
            .put("capability",capability)
            .put("message",message)
            .put("source","vivo_health_private_provider")
            .put("provider_authority",AUTHORITY)
            .put("granted",context.checkSelfPermission(PERMISSION)==
                PackageManager.PERMISSION_GRANTED);
    }

    JSONObject read() throws Exception {
        if(context.getPackageManager().resolveContentProvider(AUTHORITY,0)==null)
            return state("UNSUPPORTED","未找到 vivo 健康睡眠数据接口；该 ROM 可能不提供私有 Provider。");
        if(context.checkSelfPermission(PERMISSION)!=PackageManager.PERMISSION_GRANTED)
            return state("NOT_GRANTED","已找到 vivo 健康接口，但尚未获得私有读取权限。此权限无法通过普通 APP 弹窗授予；可用 ADB 测试 ROM 是否允许授权。");
        try(Cursor cursor=context.getContentResolver().query(URI,null,null,null,null)){
            if(cursor==null||!cursor.moveToFirst())
                return state("NO_DATA","接口可访问，但当前没有返回睡眠记录。先确认 vivo WATCH 5 的睡眠已经同步到 vivo 健康。");
            final long start=requiredLong(cursor,"ENTER_TIME");
            final long end=requiredLong(cursor,"EXIT_TIME");
            if(start<946684800000L||end<=start||
                end>System.currentTimeMillis()+86400000L||
                end-start>36L*3600*1000)
                throw new IllegalArgumentException("睡眠时间戳超出合理范围");
            long duration=optionalLong(cursor,"TOTAL_DURATION");
            if(duration<0||duration>36L*3600*1000)
                throw new IllegalArgumentException("睡眠时长超出合理范围");
            JSONObject value=state("PASS","已读取 vivo 健康最近一条睡眠记录（手机本地）。");
            value.put("start_ms",start);
            value.put("end_ms",end);
            value.put("duration_ms",duration);
            value.put("day",optionalString(cursor,"DATE"));
            putOptional(value,"light_ms",optionalLong(cursor,"LIGHT_SLEEP_DURATION"));
            putOptional(value,"deep_ms",optionalLong(cursor,"DEEP_SLEEP_DURATION"));
            putOptional(value,"rem_ms",optionalLong(cursor,"REM_SLEEP_DURATION"));
            putOptional(value,"awake_ms",optionalLong(cursor,"AWAKE_SLEEP_DURATION"));
            long score=optionalLong(cursor,"SCORE");
            if(score>=0&&score<=100)value.put("score",score);
            value.put("columns_found",cursor.getColumnCount());
            return value;
        }catch(SecurityException denied){
            return state("NOT_GRANTED","系统拒绝读取 vivo 健康私有数据，当前 ROM 不允许 BodyTrace 使用该接口。");
        }catch(Exception error){
            return state("ERROR","vivo 健康接口存在，但读取或解析失败："+error.getClass().getSimpleName());
        }
    }

    private static long requiredLong(Cursor cursor,String name){
        int column=cursor.getColumnIndex(name);
        if(column<0||cursor.isNull(column))
            throw new IllegalArgumentException("缺少睡眠字段："+name);
        return Long.parseLong(cursor.getString(column));
    }
    private static long optionalLong(Cursor cursor,String name){
        int column=cursor.getColumnIndex(name);
        if(column<0||cursor.isNull(column))return -1;
        try{return Long.parseLong(cursor.getString(column));}
        catch(NumberFormatException ignored){return -1;}
    }
    private static String optionalString(Cursor cursor,String name){
        int column=cursor.getColumnIndex(name);
        if(column<0||cursor.isNull(column))return "";
        String value=cursor.getString(column);
        return value==null?"":value.substring(0,Math.min(32,value.length()));
    }
    private static void putOptional(JSONObject target,String name,long value)throws Exception {
        if(value>=0&&value<=36L*3600*1000)target.put(name,value);
    }
}
