package com.z2846852.bodytrace;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** User-triggered public GitHub Release history; no token, audio or background polling. */
final class ReleaseHistory {
    private static final String API="https://api.github.com/repos/z2846852/mywork/";
    private static final int MAX_RESPONSE=3*1024*1024;
    private static final int PAGE_SIZE=20;

    private static String request(String endpoint)throws Exception{
        URL url=new URL(API+endpoint);
        if(!"https".equalsIgnoreCase(url.getProtocol())||
            !"api.github.com".equalsIgnoreCase(url.getHost()))
            throw new SecurityException("仅允许 GitHub 公共 API");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();
        c.setConnectTimeout(12000);c.setReadTimeout(18000);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent","BodyTrace-ReleaseHistory/1");
        c.setRequestProperty("Accept","application/vnd.github+json");
        c.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
        try{
            int code=c.getResponseCode();
            if(code==403||code==429){
                String retry=c.getHeaderField("Retry-After");
                throw new IllegalStateException("GitHub API 限流"+
                    (retry!=null&&retry.matches("[0-9]{1,6}")?"，请 "+retry+" 秒后重试":"，请稍后重试"));
            }
            if(code!=200)throw new IllegalStateException("读取 GitHub 历史失败 HTTP "+code);
            try(InputStream in=c.getInputStream();
                ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buf=new byte[8192];int n;
                while((n=in.read(buf))!=-1){
                    if(out.size()+n>MAX_RESPONSE)throw new IllegalStateException("响应体超出限制");
                    out.write(buf,0,n);
                }
                return new String(out.toByteArray(),StandardCharsets.UTF_8);
            }
        }finally{c.disconnect();}
    }

    static JSONObject list(int page)throws Exception{
        if(page<1||page>50)throw new IllegalArgumentException("版本历史页码无效");
        JSONArray raw=new JSONArray(request("releases?per_page="+PAGE_SIZE+"&page="+page));
        JSONArray entries=new JSONArray();
        for(int i=0;i<raw.length();i++){
            JSONObject r=raw.getJSONObject(i);
            String tag=r.optString("tag_name");
            if(!tag.matches("v0\\.2\\.[0-9]{1,7}")||
                r.optBoolean("draft")||r.optBoolean("prerelease"))continue;
            String body=r.optString("body","");
            if(body.length()>12000)body=body.substring(0,12000)+"\n…（已截断）";
            entries.put(new JSONObject().put("tag",tag)
                .put("date",r.optString("published_at"))
                .put("body",body));
        }
        return new JSONObject().put("type","release_history").put("state","listed")
            .put("page",page).put("has_more",raw.length()==PAGE_SIZE)
            .put("releases",entries);
    }

    static JSONObject changes(String previous,String current)throws Exception{
        if(previous==null||current==null||
            !previous.matches("v0\\.2\\.[0-9]{1,7}")||
            !current.matches("v0\\.2\\.[0-9]{1,7}"))
            throw new IllegalArgumentException("无效 Release 版本");
        JSONObject diff=new JSONObject(request("compare/"+previous+"..."+current));
        JSONArray raw=diff.optJSONArray("commits"),lines=new JSONArray();
        if(raw!=null)for(int i=0;i<Math.min(raw.length(),60);i++){
            JSONObject commit=raw.getJSONObject(i).optJSONObject("commit");
            if(commit==null)continue;
            String msg=commit.optString("message","");
            int n=msg.indexOf('\n');if(n>=0)msg=msg.substring(0,n);
            if(msg.length()>240)msg=msg.substring(0,240)+"…";
            if(!msg.trim().isEmpty())lines.put(msg);
        }
        return new JSONObject().put("type","release_history").put("state","changes")
            .put("previous",previous).put("current",current)
            .put("commits",lines)
            .put("total",diff.optInt("total_commits",lines.length()));
    }
}
