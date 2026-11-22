package com.z2846852.bodytrace;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Shared, persistent and rate-limit-aware public GitHub Release metadata cache.
 * This is NOT an installation trust anchor; signed APK and UI hash validation
 * remains mandatory. No tokens or audio data are stored here.
 */
final class GitHubReleaseCache {
    private static final String API=
        "https://api.github.com/repos/z2846852/mywork/releases/latest";
    private static final String PREFS="bodytrace_github_release";
    private static final long FRESH_MS=10*60*1000L;
    private static final long STALE_MS=24*60*60*1000L;
    private static final long BACKOFF_MS=5*60*1000L;
    private static final long MAX_BACKOFF_MS=6*60*60*1000L;
    private static final int MAX_JSON=512*1024;
    private final SharedPreferences prefs;

    static final class Snapshot {
        final JSONObject release;
        final boolean stale;
        final long retryAt;
        Snapshot(JSONObject release,boolean stale,long retryAt){
            this.release=release;this.stale=stale;this.retryAt=retryAt;
        }
        String note(){
            long minutes=Math.max(1,(retryAt-System.currentTimeMillis()+59999)/60000);
            return "GitHub 公共 API 暂时受限；显示上次缓存（不代表最新版本），约 "+
                minutes+" 分钟后再试";
        }
    }

    GitHubReleaseCache(Context context){
        prefs=context.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }
    private static long number(String value){
        try{return Long.parseLong(value);}catch(Exception ignored){return -1;}
    }
    private JSONObject cached(long now){
        long time=prefs.getLong("fetched_at",0);
        if(time<=0||time>now||now-time>STALE_MS)return null;
        try{
            JSONObject release=new JSONObject(prefs.getString("release_json",""));
            if(release.optString("tag_name").matches("v0\\.2\\.[0-9]{1,7}")&&
                release.has("assets"))return release;
        }catch(Exception ignored){}
        return null;
    }
    private long nextRetry(HttpURLConnection c,long now){
        long until=now+BACKOFF_MS;
        long retry=number(c.getHeaderField("Retry-After"));
        if(retry>=1&&retry<=21600)until=now+retry*1000;
        else if("0".equals(c.getHeaderField("X-RateLimit-Remaining"))){
            long reset=number(c.getHeaderField("X-RateLimit-Reset"));
            if(reset>now/1000&&reset<now/1000+21600)
                until=reset*1000+5000;
        }
        return Math.min(now+MAX_BACKOFF_MS,Math.max(now+30000,until));
    }
    private static String read(InputStream source)throws Exception{
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        byte[] buffer=new byte[8192];int n;
        while((n=source.read(buffer))!=-1){
            if(out.size()+n>MAX_JSON)throw new IllegalStateException("GitHub 响应超出大小限制");
            out.write(buffer,0,n);
        }
        return new String(out.toByteArray(),StandardCharsets.UTF_8);
    }

    synchronized Snapshot get() throws Exception {return get(false);}

    synchronized Snapshot get(boolean force) throws Exception {
        long now=System.currentTimeMillis();
        JSONObject local=cached(now);
        long freshAt=prefs.getLong("fetched_at",0);
        long blocked=prefs.getLong("blocked_until",0);
        if(!force&&local!=null&&now-freshAt<FRESH_MS)
            return new Snapshot(local,false,blocked);
        if(now<blocked){
            if(local!=null)return new Snapshot(local,true,blocked);
            throw new IllegalStateException("GitHub 公共 API 限流，约 "+
                Math.max(1,(blocked-now+59999)/60000)+" 分钟后再试");
        }
        HttpURLConnection c=(HttpURLConnection)new URL(API).openConnection();
        c.setConnectTimeout(12000);c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent","BodyTrace-ReleaseCache/1");
        c.setRequestProperty("Accept","application/vnd.github+json");
        c.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
        try{
            int status=c.getResponseCode();
            if(status==200){
                String json;
                try(InputStream stream=c.getInputStream()){json=read(stream);}
                JSONObject release=new JSONObject(json);
                if(!release.optString("tag_name").matches("v0\\.2\\.[0-9]{1,7}")||
                    !release.has("assets"))
                    throw new IllegalStateException("GitHub Release 元数据无效");
                prefs.edit().putString("release_json",json)
                    .putLong("fetched_at",now).remove("blocked_until").commit();
                return new Snapshot(release,false,0);
            }
            if(status==403||status==429){
                long until=nextRetry(c,now);
                prefs.edit().putLong("blocked_until",until).commit();
                if(local!=null)return new Snapshot(local,true,until);
                throw new IllegalStateException("GitHub HTTP "+status+"：公共 API 限流，约 "+
                    Math.max(1,(until-now+59999)/60000)+" 分钟后再试");
            }
            throw new IllegalStateException("GitHub Release 查询失败 HTTP "+status);
        }catch(java.io.IOException e){
            if(local!=null)return new Snapshot(local,true,now+BACKOFF_MS);
            throw e;
        }finally{c.disconnect();}
    }
}
