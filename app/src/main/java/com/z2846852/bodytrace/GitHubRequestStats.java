package com.z2846852.bodytrace;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Rolling local history of updater GitHub HTTP requests; no tokens or URLs saved. */
final class GitHubRequestStats {
    private static final String PREF="github_http_request_stats";
    static synchronized void record(Context context,String kind,int status){
        SharedPreferences prefs=context.getApplicationContext().getSharedPreferences(PREF,0);
        long now=System.currentTimeMillis();
        try{
            JSONArray old=new JSONArray(prefs.getString("events","[]"));
            JSONArray next=new JSONArray();
            for(int i=0;i<old.length();i++){
                JSONObject e=old.optJSONObject(i);
                if(e!=null&&now-e.optLong("time")<7L*86400000L&&
                    next.length()<199)next.put(e);
            }
            next.put(new JSONObject().put("time",now).put("kind",kind)
                .put("status",status));
            prefs.edit().putString("events",next.toString()).apply();
        }catch(Exception ignored){}
    }
    static synchronized JSONObject snapshot(Context context)throws Exception{
        JSONArray events=new JSONArray(context.getSharedPreferences(PREF,0)
            .getString("events","[]"));
        long now=System.currentTimeMillis();
        int hour=0,day=0,week=0,errors=0;
        JSONArray recent=new JSONArray();
        for(int i=events.length()-1;i>=0;i--){
            JSONObject e=events.optJSONObject(i);
            if(e==null)continue;
            long age=now-e.optLong("time");
            if(age<0||age>=7L*86400000L)continue;
            week++;
            if(age<86400000L)day++;
            if(age<3600000L)hour++;
            if(e.optInt("status")>=400||e.optInt("status")==0)errors++;
            if(recent.length()<12)recent.put(e);
        }
        return new JSONObject().put("type","github_request_stats")
            .put("hour",hour).put("day",day).put("week",week)
            .put("errors",errors).put("recent",recent)
            .put("scope","仅统计本版本开始的 APK 更新请求；不包含同步和历史请求");
    }
}
