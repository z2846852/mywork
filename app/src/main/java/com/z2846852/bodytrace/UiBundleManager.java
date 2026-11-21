package com.z2846852.bodytrace;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Explicit, offline-first UI bundle updates. No dynamic Java/dex/model updates.
 * UI bundles have a pinned native-content fingerprint, per-file SHA256 and hard
 * archive limits. Unusable updates revert to the complete APK-bundled UI.
 *
 * IMPORTANT: These bundled JS files have the privileged BodyTraceNative bridge.
 * Fetch ONLY from the project's own GitHub Release and never from arbitrary URLs.
 */
final class UiBundleManager {
    private static final String REPO="https://github.com/z2846852/mywork";
    private static final String LATEST_API=
        "https://api.github.com/repos/z2846852/mywork/releases/latest";
    private static final String ARCHIVE="BodyTrace-ui.zip";
    private static final int ZIP_LIMIT=2*1024*1024;
    private static final int UNPACKED_LIMIT=3*1024*1024;
    private static final int FILE_LIMIT=1024*1024;
    private static final String[] NAMES={
        "index.html","features.css","wheel.js","features.js",
        "exercise_catalog.js","git_log.js","sleep.js","sleep_visualization.js","voice_lab.js"
    };
    private static final Set<String> ACCEPTED=Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(NAMES)));
    private final Context context;
    private final SharedPreferences prefs;
    private final File root;
    private final JSONObject base;
    private File activeDir;
    private JSONObject activeManifest;
    private boolean rolledBack=false;

    UiBundleManager(Context context) throws Exception {
        this.context=context.getApplicationContext();
        this.prefs=this.context.getSharedPreferences("bodytrace_ui_bundle",Context.MODE_PRIVATE);
        this.root=new File(this.context.getFilesDir(),"ui_bundle");
        try(InputStream in=this.context.getAssets().open("ui_base.json")){
            base=new JSONObject(new String(readBounded(in,8192),StandardCharsets.UTF_8));
        }
        if(base.optInt("schema")!=1 || !hash(base.optString("native_sha256")))
            throw new IllegalStateException("UI 更新器版本信息缺失");
    }

    private static boolean hash(String v){return v!=null&&v.matches("[0-9a-f]{64}");}
    private int bundledVersion(){return base.optInt("release_number",0);}
    private String nativeHash(){return base.optString("native_sha256","");}
    synchronized void prepareBoot() {
        activeDir=null;activeManifest=null;
        // After an incomplete JS boot, return to the signed APK's embedded UI.
        if(prefs.getBoolean("boot_pending",false)){
            clearActive();
            rolledBack=true;
        }
        File pointer=new File(root,"active.json");
        try{
            if(!pointer.isFile())return;
            JSONObject m=new JSONObject(new String(Files.readAllBytes(pointer.toPath()),
                    StandardCharsets.UTF_8));
            int version=m.getInt("release_number");
            if(version<=bundledVersion() || !nativeHash().equals(m.optString("native_sha256"))){
                clearActive();return;
            }
            File dir=new File(root,"version-"+version);
            verifyFiles(dir,m);
            activeDir=dir;activeManifest=m;
            if(!prefs.edit().putBoolean("boot_pending",true).commit())
                throw new IllegalStateException("无法写入界面启动检查状态");
        }catch(Exception ignored){
            clearActive();
            rolledBack=true;
        }
    }

    synchronized void markReady(){
        if(activeDir!=null)prefs.edit().putBoolean("boot_pending",false).apply();
    }

    synchronized String readOverride(String name) throws Exception {
        if(!ACCEPTED.contains(name)||activeDir==null)return null;
        File file=new File(activeDir,name);
        return new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);
    }

    synchronized JSONObject status() throws Exception {
        JSONObject j=new JSONObject();
        j.put("type","ui_update");
        j.put("state",rolledBack?"rolled_back":"current");
        j.put("base_version",bundledVersion());
        j.put("ui_version",activeManifest==null?bundledVersion():
              activeManifest.optInt("release_number"));
        j.put("message",rolledBack?"上次界面包未能正常启动，已自动回退到内置界面。":
            "仅界面 HTML/CSS/JS 可小包更新；原生代码或 AI 模型变更仍需安装完整 APK。");
        return j;
    }

    synchronized void rollback() {
        clearActive();
        rolledBack=true;
    }

    private void clearActive() {
        try{Files.deleteIfExists(new File(root,"active.json").toPath());}
        catch(Exception ignored){}
        prefs.edit().putBoolean("boot_pending",false).commit();
        activeDir=null;activeManifest=null;
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] raw=MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder b=new StringBuilder(64);
        for(byte value:raw)b.append(String.format(java.util.Locale.ROOT,"%02x",value&0xff));
        return b.toString();
    }

    private static byte[] readBounded(InputStream stream,int max) throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        byte[] buffer=new byte[8192];int count;
        while((count=stream.read(buffer))!=-1){
            if(out.size()+count>max)throw new IllegalArgumentException("界面更新包超出大小限制");
            out.write(buffer,0,count);
        }
        return out.toByteArray();
    }

    private static byte[] download(String url,int maximum) throws Exception {
        if(!url.startsWith("https://"))
            throw new IllegalArgumentException("只允许 HTTPS 下载");
        HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent","BodyTrace-UiUpdater/1");
        connection.setRequestProperty("Accept","application/vnd.github+json");
        connection.setInstanceFollowRedirects(true);
        try{
            if(connection.getResponseCode()!=200)
                throw new IllegalStateException("GitHub HTTP "+connection.getResponseCode());
            if(!"https".equalsIgnoreCase(connection.getURL().getProtocol()))
                throw new IllegalStateException("不安全的更新重定向");
            try(InputStream in=connection.getInputStream()){
                return readBounded(in,maximum);
            }
        }finally{connection.disconnect();}
    }

    private static void verifyFiles(File dir,JSONObject manifest) throws Exception {
        if(manifest.optInt("schema")!=1 || manifest.optInt("release_number")<1)
            throw new IllegalArgumentException("无效界面版本清单");
        JSONObject files=manifest.getJSONObject("files");
        if(files.length()!=NAMES.length)throw new IllegalArgumentException("界面文件数量错误");
        for(String name:NAMES){
            String expected=files.getString(name);
            if(!hash(expected))throw new IllegalArgumentException("文件哈希无效: "+name);
            File file=new File(dir,name);
            if(!file.isFile()||file.length()<=0||file.length()>FILE_LIMIT)
                throw new IllegalArgumentException("界面文件缺失: "+name);
            if(!expected.equals(sha256(Files.readAllBytes(file.toPath()))))
                throw new IllegalArgumentException("界面文件校验失败: "+name);
        }
    }

    private static void removeTree(File file) {
        if(file.isDirectory()){
            File[] children=file.listFiles();
            if(children!=null)for(File child:children)removeTree(child);
        }
        file.delete();
    }

    private static void storePointer(File root,JSONObject manifest) throws Exception {
        AtomicFile atomic=new AtomicFile(new File(root,"active.json"));
        FileOutputStream stream=null;
        try{
            stream=atomic.startWrite();
            stream.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(stream);
        }catch(Exception e){
            if(stream!=null)atomic.failWrite(stream);
            throw e;
        }
    }

    /**
     * Called ONLY on the serial background worker after the user clicks update.
     * The server's release number alone never authorizes new native code.
     */
    synchronized JSONObject fetchLatest() throws Exception {
        JSONObject result=status();
        JSONObject release=new JSONObject(new String(download(LATEST_API,256*1024),
                StandardCharsets.UTF_8));
        String tag=release.getString("tag_name");
        if(!tag.matches("v0\\.2\\.[0-9]{1,7}"))
            throw new IllegalArgumentException("无法识别的发布版本号");
        int latest=Integer.parseInt(tag.substring(5));
        result.put("latest_version",latest);
        if(latest<=Math.max(bundledVersion(),
                activeManifest==null?0:activeManifest.optInt("release_number"))){
            result.put("state","up_to_date");
            result.put("message","当前已是最新界面版本。");
            return result;
        }
        JSONArray assets=release.getJSONArray("assets");
        JSONObject asset=null;
        for(int i=0;i<assets.length();i++){
            JSONObject candidate=assets.getJSONObject(i);
            if(ARCHIVE.equals(candidate.optString("name"))){asset=candidate;break;}
        }
        if(asset==null)throw new IllegalStateException("该 Release 未提供增量界面包");
        String expectedUrl=REPO+"/releases/download/"+tag+"/"+ARCHIVE;
        if(!expectedUrl.equals(asset.getString("browser_download_url")))
            throw new SecurityException("拒绝非官方 Release 资源链接");
        byte[] packed=download(expectedUrl,ZIP_LIMIT);
        String assetDigest=asset.optString("digest","");
        if(!assetDigest.isEmpty()&&!("sha256:"+sha256(packed)).equals(assetDigest))
            throw new SecurityException("GitHub Release SHA256 校验失败");

        if(!root.isDirectory()&&!root.mkdirs())
            throw new IllegalStateException("界面缓存目录创建失败");
        File staging=new File(root,"staging-"+latest);
        removeTree(staging);
        if(!staging.mkdir())throw new IllegalStateException("临时更新目录创建失败");
        JSONObject manifest=null;
        boolean installed=false;
        try{
            int unpacked=0;
            Set<String> seen=new HashSet<>();
            try(ZipInputStream zip=new ZipInputStream(
                    new java.io.ByteArrayInputStream(packed))){
                ZipEntry entry;
                while((entry=zip.getNextEntry())!=null){
                    String name=entry.getName();
                    if(entry.isDirectory()||
                      !(ACCEPTED.contains(name)||name.equals("manifest.json"))||
                      !seen.add(name)){
                        throw new SecurityException("不允许的界面包条目: "+name);
                    }
                    byte[] bytes=readBounded(zip,FILE_LIMIT);
                    unpacked+=bytes.length;
                    if(unpacked>UNPACKED_LIMIT)
                        throw new IllegalArgumentException("解压后界面包过大");
                    if(name.equals("manifest.json")){
                        manifest=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
                    }else{
                        try(FileOutputStream out=new FileOutputStream(new File(staging,name))){
                            out.write(bytes);
                        }
                    }
                    zip.closeEntry();
                }
            }
            if(manifest==null || seen.size()!=NAMES.length+1)
                throw new IllegalArgumentException("更新包内容不完整");
            if(manifest.optInt("release_number")!=latest||
               !tag.equals("v0.2."+manifest.optInt("release_number")))
                throw new SecurityException("版本号与 Release 不一致");
            if(!release.getString("target_commitish").equals(manifest.optString("revision")))
                throw new SecurityException("界面包提交与 GitHub 发布记录不一致");
            if(!nativeHash().equals(manifest.optString("native_sha256"))){
                result.put("state","requires_apk");
                result.put("message","最新版包含 Java/AI 模型等原生变更，无法仅更新界面，需要安装完整 APK。");
                return result;
            }
            verifyFiles(staging,manifest);
            File destination=new File(root,"version-"+latest);
            removeTree(destination);
            if(!staging.renameTo(destination))
                throw new IllegalStateException("界面包写入失败");
            storePointer(root,manifest);
            installed=true;
            result.put("state","downloaded");
            result.put("ui_version",latest);
            result.put("bytes",packed.length);
            result.put("message","已下载并校验界面增量包（"+packed.length+
                " 字节）。点击「重新加载界面」生效，录音和训练数据不受影响。");
            return result;
        }finally{
            if(!installed)removeTree(staging);
        }
    }
}
