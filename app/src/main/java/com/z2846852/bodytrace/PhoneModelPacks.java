package com.z2846852.bodytrace;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Independent model-only GitHub Release installer.
 *
 * All model binaries remain in app-private /files/voice_models, NOT in APK or
 * the UI-only update ZIP. Installed packs survive in-place APK upgrades.
 * Download is explicit, size-bounded, GitHub SHA-256 verified, then each
 * model/token file is verified against the package's embedded metadata.
 *
 * This is a product-specific fixed allowlist; no arbitrary URLs or local paths.
 */
final class PhoneModelPacks {
    interface Reporter { void report(JSONObject event); }
    static final String ACOUSTIC="acoustic";
    static final String[] IDS={
        "zipa-cr-small-300k","zipa-cr-small-500k","zipa-cr-small-ns-700k"};
    static final String[] LABELS={
        "ZIPA CTC 300k · 基础版","ZIPA CTC 500k · 强化版",
        "ZIPA CTC NS 700k · 非商业研究版"};
    static final String[] LICENSES={"CC BY 4.0","CC BY 4.0","CC BY-NC-SA 4.0"};
    private static final String REPO="https://github.com/z2846852/mywork";
    private static final String RELEASE_API=
        "https://api.github.com/repos/z2846852/mywork/releases/tags/voice-models-v1";
    private static final String RELEASE_TAG="voice-models-v1";
    private static final long MAX_PACK=300L*1024*1024;
    private static final long MAX_MODEL=280L*1024*1024;
    private final Context context;
    private final File root;
    private final Map<String,String> verifiedStamps=new HashMap<>();
    private int lexiconCount=-1;

    PhoneModelPacks(Context ctx){
        context=ctx.getApplicationContext();
        root=new File(context.getFilesDir(),"voice_models");
    }
    static boolean known(String id){
        for(String candidate:IDS)if(candidate.equals(id))return true;
        return false;
    }
    static String archiveFor(String id){
        if(!known(id))throw new IllegalArgumentException("未知的模型 ID");
        return "VoicePhone-"+id+".zip";
    }
    File modelDir(String id){
        return known(id)?new File(root,id):null;
    }
    private static String stamp(File file){
        return file.length()+":"+file.lastModified();
    }
    /**
     * First check per process verifies the installed files against pack.json.
     * Repeated checks reuse a private-file size/mtime fingerprint. The marker
     * alone is insufficient evidence of a complete model.
     */
    synchronized boolean installed(String id){
        File dir=modelDir(id);
        if(dir==null)return false;
        File ready=new File(dir,".ready");
        File meta=new File(dir,"pack.json");
        File model=new File(dir,"model.int8.onnx");
        File tokens=new File(dir,"tokens.txt");
        if(!ready.isFile()||!meta.isFile()||!model.isFile()||!tokens.isFile()||
            model.length()<=10*1024*1024||tokens.length()<=10)return false;
        String signature=stamp(ready)+"/"+stamp(meta)+"/"+stamp(model)+"/"+stamp(tokens);
        if(signature.equals(verifiedStamps.get(id)))return true;
        try{
            if(!id.equals(new String(java.nio.file.Files.readAllBytes(
                    ready.toPath()),StandardCharsets.UTF_8)))return false;
            JSONObject manifest=new JSONObject(new String(java.nio.file.Files.readAllBytes(
                    meta.toPath()),StandardCharsets.UTF_8));
            if(manifest.optInt("schema")!=1||!id.equals(manifest.optString("id"))||
                !"sherpa-onnx/offline-zipformer-ctc".equals(manifest.optString("runtime")))
                return false;
            JSONObject files=manifest.getJSONObject("files");
            for(String name:new String[]{"model.int8.onnx","tokens.txt"}){
                File file=new File(dir,name);
                JSONObject entry=files.getJSONObject(name);
                String hash=entry.optString("sha256");
                if(!hash.matches("[0-9a-f]{64}")||
                    file.length()!=entry.getLong("size")||!sha256(file).equals(hash))
                    return false;
            }
            verifiedStamps.put(id,signature);
            return true;
        }catch(Exception invalid){return false;}
    }
    private synchronized int lexiconEntries(){
        if(lexiconCount>=0)return lexiconCount;
        int rows=0;
        try(BufferedReader in=new BufferedReader(new InputStreamReader(
                new GZIPInputStream(context.getAssets().open("en_pronunciation_zh.tsv.gz")),
                StandardCharsets.UTF_8))){
            String line;
            while((line=in.readLine())!=null&&rows<=100000){
                if(line.split("\\t",4).length!=4)
                    throw new IllegalStateException("词典记录损坏");
                rows++;
            }
        }catch(Exception invalid){return lexiconCount=0;}
        return lexiconCount=rows>=10000&&rows<=100000?rows:0;
    }
    synchronized String selected(){
        String id=context.getSharedPreferences("voice_lab_models",0)
            .getString("selected",ACOUSTIC);
        return known(id)&&installed(id)?id:ACOUSTIC;
    }
    synchronized JSONObject state(String message)throws Exception {
        JSONObject status=new JSONObject().put("type","voice_models")
            .put("state","listed").put("message",message)
            .put("selected",selected())
            .put("weights_in_apk",false)
            .put("release_url",REPO+"/releases/tag/"+RELEASE_TAG);
        JSONArray choices=new JSONArray();
        int complete=0;
        for(int i=0;i<IDS.length;i++){
            String id=IDS[i];File model=modelDir(id);
            boolean valid=installed(id);
            if(valid)complete++;
            choices.put(new JSONObject().put("id",id).put("title",LABELS[i])
                .put("license",LICENSES[i])
                .put("installed",valid)
                .put("size_bytes",valid?
                    new File(model,"model.int8.onnx").length():0)
                .put("asset",archiveFor(id)));
        }
        int entries=lexiconEntries();
        status.put("models",choices)
            .put("installed_count",complete).put("total_count",IDS.length)
            .put("complete",complete==IDS.length&&entries>0)
            .put("dictionary_ready",entries>0)
            .put("dictionary_entries",entries);
        return status;
    }
    synchronized void select(String id)throws Exception {
        if(!(ACOUSTIC.equals(id)||(known(id)&&installed(id))))
            throw new IllegalArgumentException("模型未安装，无法选择");
        context.getSharedPreferences("voice_lab_models",0).edit()
            .putString("selected",id).apply();
    }
    synchronized void delete(String id)throws Exception {
        if(!known(id))throw new IllegalArgumentException("未知模型");
        if(selected().equals(id))select(ACOUSTIC);
        remove(modelDir(id));
        verifiedStamps.remove(id);
    }
    private static void remove(File f){
        if(f==null||!f.exists())return;
        if(f.isDirectory()){
            File[] files=f.listFiles();
            if(files!=null)for(File x:files)remove(x);
        }
        if(!f.delete())throw new IllegalStateException("删除失败："+f.getName());
    }
    private static String sha256(File file)throws Exception {
        MessageDigest d=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new BufferedInputStream(new FileInputStream(file))){
            byte[] buf=new byte[65536];int n;
            while((n=in.read(buf))!=-1)d.update(buf,0,n);
        }
        StringBuilder h=new StringBuilder();
        for(byte x:d.digest())h.append(String.format(Locale.ROOT,"%02x",x&255));
        return h.toString();
    }
    private static boolean allowed(URL url){
        if(!"https".equalsIgnoreCase(url.getProtocol()))return false;
        String host=url.getHost().toLowerCase(Locale.ROOT);
        return host.equals("api.github.com")||host.equals("github.com")||
            host.equals("release-assets.githubusercontent.com")||
            host.equals("objects.githubusercontent.com");
    }
    private static HttpURLConnection open(String str)throws Exception{
        URL url=new URL(str);
        if(!allowed(url))throw new SecurityException("非法模型下载源");
        HttpURLConnection conn=(HttpURLConnection)url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(90000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent","BodyTrace-PhoneModels/1");
        conn.setRequestProperty("Accept","application/vnd.github+json");
        if(conn.getResponseCode()!=200){
            int code=conn.getResponseCode();conn.disconnect();
            throw new IllegalStateException("网络或模型包未就绪，HTTP "+code);
        }
        if(!allowed(conn.getURL())){
            conn.disconnect();throw new SecurityException("模型下载重定向不可信");
        }
        return conn;
    }
    private static JSONObject fetchRelease()throws Exception{
        HttpURLConnection conn=open(RELEASE_API);
        try(InputStream in=conn.getInputStream()){
            java.io.ByteArrayOutputStream b=new java.io.ByteArrayOutputStream();
            byte[] buf=new byte[4096];int n;
            while((n=in.read(buf))!=-1){
                if(b.size()+n>384*1024)throw new SecurityException("模型清单过大");
                b.write(buf,0,n);
            }
            return new JSONObject(new String(b.toByteArray(),StandardCharsets.UTF_8));
        }finally{conn.disconnect();}
    }
    private JSONObject progress(String state,String message,String id,int percent)throws Exception {
        return new JSONObject().put("type","voice_models").put("state",state)
            .put("id",id).put("message",message).put("percent",percent);
    }

    void install(String id,Reporter listener)throws Exception{
        install(id,listener,true);
    }
    private void install(String id,Reporter listener,boolean emitFinal)throws Exception{
        if(!known(id))throw new IllegalArgumentException("未知模型");
        if(installed(id)){
            if(emitFinal)listener.report(state("模型已安装，无需重复下载"));
            return;
        }
        listener.report(progress("checking","正在检查独立模型 Release…",id,0));
        JSONObject release=fetchRelease();
        if(!RELEASE_TAG.equals(release.optString("tag_name")))
            throw new SecurityException("模型资源不是固定的独立 Release");
        String assetName=archiveFor(id);
        JSONObject asset=null;JSONArray assets=release.getJSONArray("assets");
        for(int i=0;i<assets.length();i++){
            JSONObject candidate=assets.getJSONObject(i);
            if(assetName.equals(candidate.optString("name"))){asset=candidate;break;}
        }
        if(asset==null)throw new IllegalStateException("GitHub Release 尚未包含："+assetName);
        String digest=asset.optString("digest","");
        if(!digest.matches("sha256:[0-9a-f]{64}"))
            throw new SecurityException("模型 Release 缺少可验证 SHA256");
        long expectedSize=asset.optLong("size",0);
        if(expectedSize<1024*1024||expectedSize>MAX_PACK)
            throw new SecurityException("模型包大小超出上限");
        if(!root.isDirectory()&&!root.mkdirs())
            throw new IllegalStateException("无法创建模型目录");
        File zip=new File(root,id+".download");
        File tmp=new File(root,id+".installing");
        try {
            if(tmp.exists())remove(tmp);
            HttpURLConnection conn=open(REPO+"/releases/download/"+RELEASE_TAG+"/"+assetName);
            try(InputStream in=new BufferedInputStream(conn.getInputStream());
                FileOutputStream raw=new FileOutputStream(zip);
                BufferedOutputStream out=new BufferedOutputStream(raw)){
                byte[] bytes=new byte[65536];int n;long total=0,next=0;
                while((n=in.read(bytes))!=-1){
                    total+=n;
                    if(total>MAX_PACK||total>expectedSize)
                        throw new SecurityException("模型下载字节数超限");
                    out.write(bytes,0,n);
                    if(total>=next){
                        int percent=(int)(total*100/expectedSize);
                        listener.report(progress("downloading","模型下载中 "+percent+"%",id,percent));
                        next=total+1024*1024;
                    }
                }
                out.flush();raw.getFD().sync();
                if(total!=expectedSize)throw new IllegalStateException("模型包不完整");
            }finally{conn.disconnect();}
            if(!sha256(zip).equals(digest.substring(7)))
                throw new SecurityException("模型包 SHA256 校验失败");
            if(!tmp.mkdirs())throw new IllegalStateException("模型解包目录不可用");
            boolean meta=false,onnx=false,tokens=false;
            long sum=0;
            try(ZipInputStream in=new ZipInputStream(new FileInputStream(zip))){
                ZipEntry entry;
                while((entry=in.getNextEntry())!=null){
                    String name=entry.getName();
                    if(entry.isDirectory()||
                       !("pack.json".equals(name)||"model.int8.onnx".equals(name)||
                         "tokens.txt".equals(name)))
                        throw new SecurityException("模型压缩包含未知文件");
                    long cap="model.int8.onnx".equals(name)?MAX_MODEL:
                        "tokens.txt".equals(name)?2*1024*1024:64*1024;
                    File outFile=new File(tmp,name);
                    if(outFile.exists())throw new SecurityException("重复的模型文件");
                    try(FileOutputStream out=new FileOutputStream(outFile)){
                        byte[] buffer=new byte[65536];int n;long count=0;
                        while((n=in.read(buffer))!=-1){
                            count+=n;sum+=n;
                            if(count>cap||sum>MAX_PACK)
                                throw new SecurityException("模型解压超过限制");
                            out.write(buffer,0,n);
                        }
                        out.getFD().sync();
                    }
                    if("pack.json".equals(name))meta=true;
                    if("model.int8.onnx".equals(name))onnx=true;
                    if("tokens.txt".equals(name))tokens=true;
                    in.closeEntry();
                }
            }
            if(!meta||!onnx||!tokens)
                throw new SecurityException("模型压缩包缺少必需的文件");
            byte[] raw=java.nio.file.Files.readAllBytes(new File(tmp,"pack.json").toPath());
            JSONObject manifest=new JSONObject(new String(raw,StandardCharsets.UTF_8));
            if(manifest.optInt("schema")!=1||!id.equals(manifest.optString("id"))||
               !"sherpa-onnx/offline-zipformer-ctc".equals(manifest.optString("runtime")))
                throw new SecurityException("模型包类型与 ID 不匹配");
            JSONObject files=manifest.getJSONObject("files");
            for(String name:new String[]{"model.int8.onnx","tokens.txt"}){
                JSONObject info=files.getJSONObject(name);
                String hash=info.getString("sha256");
                File file=new File(tmp,name);
                if(!hash.matches("[0-9a-f]{64}")||
                   file.length()!=info.getLong("size")||
                   !sha256(file).equals(hash))
                    throw new SecurityException(name+" 模型内部 SHA256 校验失败");
            }
            try(FileOutputStream ready=new FileOutputStream(new File(tmp,".ready"))){
                ready.write(id.getBytes(StandardCharsets.UTF_8));
                ready.getFD().sync();
            }
            File dest=modelDir(id);
            if(dest.exists())remove(dest);
            verifiedStamps.remove(id);
            if(!tmp.renameTo(dest))
                throw new IllegalStateException("模型目录原子安装失败");
            select(id);
            listener.report(progress("installed","已安装并启用："+id,id,100));
            if(emitFinal)listener.report(state("模型已安装在手机本地；未来升级 APK 不需重新下载"));
        }finally{
            if(zip.exists())zip.delete();
            if(tmp.exists())remove(tmp);
        }
    }

    /** One-tap offline setup: install every missing model without redownloading good files. */
    void installAll(Reporter listener)throws Exception{
        StringBuilder failures=new StringBuilder();
        for(String id:IDS){
            if(installed(id))continue;
            try{
                install(id,listener,false);
            }catch(Exception issue){
                if(failures.length()>0)failures.append("；");
                failures.append(id).append("：").append(issue.getMessage());
            }
        }
        // 500k is the standard CC BY model; NS 700k has noncommercial licensing.
        if(installed(IDS[1]))select(IDS[1]);
        else if(installed(IDS[0]))select(IDS[0]);
        else if(installed(IDS[2]))select(IDS[2]);
        int complete=0;
        for(String id:IDS)if(installed(id))complete++;
        listener.report(state("模型检查完成："+complete+"/3 已完整"+
            (failures.length()>0?"；失败："+failures:"")));
    }
}
