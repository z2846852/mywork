package com.z2846852.bodytrace;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/**
 * On-demand sideload updater. Matches exact old APK SHA to latest Release's
 * direct delta patch, reconstructs a BYTE-IDENTICAL signed target APK, verifies
 * SHA256, package name, version and signing identity, then delegates install to
 * the Android OS package installer (which may request user confirmation).
 *
 * No background installation, root, Accessibility service or silent privileges.
 */
final class ApkUpdateManager {
    interface Reporter { void report(JSONObject status); }
    private static final String REPO="https://github.com/z2846852/mywork";
    private static final String API=
        "https://api.github.com/repos/z2846852/mywork/releases/latest";
    private static final String FULL="BodyTrace-release.apk";
    private static final String MANIFEST="BodyTrace-updates.json";
    private static final long MAX_APK=100L*1024*1024;
    private static final long MAX_PATCH=60L*1024*1024;
    private static final long MAX_JSON=512L*1024;
    private static final int BUFFER=64*1024;

    private final Context context;
    private final File dir;
    private File pendingApk;
    private long pendingVersion;
    // Exact confirmed Release metadata from the user's last version-only check.
    // Only reuse it if newer than the currently installed APK.
    private JSONObject checkedRelease;

    ApkUpdateManager(Context context){
        this.context=context.getApplicationContext();
        this.dir=new File(context.getFilesDir(),"apk_updates");
    }

    private JSONObject status(String state,String message) throws Exception {
        return new JSONObject().put("type","apk_update")
            .put("state",state).put("message",message)
            .put("installed_version",currentVersion());
    }
    private void progress(Reporter listener,String state,String message)throws Exception{
        listener.report(status(state,message));
    }

    long currentVersion() throws Exception {
        PackageInfo pkg=context.getPackageManager().getPackageInfo(context.getPackageName(),0);
        return Build.VERSION.SDK_INT>=28?pkg.getLongVersionCode():pkg.versionCode;
    }

    private static boolean validHash(String s){return s!=null&&s.matches("[0-9a-f]{64}");}
    private static String expectedUrl(String tag,String asset){
        if(!tag.matches("v0\\.2\\.[0-9]{1,7}") ||
           !(FULL.equals(asset)||MANIFEST.equals(asset)||
             asset.matches("BodyTrace-from-v0\\.2\\.[0-9]{1,7}\\.btpatch")))
            throw new IllegalArgumentException("未知的 GitHub 更新资源");
        return REPO+"/releases/download/"+tag+"/"+asset;
    }

    private static String hex(byte[] raw){
        StringBuilder out=new StringBuilder(64);
        for(byte b:raw)out.append(String.format(Locale.ROOT,"%02x",b&0xff));
        return out.toString();
    }

    private static boolean allowedUrl(URL url){
        if(!"https".equalsIgnoreCase(url.getProtocol()))return false;
        String host=url.getHost().toLowerCase(Locale.ROOT);
        return host.equals("api.github.com")||host.equals("github.com")||
            host.equals("release-assets.githubusercontent.com")||
            host.equals("objects.githubusercontent.com");
    }

    private static HttpURLConnection open(String target)throws Exception {
        URL url=new URL(target);
        if(!allowedUrl(url))throw new SecurityException("仅支持 GitHub HTTPS 更新源");
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("User-Agent","BodyTrace-ApkUpdater/1");
        connection.setRequestProperty("Accept","application/vnd.github+json");
        connection.setInstanceFollowRedirects(true);
        if(connection.getResponseCode()!=200){
            int code=connection.getResponseCode();
            String failure="GitHub 下载失败 HTTP "+code;
            if(code==403||code==429){
                String remaining=connection.getHeaderField("X-RateLimit-Remaining");
                String retry=connection.getHeaderField("Retry-After");
                if("0".equals(remaining)){
                    failure="GitHub HTTP "+code+"：公共 API 请求额度耗尽，稍后重试";
                }else if(retry!=null&&retry.matches("[0-9]{1,6}")){
                    failure="GitHub HTTP "+code+"：访问被限流，"+retry+" 秒后再试";
                }else{
                    failure="GitHub HTTP "+code+"：请求被拒绝；可能是限流、网络代理或访问策略";
                }
            }
            connection.disconnect();
            throw new IllegalStateException(failure);
        }
        if(!allowedUrl(connection.getURL())){
            connection.disconnect();
            throw new SecurityException("更新文件跳转到不可信的服务器");
        }
        return connection;
    }

    private byte[] readJson(String url,long limit)throws Exception {
        HttpURLConnection conn=open(url);
        GitHubRequestStats.record(context,"更新索引",conn.getResponseCode());
        try(InputStream in=new BufferedInputStream(conn.getInputStream());
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
            byte[] bytes=new byte[BUFFER];int n;
            while((n=in.read(bytes))!=-1){
                if(out.size()+n>limit)throw new SecurityException("更新索引超出大小限制");
                out.write(bytes,0,n);
            }
            return out.toByteArray();
        }finally{conn.disconnect();}
    }

    /** Resumable download. A partial file is reused only for the same expected SHA256. */
    private void download(String url,File file,long limit,String digest,
            Reporter reporter,String label) throws Exception {
        if(!validHash(digest))throw new SecurityException("缺少更新文件 SHA256");
        File marker=new File(file.getAbsolutePath()+".sha256");
        if(!marker.isFile()||!digest.equals(new String(Files.readAllBytes(marker.toPath()),
                java.nio.charset.StandardCharsets.US_ASCII).trim())){
            Files.deleteIfExists(file.toPath());
            Files.write(marker.toPath(),digest.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        }
        long have=file.isFile()?file.length():0;
        if(have>limit){Files.deleteIfExists(file.toPath());have=0;}
        for(int attempt=0;attempt<3;attempt++){
            HttpURLConnection conn=null;
            try{
                conn=(HttpURLConnection)new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent","BodyTrace-ApkUpdater/1");
                if(have>0)conn.setRequestProperty("Range","bytes="+have+"-");
                int code=conn.getResponseCode();
                GitHubRequestStats.record(context,"APK/补丁下载",code);
                if(!allowedUrl(conn.getURL()))throw new SecurityException("不可信的下载跳转");
                if(code!=200&&code!=206){
                    if(code==403||code==429)
                        throw new IllegalStateException("GitHub HTTP "+code+
                            "：请求受限，请稍后重试或导入本地补丁");
                    throw new IllegalStateException("GitHub 下载 HTTP "+code);
                }
                boolean resume=have>0&&code==206&&
                    conn.getHeaderField("Content-Range")!=null&&
                    conn.getHeaderField("Content-Range").startsWith("bytes "+have+"-");
                if(code==206&&!resume)throw new SecurityException("服务器返回错误的续传区间");
                if(!resume){have=0;Files.deleteIfExists(file.toPath());}
                long length=conn.getContentLengthLong();
                if(length>limit-have)throw new SecurityException("更新文件超过大小限制");
                long read=have,nextNotify=have;
                try(InputStream in=new BufferedInputStream(conn.getInputStream());
                    FileOutputStream out=new FileOutputStream(file,resume)){
                    byte[] bytes=new byte[BUFFER];int n;
                    while((n=in.read(bytes))!=-1){
                        read+=n;
                        if(read>limit)throw new SecurityException("更新文件超过大小限制");
                        out.write(bytes,0,n);
                        if(read>=nextNotify){
                            long total=length>=0?have+length:-1;
                            String percent=total>0?Math.min(100,read*100/total)+"%":
                                String.format(Locale.ROOT,"%.1f MB",read/1048576.0);
                            progress(reporter,"downloading",label+" "+percent);
                            nextNotify=read+512*1024;
                        }
                    }
                    out.getFD().sync();
                }
                if(length>=0&&read-have!=length)
                    throw new java.io.IOException("下载提前中断");
                if(!digest.equals(ApkDeltaPatch.sha256(file))){
                    Files.deleteIfExists(file.toPath());
                    throw new SecurityException("更新文件 SHA256 校验失败");
                }
                Files.deleteIfExists(marker.toPath());
                return;
            }catch(java.io.IOException e){
                have=file.isFile()?file.length():0;
                if(attempt==2)throw new java.io.IOException("下载中断，已保留 "+
                    (have/1024)+" KB，下次继续："+safeError(e),e);
                try{Thread.sleep(attempt==0?2000:5000);}
                catch(InterruptedException interrupted){
                    Thread.currentThread().interrupt();throw interrupted;
                }
            }finally{if(conn!=null)conn.disconnect();}
        }
    }

    private static JSONObject asset(JSONArray assets,String name)throws Exception {
        for(int i=0;i<assets.length();i++){
            JSONObject x=assets.getJSONObject(i);
            if(name.equals(x.optString("name")))return x;
        }
        return null;
    }

    private static String githubDigest(JSONObject asset)throws Exception {
        if(asset==null)throw new IllegalStateException("Release 缺少所需文件");
        String digest=asset.optString("digest","");
        if(!digest.startsWith("sha256:")||!validHash(digest.substring(7)))
            throw new SecurityException("Release 文件没有可信的 SHA256 摘要");
        return digest.substring(7);
    }

    private static String shaFromArchive(Context context,File apk)throws Exception {
        PackageManager pm=context.getPackageManager();
        int flags=Build.VERSION.SDK_INT>=28?
            PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=pm.getPackageArchiveInfo(apk.getAbsolutePath(),flags);
        if(archive==null)throw new SecurityException("更新 APK 无法解析");
        if(!context.getPackageName().equals(archive.packageName))
            throw new SecurityException("更新 APK 的包名不匹配");
        Signature[] signers;
        if(Build.VERSION.SDK_INT>=28){
            if(archive.signingInfo==null)
                throw new SecurityException("更新 APK 未提供签名");
            signers=archive.signingInfo.getApkContentsSigners();
        }else signers=archive.signatures;
        if(signers==null||signers.length==0)
            throw new SecurityException("更新 APK 未提供证书");
        // Avoid Arrays.compareUnsigned: unavailable on some older Android runtimes.
        String[] fingerprints=new String[signers.length];
        for(int i=0;i<signers.length;i++){
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            fingerprints[i]=hex(digest.digest(signers[i].toByteArray()));
        }
        Arrays.sort(fingerprints);
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        for(String fingerprint:fingerprints)
            md.update(fingerprint.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return hex(md.digest());
    }

    private void validateApk(File apk,long expectedVersion,String expectedSha)throws Exception{
        if(!apk.isFile()||apk.length()<=0||apk.length()>MAX_APK||
            !ApkDeltaPatch.sha256(apk).equals(expectedSha))
            throw new SecurityException("还原 APK 的完整 SHA256 不匹配");
        PackageInfo archive=context.getPackageManager().getPackageArchiveInfo(
            apk.getAbsolutePath(),0);
        if(archive==null||!context.getPackageName().equals(archive.packageName))
            throw new SecurityException("新版 APK 包名不匹配");
        long version=Build.VERSION.SDK_INT>=28?
            archive.getLongVersionCode():archive.versionCode;
        if(version!=expectedVersion||version<=currentVersion())
            throw new SecurityException("新版 APK 版本不正确或没有升级");
        String installedSigner=shaFromArchive(context,
            new File(context.getApplicationInfo().sourceDir));
        String targetSigner=shaFromArchive(context,apk);
        if(!installedSigner.equals(targetSigner))
            throw new SecurityException("新版 APK 签名证书与已安装版本不一致");
        // Android's actual PackageInstaller also verifies the APK v2/v3
        // cryptographic signature during installation.
    }

    private File baseApk(){
        return new File(context.getApplicationInfo().sourceDir);
    }

    private static String safeError(Exception e){
        String m=e.getMessage();
        return (m==null||m.isEmpty())?e.getClass().getSimpleName():m;
    }

    /**
     * Cheap read-only version inspection for Settings page navigation.
     * Only the GitHub Release JSON is fetched; no update manifest, patch,
     * APK, file writes or Android installer are involved.
     */
    JSONObject checkVersionsOnly() throws Exception {
        long installed=currentVersion();
        checkedRelease=null;
        GitHubReleaseCache.Snapshot snapshot=new GitHubReleaseCache(context).get(true);
        JSONObject release=snapshot.release;
        String tag=release.getString("tag_name");
        if(!tag.matches("v0\\.2\\.[0-9]{1,7}"))
            throw new SecurityException("GitHub Release 版本格式无效");
        int latest=Integer.parseInt(tag.substring(5));
        if(snapshot.stale)return status("version_deferred",snapshot.note())
            .put("installed_version",installed).put("latest_version",latest);
        if(latest>installed)checkedRelease=release;
        return status(latest>installed?"update_available":"up_to_date",
            latest>installed?"发现新版 v0.2."+latest+"，点击右侧即可升级":
                "当前已经是 GitHub 最新正式版")
            .put("installed_version",installed)
            .put("latest_version",latest);
    }

    /**
     * One click: check, choose applicable direct delta, download, reconstruct,
     * verify, return a ready status. Caller launches system installer on UI.
     */
    private JSONObject staticUpdateIndex()throws Exception {
        byte[] bytes=readJson(REPO+"/releases/latest/download/"+MANIFEST,MAX_JSON);
        JSONObject index=new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
        int version=index.optInt("target_version_code");
        if(index.optInt("schema")!=1||version<=0||
            !FULL.equals(index.optString("apk_asset"))||
            !validHash(index.optString("target_sha256"))||
            index.optJSONArray("patches")==null)
            throw new SecurityException("静态更新索引格式无效");
        return index;
    }

    synchronized JSONObject checkAndPrepare(Reporter reporter)throws Exception {
        long installedVersion=currentVersion();
        JSONObject release=null, staticIndex=null;
        String tag;
        int targetVersion;
        String staticError="";
        try{
            progress(reporter,"checking","正在读取 Release 静态索引（不占用 REST API 额度）…");
            staticIndex=staticUpdateIndex();
            targetVersion=staticIndex.getInt("target_version_code");
            tag="v0.2."+targetVersion;
        }catch(Exception e){
            staticError=safeError(e);
            progress(reporter,"checking","静态索引不可用，尝试 GitHub API："+staticError);
            GitHubReleaseCache.Snapshot snapshot;
            if(checkedRelease!=null&&
                checkedRelease.optString("tag_name").matches("v0\\.2\\.[0-9]{1,7}")&&
                Integer.parseInt(checkedRelease.optString("tag_name").substring(5))>installedVersion)
                snapshot=new GitHubReleaseCache.Snapshot(checkedRelease,false,0);
            else snapshot=new GitHubReleaseCache(context).get(true);
            if(snapshot.stale)
                return status("version_deferred",snapshot.note())
                    .put("latest_version",snapshot.release.optString("tag_name"));
            release=snapshot.release;
            tag=release.getString("tag_name");
            if(!tag.matches("v0\\.2\\.[0-9]{1,7}"))
                throw new SecurityException("GitHub Release 版本格式无效");
            targetVersion=Integer.parseInt(tag.substring(5));
            checkedRelease=release;
        }
        JSONObject result=status("checking","发现最新版 "+tag);
        result.put("latest_version",targetVersion);
        if(targetVersion<=installedVersion){
            checkedRelease=null;
            result.put("state","up_to_date");
            result.put("message","当前已是最新 APK v0.2."+installedVersion);
            return result;
        }
        if(!dir.exists()&&!dir.mkdirs())
            throw new IllegalStateException("无法创建 APK 下载目录");
        JSONArray assets=release==null?null:release.getJSONArray("assets");
        String fullDigest=staticIndex!=null?
            staticIndex.getString("target_sha256"):githubDigest(asset(assets,FULL));
        File staged=new File(dir,"incoming-"+targetVersion+".apk");
        File finalApk=new File(dir,"verified.apk");
        File patchFile=new File(dir,"incoming.btpatch");
        File installed=baseApk();
        boolean patched=false;
        String note="";
        try{
            JSONObject indexAsset=assets==null?null:asset(assets,MANIFEST);
            if(staticIndex!=null||indexAsset!=null){
                String indexDigest=indexAsset==null?null:githubDigest(indexAsset);
                // The Release API is not an independently signed update feed;
                // the SHA check guards bytes in transit and the OS later verifies
                // the installed APK signing certificate.
                byte[] indexBytes=staticIndex==null?readJson(expectedUrl(tag,MANIFEST),MAX_JSON):null;
                if(staticIndex!=null||hex(MessageDigest.getInstance("SHA-256").digest(indexBytes))
                        .equals(indexDigest)){
                    JSONObject index=staticIndex!=null?staticIndex:new JSONObject(new String(indexBytes,
                        java.nio.charset.StandardCharsets.UTF_8));
                    if(index.optInt("schema")==1&&
                        index.optInt("target_version_code")==targetVersion&&
                        fullDigest.equals(index.optString("target_sha256"))&&
                        FULL.equals(index.optString("apk_asset"))){
                        String localDigest=ApkDeltaPatch.sha256(installed);
                        JSONArray patches=index.optJSONArray("patches");
                        if(patches!=null){
                            for(int i=0;i<patches.length();i++){
                                JSONObject entry=patches.getJSONObject(i);
                                if(entry.optInt("from_version_code")!=installedVersion ||
                                    !localDigest.equals(entry.optString("from_sha256")))continue;
                                String filename=entry.optString("asset");
                                String patchDigest=entry.optString("patch_sha256");
                                if(!filename.equals("BodyTrace-from-v0.2."+
                                        installedVersion+".btpatch")||
                                   !validHash(patchDigest))continue;
                                JSONObject patchAsset=assets==null?null:asset(assets,filename);
                                if(assets!=null&&(patchAsset==null||
                                    !patchDigest.equals(githubDigest(patchAsset))))continue;
                                try{
                                    progress(reporter,"checking","已匹配 v0.2."+
                                        installedVersion+" → "+tag+" 差分补丁");
                                    download(expectedUrl(tag,filename),patchFile,MAX_PATCH,
                                        patchDigest,reporter,"差分补丁");
                                    progress(reporter,"applying","正在本地还原已签名 APK…");
                                    Files.deleteIfExists(staged.toPath());
                                    ApkDeltaPatch.apply(installed,patchFile,staged);
                                    if(!ApkDeltaPatch.sha256(staged).equals(fullDigest))
                                        throw new SecurityException("还原结果与最新版不符");
                                    patched=true;
                                    break;
                                }catch(Exception e){
                                    Files.deleteIfExists(staged.toPath());
                                    note="差分补丁不可用，改下载完整 APK（"+
                                        safeError(e)+"）";
                                }finally{
                                    // Preserve incomplete patch only after a transport failure.
                                    if(patched)Files.deleteIfExists(patchFile.toPath());
                                }
                            }
                        }
                    }
                }else note="更新索引校验失败，改下载完整 APK";
            }
            if(!patched){
                progress(reporter,"checking",note.isEmpty()?
                    "未找到可匹配的跨版本差分补丁，下载完整 APK":note);
                download(expectedUrl(tag,FULL),staged,MAX_APK,
                    fullDigest,reporter,"完整 APK");
            }
            progress(reporter,"verifying","正在验证 APK 版本、SHA256 和签名证书…");
            validateApk(staged,targetVersion,fullDigest);
            Files.deleteIfExists(finalApk.toPath());
            if(!staged.renameTo(finalApk))
                throw new IllegalStateException("保存已验证的 APK 失败");
            pendingApk=finalApk;
            pendingVersion=targetVersion;
            result.put("state","ready");
            result.put("method",patched?"delta":"full");
            result.put("message",(patched?"差分更新":"完整 APK")+"已下载并验证，可安装 "+
                tag+"；Android 将弹出系统安装确认。");
            result.put("size_bytes",finalApk.length());
            return result;
        }finally{
            // Partial downloads and their digest markers survive failed attempts.
        }
    }

    /** Offline import: BTDPAT01 carries exact old/new APK SHA256 hashes.
     * No GitHub request is needed; APK package, version and signer are checked.
     */
    synchronized JSONObject prepareLocalPatch(android.net.Uri uri,Reporter reporter)throws Exception {
        if(uri==null||!"content".equals(uri.getScheme()))
            throw new IllegalArgumentException("请选择文件管理器中的 .btpatch 文件");
        if(!dir.exists()&&!dir.mkdirs())
            throw new IllegalStateException("无法创建更新缓存目录");
        File patch=new File(dir,"local-import.btpatch");
        File staged=new File(dir,"local-reconstructed.apk");
        File verified=new File(dir,"verified.apk");
        Files.deleteIfExists(patch.toPath());
        Files.deleteIfExists(staged.toPath());
        try{
            progress(reporter,"applying","正在读取本地补丁，不访问 GitHub…");
            long count=0;
            try(java.io.InputStream input=context.getContentResolver().openInputStream(uri);
                java.io.OutputStream output=new java.io.FileOutputStream(patch)){
                if(input==null)throw new IllegalArgumentException("无法打开补丁文件");
                byte[] buffer=new byte[BUFFER];int n;
                while((n=input.read(buffer))!=-1){
                    count+=n;
                    if(count>MAX_PATCH)throw new SecurityException("补丁超过允许大小");
                    output.write(buffer,0,n);
                }
            }
            if(count<80)throw new SecurityException("补丁文件过短");
            ApkDeltaPatch.apply(baseApk(),patch,staged);
            progress(reporter,"verifying","补丁已还原，正在验证 APK 版本、哈希和签名…");
            PackageInfo archive=context.getPackageManager().getPackageArchiveInfo(
                staged.getAbsolutePath(),0);
            if(archive==null)throw new SecurityException("还原结果不是有效 APK");
            long version=Build.VERSION.SDK_INT>=28?
                archive.getLongVersionCode():archive.versionCode;
            validateApk(staged,version,ApkDeltaPatch.sha256(staged));
            Files.deleteIfExists(verified.toPath());
            if(!staged.renameTo(verified))
                throw new IllegalStateException("保存已验证的 APK 失败");
            pendingApk=verified;
            pendingVersion=version;
            return status("ready","本地差分补丁已验证，准备安装 v0.2."+version)
                .put("method","local_delta").put("latest_version",version);
        }finally{
            Files.deleteIfExists(patch.toPath());
            Files.deleteIfExists(staged.toPath());
        }
    }

    synchronized boolean hasPendingInstall(){
        return pendingApk!=null&&pendingApk.isFile()&&pendingVersion>0;
    }

    synchronized void launchInstaller(Activity activity)throws Exception {
        if(!hasPendingInstall())
            throw new IllegalStateException("尚无已校验的新版 APK");
        if(Build.VERSION.SDK_INT>=26&&
                !activity.getPackageManager().canRequestPackageInstalls()){
            // User must grant "Install unknown apps" for THIS app once.
            Intent settings=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:"+activity.getPackageName()));
            activity.startActivity(settings);
            return;
        }
        String authority=activity.getPackageName()+".apkupdate";
        Uri uri=new Uri.Builder().scheme("content").authority(authority)
            .appendPath("verified.apk").build();
        Intent install=new Intent(Intent.ACTION_INSTALL_PACKAGE);
        install.setDataAndType(uri,"application/vnd.android.package-archive");
        install.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(install);
    }
}
