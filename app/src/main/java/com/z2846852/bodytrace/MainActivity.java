package com.z2846852.bodytrace;

import android.annotation.SuppressLint;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.media.MediaPlayer;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.database.Cursor;
import android.provider.OpenableColumns;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native networking, local encrypted state and offline-first training event queue. */
public final class MainActivity extends Activity {
    private WebView web;
    private UiBundleManager uiBundles;
    private ApkUpdateManager apkUpdates;
    private volatile boolean awaitingApkInstallerPermission=false;
    private volatile boolean awaitingPhoneUsagePermission=false;
    private static final int SLEEP_AUDIO_PERMISSION_REQUEST=7203;
    private static final int VOICE_LAB_MIC_PERMISSION_REQUEST=7206;
    private static final int SLEEP_FEEDBACK_PERMISSION_REQUEST=7207;
    private static final int SLEEP_MONITOR_PERMISSION_REQUEST=7208;
    private VoiceLabController voiceLab;
    private IpaSamplePlayer ipaSamplePlayer;
    // Whole example words use Google audio with local cache and system TTS fallback.
    private ExampleSpeechPlayer exampleSpeechPlayer;
    private PhoneModelPacks phoneModels;
    private String pendingVoiceLabMode="";
    private static final int PICK_SLEEP_AUDIO_REQUEST=7204;
    private static final int EXPORT_SLEEP_AUDIO_REQUEST=7205;
    private String pendingSleepExportId="";
    private static final long SLEEP_IMPORT_MAX_BYTES=2L*1024*1024*1024; // 2 GiB
    private String pendingSleepStart="";
    private final Handler sleepHandler=new Handler(Looper.getMainLooper());
    private MediaPlayer sleepPlayer;
    private Runnable stopPlayback;
    private final java.util.ArrayList<int[]> playbackRanges=new java.util.ArrayList<>();
    private int playbackIndex=0;
    private String playbackSessionId="";
    private boolean playbackSkipping=false;
    // Actual decoder clock, rather than a JS timer, drives the red waveform playhead.
    private static final long PLAYBACK_POSITION_POLL_MS=220L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SecureStore vault;
    private JsonStore plain;
    private boolean migrated = false;
    private final GitHubApi github = new GitHubApi();
    private static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);
    private static final int PICK_AVATAR_REQUEST = 7005;
    private static final int PICK_APK_PATCH_REQUEST = 7210;
    private static final int AVATAR_MAX_BYTES = 12 * 1024 * 1024;
    private volatile Uri pendingSharedAvatar = null;
    private volatile boolean uiReady = false;
    private final BroadcastReceiver sleepAnalysisReceiver=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            String raw=intent.getStringExtra(SleepAnalysisService.EXTRA_JSON);
            if(raw==null)return;
            try{
                JSONObject event=new JSONObject(raw);
                if("sleep_analysis_ready".equals(event.optString("type"))){
                    String id=event.getString("id");
                    int threshold=event.getInt("threshold");
                    int minimum=event.getInt("minimum");
                    int gap=event.getInt("gap");
                    worker.execute(()->deliverSleepAnalysis(id,threshold,minimum,gap));
                }else{
                    reply(event);
                    if("error".equals(event.optString("type")))
                        worker.execute(MainActivity.this::sendSleepStatus);
                }
            }catch(Exception ignored){}
        }
    };

    @Override @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        // Do not resurrect a stale WebView/task snapshot after APK replacement.
        // UI navigation and the user draft are restored from durable preferences.
        super.onCreate(null);
        IntentFilter analysisFilter=new IntentFilter(SleepAnalysisService.ACTION_EVENT);
        if(Build.VERSION.SDK_INT>=33)
            registerReceiver(sleepAnalysisReceiver,analysisFilter,Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(sleepAnalysisReceiver,analysisFilter);
        pendingSharedAvatar = sharedImageUri(getIntent());
        getWindow().setStatusBarColor(Color.rgb(13, 17, 23));
        getWindow().setNavigationBarColor(Color.rgb(13, 17, 23));
        vault = new SecureStore(getApplicationContext());
        plain = new JsonStore(getApplicationContext());
        apkUpdates=new ApkUpdateManager(this);
        phoneModels=new PhoneModelPacks(this);
        voiceLab=new VoiceLabController(this,this::reply,phoneModels);
        ipaSamplePlayer=new IpaSamplePlayer(this,detail->{
            try{reply(message("voice_sample_audio").put("message",detail));}
            catch(Exception ignored){}
        });
        try {
            uiBundles=new UiBundleManager(this);
            uiBundles.prepareBoot();
        }catch(Exception ignored){
            // Embedded signed-APK UI is always a complete offline fallback.
            uiBundles=null;
        }
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true); // Only local trusted HTML; network is performed in native Java.
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true; // Never navigate to a remote page with the privileged bridge.
            }
            @Override public boolean onRenderProcessGone(WebView view,
                    android.webkit.RenderProcessGoneDetail detail) {
                // Android WebView renderer death normally closes the host app
                // unless explicitly handled. Keep a one-time local diagnostic.
                BodyTraceApp.record(MainActivity.this,"WebView renderer",
                    detail.didCrash()?"renderer crashed":"renderer terminated");
                if(view.getParent() instanceof android.view.ViewGroup)
                    ((android.view.ViewGroup)view.getParent()).removeView(view);
                view.destroy();
                web=null;uiReady=false;
                android.content.SharedPreferences p=getSharedPreferences(
                    "bodytrace_renderer_recovery",MODE_PRIVATE);
                long now=System.currentTimeMillis();
                long last=p.getLong("last_ms",0L);
                int attempts=(now-last<60_000L?p.getInt("attempts",0):0)+1;
                p.edit().putLong("last_ms",now).putInt("attempts",attempts).apply();
                if(attempts<=2){
                    new Handler(Looper.getMainLooper()).post(()->{
                        if(!isFinishing()&&!isDestroyed())recreate();
                    });
                }else{
                    android.widget.TextView failure=new android.widget.TextView(MainActivity.this);
                    failure.setText("界面启动异常。请从桌面重新打开，必要时到日志页查看本机诊断。");
                    failure.setTextSize(17);
                    failure.setPadding(36,60,36,36);
                    setContentView(failure);
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "BodyTraceNative");
        setContentView(web);
        try {
            String html = readUiAsset("index.html");
            // Only user-approved SHA256-verified UI updates can override these.
            // The APK remains fully functional offline and without any patch.
            String css = readUiAsset("features.css");
            String js = readUiAsset("wheel.js") + "\n" + readUiAsset("features.js") +
                    "\n" + readUiAsset("exercise_catalog.js") + "\n" + readUiAsset("git_log.js") + "\n" + readUiAsset("sleep.js") + "\n" + readUiAsset("rest_timer.js") + "\n" + readUiAsset("sleep_visualization.js") + "\n" + readUiAsset("voice_lab.js");
            html = html.replace("</head>", "<style>" + css + "</style></head>");
            // The friendly cartoon avatar is a local SVG; no heavy GLB or
            // third-party scripts are loaded in the 2D release.
            html = html.replace("</body>", "<script>" + js + "</script></body>");
            // Basic body schematic is generated locally as lightweight SVG.
            // Historical imported images remain stored, but are not displayed.
            web.loadDataWithBaseURL("https://bodytrace.invalid/", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            web.loadData("<h1>本地界面加载失败</h1>", "text/html", "UTF-8");
        }
    }

    // Android share sheet: users can share the downloaded cartoon image
    // directly from a gallery or file app. Only an image URI is consumed.
    private static Uri sharedImageUri(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return null;
        Object shared = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return shared instanceof Uri ? (Uri) shared : null;
    }

    private void consumePendingSharedAvatar() {
        Uri image = pendingSharedAvatar;
        pendingSharedAvatar = null;
        if (image == null) return;
        try {
            importAvatar(image);
        } catch (Exception e) {
            error("分享图片导入失败：" + safeMessage(e));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri image = sharedImageUri(intent);
        if (image == null) return;
        pendingSharedAvatar = image;
        if (uiReady) worker.execute(this::consumePendingSharedAvatar);
    }

    private static final class AvatarResource {
        final byte[] bytes;
        final String mime;
        AvatarResource(byte[] bytes, String mime) {
            this.bytes = bytes;
            this.mime = mime;
        }
    }

    private File avatarDirectory() {
        return new File(getFilesDir(), "resource_library/avatar");
    }

    private AvatarResource activeAvatar() throws Exception {
        File folder = avatarDirectory();
        File pointer = new File(folder, "current.txt");
        if (pointer.isFile()) {
            byte[] nameBytes = java.nio.file.Files.readAllBytes(pointer.toPath());
            String currentName = new String(nameBytes, StandardCharsets.UTF_8).trim();
            if (currentName.matches("sha256-[0-9a-f]{64}\\.(png|jpg|webp)")) {
                File stored = new File(folder, currentName);
                if (stored.isFile() && stored.length() > 0 && stored.length() <= AVATAR_MAX_BYTES) {
                    byte[] bytes = java.nio.file.Files.readAllBytes(stored.toPath());
                    return new AvatarResource(bytes, sniffAvatarMime(bytes));
                }
            }
        }
        return new AvatarResource(readAssetBytes("avatar_cartoon_cutout.svg"), "image/svg+xml");
    }

    private static String sniffAvatarMime(byte[] bytes) {
        if (bytes.length >= 8 && (bytes[0] & 255) == 0x89 &&
                bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') return "image/png";
        if (bytes.length >= 3 && (bytes[0] & 255) == 0xFF &&
                (bytes[1] & 255) == 0xD8 && (bytes[2] & 255) == 0xFF) return "image/jpeg";
        if (bytes.length >= 12 && bytes[0]=='R' && bytes[1]=='I' &&
                bytes[2]=='F' && bytes[3]=='F' &&
                bytes[8]=='W' && bytes[9]=='E' && bytes[10]=='B' && bytes[11]=='P')
            return "image/webp";
        throw new IllegalArgumentException("请选择有效 PNG / JPEG / WebP 图像");
    }

    private void importAvatar(Uri uri) throws Exception {
        if (uri == null) throw new IllegalArgumentException("没有选择图片");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalArgumentException("无法读取图片");
            byte[] buffer = new byte[8192];
            int n;
            while ((n = input.read(buffer)) != -1) {
                if (output.size() + n > AVATAR_MAX_BYTES) {
                    throw new IllegalArgumentException("图片超过12MB；请使用不超过12MB的原图");
                }
                output.write(buffer, 0, n);
            }
        }
        byte[] bytes = output.toByteArray();
        String mime = sniffAvatarMime(bytes);
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xFF));
        String suffix = "image/png".equals(mime) ? "png" :
                "image/webp".equals(mime) ? "webp" : "jpg";
        String name = "sha256-" + hex + "." + suffix;
        File folder = avatarDirectory();
        if (!folder.isDirectory() && !folder.mkdirs())
            throw new IllegalStateException("创建角色资源目录失败");
        File dest = new File(folder, name);
        if (!dest.isFile()) {
            File tmp = File.createTempFile("incoming-", ".tmp", folder);
            try {
                try (OutputStream stream = new FileOutputStream(tmp)) {
                    stream.write(bytes);
                    stream.flush();
                }
                if (!tmp.renameTo(dest)) throw new IllegalStateException("保存角色图失败");
            } finally {
                if (tmp.exists()) tmp.delete();
            }
        }
        File pointerTemp = File.createTempFile("current-", ".tmp", folder);
        try {
            try (OutputStream stream = new FileOutputStream(pointerTemp)) {
                stream.write(name.getBytes(StandardCharsets.UTF_8));
            }
            File pointer = new File(folder, "current.txt");
            if (pointer.isFile() && !pointer.delete())
                throw new IllegalStateException("切换当前人物图失败");
            if (!pointerTemp.renameTo(pointer))
                throw new IllegalStateException("保存当前人物图引用失败");
        } finally {
            if (pointerTemp.exists()) pointerTemp.delete();
        }
        // Only the active resource is shown; older versions stay on disk.
        JSONObject result = message("avatar_imported");
        result.put("mime", mime);
        result.put("base64", android.util.Base64.encodeToString(
                bytes, android.util.Base64.NO_WRAP));
        result.put("sha256", hex.toString());
        result.put("size_bytes", bytes.length);
        reply(result);
    }

    private void openVerifiedApkInstaller(){
        try{
            if(!apkUpdates.hasPendingInstall())
                throw new IllegalStateException("尚无已验证的更新 APK");
            boolean requiresPermission=Build.VERSION.SDK_INT>=26&&
                !getPackageManager().canRequestPackageInstalls();
            if(requiresPermission){
                awaitingApkInstallerPermission=true;
                reply(message("apk_update").put("state","requires_permission")
                    .put("message","需要允许本 APP 安装未知来源应用，授权后将继续打开系统安装确认。"));
            }
            apkUpdates.launchInstaller(MainActivity.this);
        }catch(Exception e){
            awaitingApkInstallerPermission=false;
            try{reply(message("apk_update").put("state","error")
                .put("message","打开系统安装器失败："+safeMessage(e)));}
            catch(Exception ignored){}
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(resultCode!=RESULT_OK){
            if(requestCode==PICK_SLEEP_AUDIO_REQUEST){
                pendingSleepStart="";
                reply(message("sleep_import_cancelled"));
            }else if(requestCode==EXPORT_SLEEP_AUDIO_REQUEST){
                pendingSleepExportId="";
            }
            return;
        }
        Uri uri=data==null?null:data.getData();
        if(requestCode==PICK_APK_PATCH_REQUEST){
            if(uri==null){error("未选择差分补丁");return;}
            worker.execute(()->{
                try{
                    JSONObject status=apkUpdates.prepareLocalPatch(uri,MainActivity.this::reply);
                    reply(status);
                    if("ready".equals(status.optString("state")))
                        runOnUiThread(()->openVerifiedApkInstaller());
                }catch(Exception e){
                    try{reply(message("apk_update").put("state","error")
                        .put("message","本地补丁安装失败："+safeMessage(e)));}
                    catch(Exception ignored){}
                }
            });
            return;
        }
        if(requestCode==EXPORT_SLEEP_AUDIO_REQUEST){
            String sourceId=pendingSleepExportId;
            pendingSleepExportId="";
            if(uri==null||sourceId.isEmpty()){
                error("录音导出失败：未选择目标文件");
                return;
            }
            worker.execute(()->{
                try{
                    SleepSessions.verifyId(sourceId);
                    JSONObject meta=SleepSessions.loadMetadata(this,sourceId);
                    if(SleepSessions.isExternal(meta))
                        throw new IllegalArgumentException("外部导入音频不需要重复导出");
                    File source=SleepSessions.audio(this,sourceId);
                    if(!source.isFile()||source.length()<=1024)
                        throw new IllegalStateException("APP 原始录音不存在或无效");
                    long bytes=0;
                    try(InputStream in=new FileInputStream(source);
                        OutputStream out=getContentResolver().openOutputStream(uri,"w")){
                        if(out==null)throw new IllegalStateException("无法写入目标文件");
                        byte[] buffer=new byte[65536];int size;
                        while((size=in.read(buffer))!=-1){
                            out.write(buffer,0,size);bytes+=size;
                        }
                        out.flush();
                    }
                    if(bytes!=source.length())
                        throw new IllegalStateException("录音导出大小不一致");
                    reply(message("sleep_exported").put("id",sourceId)
                        .put("bytes",bytes));
                }catch(Exception e){
                    error("睡眠录音导出失败："+safeMessage(e));
                }
            });
            return;
        }
        if(requestCode==PICK_SLEEP_AUDIO_REQUEST){
            String reportedStart=pendingSleepStart;
            pendingSleepStart="";
            try{
                if(uri==null || !"content".equals(uri.getScheme()))
                    throw new IllegalArgumentException("请选择有效音频文档");
                // ACTION_OPEN_DOCUMENT: persist read-only access over reboot;
                // never request write/delete access to the original file.
                getContentResolver().takePersistableUriPermission(
                    uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
                worker.execute(()->{
                    try{importSleepAudio(uri,reportedStart);}
                    catch(Exception failure){error("睡眠录音导入失败："+safeMessage(failure));}
                });
            }catch(Exception e){
                error("无法永久读取所选录音，请从系统文件管理器重新选择："+safeMessage(e));
            }
            return;
        }
        if(requestCode!=PICK_AVATAR_REQUEST)return;
        worker.execute(() -> {
            try { importAvatar(uri); }
            catch (Exception failure){error("导入高清人物图失败：" + safeMessage(failure));}
        });
    }


    /**
     * ACTION_OPEN_DOCUMENT grants a persistable read-only content URI.
     * Do NOT copy an 8-hour 400 MB file to private storage. The original audio
     * is never written, moved or deleted by this import flow.
     */
    private void importSleepAudio(Uri uri,String reportedStart) throws Exception {
        if(uri==null || !"content".equals(uri.getScheme()))
            throw new IllegalArgumentException("请选择有效的本机音频文件");
        String duplicate=SleepSessions.findExternalByUri(this,uri);
        if(!duplicate.isEmpty()){
            JSONObject existing=SleepSessions.load(this,duplicate);
            JSONObject msg=message("sleep_imported");
            msg.put("id",duplicate).put("bytes",existing.optLong("original_bytes",0));
            msg.put("already_exists",true);
            reply(msg);
            sendSleepStatus();
            return;
        }
        String filename="录音";
        long knownSize=-1;
        try(Cursor cursor=getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){
            if(cursor!=null&&cursor.moveToFirst()){
                int nameCol=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeCol=cursor.getColumnIndex(OpenableColumns.SIZE);
                if(nameCol>=0&&!cursor.isNull(nameCol))filename=cursor.getString(nameCol);
                if(sizeCol>=0&&!cursor.isNull(sizeCol))knownSize=cursor.getLong(sizeCol);
            }
        }
        if(filename==null)filename="录音";
        if(filename.length()>100)filename=filename.substring(0,100);
        String lower=filename.toLowerCase(java.util.Locale.ROOT);
        String ext=lower.contains(".")?lower.substring(lower.lastIndexOf('.')+1):"";
        if(!ext.matches("mp3|m4a|mp4|wav|ogg|opus|flac|3gp|aac|amr")){
            String mime=getContentResolver().getType(uri);
            if("audio/mpeg".equals(mime))ext="mp3";
            else if("audio/wav".equals(mime)||"audio/x-wav".equals(mime))ext="wav";
            else if("audio/flac".equals(mime))ext="flac";
            else if("audio/ogg".equals(mime))ext="ogg";
            else if("audio/mp4".equals(mime)||"audio/x-m4a".equals(mime))ext="m4a";
            else throw new IllegalArgumentException("不支持的音频格式。请选择 MP3/M4A/WAV/FLAC/OGG 等文件");
        }
        if(knownSize>SLEEP_IMPORT_MAX_BYTES)
            throw new IllegalArgumentException("录音超过2 GB读取上限");
        long importedAt=System.currentTimeMillis();
        String id=importedAt+"-"+UUID.randomUUID().toString().substring(0,8);
        long duration=0;
        // Read audio track metadata directly through the document provider.
        // This does not copy the source file into app-private storage.
        MediaExtractor extractor=new MediaExtractor();
        try{
            extractor.setDataSource(this,uri,null);
            boolean audioTrack=false;
            for(int i=0;i<extractor.getTrackCount();i++){
                MediaFormat format=extractor.getTrackFormat(i);
                String mime=format.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("audio/")){
                    audioTrack=true;
                    if(format.containsKey(MediaFormat.KEY_DURATION))
                        duration=Math.max(0,format.getLong(MediaFormat.KEY_DURATION)/1000L);
                    break;
                }
            }
            if(!audioTrack)throw new IllegalArgumentException("文件没有可解码的音轨");
        }finally{extractor.release();}
        long startTime=importedAt;
        String dateBasis="imported_at";
        // The media date may actually be the FILE FINALIZATION TIME. Prefer
        // the strongly structured YYYYMMDD_HHMMSS filename when present.
        Long embeddedDate=readEmbeddedMediaDate(uri);
        SleepRecordingTime.Guess filenameGuess=SleepRecordingTime.infer(
            filename,duration,embeddedDate,importedAt);
        if(filenameGuess!=null){
            startTime=filenameGuess.startMillis;
            dateBasis=filenameGuess.basis;
        }else if(embeddedDate!=null){
            startTime=embeddedDate;
            dateBasis="media_date_unverified";
        }
        // The user's explicit recording-start time takes precedence over all estimates.
        if(reportedStart!=null&&!reportedStart.trim().isEmpty()){
            LocalDateTime local=LocalDateTime.parse(reportedStart.trim(),
                DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            startTime=local.toInstant(BEIJING).toEpochMilli();
            dateBasis="user_supplied";
        }
        JSONObject session=new JSONObject();
        session.put("id",id).put("started_ms",startTime)
            .put("ended_ms",startTime+duration)
            .put("duration_ms",duration)
            .put("imported_ms",importedAt)
            .put("date_basis",dateBasis)
            .put("media_date_checked",true)
            .put("filename_time_checked",true)
            .put("media_date_role",filenameGuess!=null&&filenameGuess.mediaLooksLikeEnd?
                "likely_end":"unverified")
            .put("media_date_ms",embeddedDate==null?JSONObject.NULL:embeddedDate)
            .put("source","saf-document")
            .put("source_uri",uri.toString())
            .put("original_name",filename)
            .put("original_bytes",Math.max(0,knownSize))
            .put("audio_extension",ext)
            .put("status","completed");
        SleepSessions.write(this,session);
        JSONObject msg=message("sleep_imported");
        msg.put("id",id).put("bytes",Math.max(0,knownSize));
        msg.put("copied",false);
        reply(msg);
        sendSleepStatus();
    }

    /**
     * Extract the embedded date only when the file explicitly includes a
     * timezone. Neither SAF LAST_MODIFIED nor import time is recording start.
     * MediaMetadataRetriever.DATE may represent creation OR modification.
     */
    private Long readEmbeddedMediaDate(Uri uri){
        MediaMetadataRetriever retriever=new MediaMetadataRetriever();
        try{
            retriever.setDataSource(this,uri);
            return parseEmbeddedMediaDate(
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE));
        }catch(Exception ignored){
            return null;
        }finally{
            try{retriever.release();}catch(Exception ignored){}
        }
    }

    private static Long parseEmbeddedMediaDate(String value){
        if(value==null||value.trim().isEmpty())return null;
        String raw=value.trim();
        try{
            java.time.Instant instant;
            if(raw.matches("[0-9]{8}T[0-9]{6}(\\.[0-9]+)?Z")){
                String compact=raw.replaceFirst("\\.[0-9]+Z$","Z");
                LocalDateTime t=LocalDateTime.parse(compact,
                    DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'"));
                instant=t.toInstant(ZoneOffset.UTC);
            }else{
                instant=OffsetDateTime.parse(raw).toInstant();
            }
            long millis=instant.toEpochMilli();
            // Reject placeholder 1904/1970 timestamps and impossible futures.
            if(millis<946684800000L||
                    millis>System.currentTimeMillis()+86400000L)return null;
            return millis;
        }catch(Exception ignored){
            return null;
        }
    }

    private byte[] readAssetBytes(String name) throws Exception {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[4096];
            int count;
            while ((count = in.read(bytes)) > 0) out.write(bytes, 0, count);
            return out.toByteArray();
        }
    }

    private String readUiAsset(String name) throws Exception {
        if(uiBundles!=null){
            String updated=uiBundles.readOverride(name);
            if(updated!=null)return updated;
        }
        return readAsset(name);
    }

    private String readAsset(String name) throws Exception {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void reply(JSONObject object) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(
                    object.optString("type").startsWith("sleep_feedback_")?
                        "window.bodyTraceReceiveFeedback && window.bodyTraceReceiveFeedback("+object.toString()+")":
                        "window.bodyTraceReceive && window.bodyTraceReceive(" + object.toString() + ")", null);
        });
    }

    private JSONObject message(String kind) {
        JSONObject j = new JSONObject();
        try { j.put("type", kind); } catch (Exception ignored) { }
        return j;
    }

    private void error(String message) {
        try {
            JSONObject j = message("error");
            j.put("message", message);
            reply(j);
        } catch (Exception ignored) { }
    }

    /**
     * One-time metadata migration. The small session JSON is updated in place;
     * the original audio, 8-hour RMS envelope and cached YAMNet scores remain.
     * Manual user-supplied starts are never overwritten.
     */
    private void updateImportedTimeGuess(JSONObject session) throws Exception {
        if(!SleepSessions.isExternal(session)||
                "user_supplied".equals(session.optString("date_basis"))||
                session.optBoolean("filename_time_checked",false))return;
        String id=session.getString("id");
        JSONObject meta=SleepSessions.loadMetadata(this,id);
        if("user_supplied".equals(meta.optString("date_basis"))||
                meta.optBoolean("filename_time_checked",false))return;
        Long mediaDate=meta.isNull("media_date_ms")?null:
                (meta.has("media_date_ms")?meta.optLong("media_date_ms"):null);
        // For files imported by the previous app, media_date_unverified was
        // incorrectly stored as started_ms. Treat it as media DATE instead.
        if(mediaDate==null&&"media_date_unverified".equals(meta.optString("date_basis")))
            mediaDate=meta.optLong("started_ms",0);
        if(mediaDate!=null&&mediaDate<=0)mediaDate=null;
        if(mediaDate==null){
            try{mediaDate=readEmbeddedMediaDate(SleepSessions.externalUri(meta));}
            catch(Exception ignored){/* Filename may still be sufficient. */}
        }
        long duration=meta.optLong("duration_ms",0);
        SleepRecordingTime.Guess guess=SleepRecordingTime.infer(
            meta.optString("original_name",""),duration,mediaDate,
            System.currentTimeMillis());
        if(guess!=null){
            meta.put("started_ms",guess.startMillis);
            meta.put("ended_ms",guess.startMillis+duration);
            meta.put("date_basis",guess.basis);
            meta.put("media_date_role",guess.mediaLooksLikeEnd?"likely_end":"unverified");
        }else if("imported_at".equals(meta.optString("date_basis"))&&mediaDate!=null){
            meta.put("started_ms",mediaDate);
            meta.put("ended_ms",mediaDate+duration);
            meta.put("date_basis","media_date_unverified");
        }
        meta.put("media_date_checked",true);
        meta.put("filename_time_checked",true);
        if(mediaDate!=null)meta.put("media_date_ms",mediaDate);
        SleepSessions.write(this,meta);
        session.put("started_ms",meta.optLong("started_ms"));
        session.put("date_basis",meta.optString("date_basis"));
        session.put("media_date_role",meta.optString("media_date_role",""));
    }

    /** Load cached envelope on the regular worker only AFTER decoding is done.
     * Large (8h+) arrays must never cross Android's Broadcast/Intent Binder limit. */
    private void deliverSleepAnalysis(String sessionId,int threshold,int minimum,int gap){
        try{
            SleepSessions.verifyId(sessionId);
            JSONObject session=SleepSessions.load(this,sessionId);
            // Upgrade existing cached imports without repeating YAMNet analysis.
            // A previously imported media DATE can be the recording END, so
            // re-evaluate it against the filename even when media_date_checked=true.
            updateImportedTimeGuess(session);
            JSONArray levels=session.optJSONArray("levels_dbfs");
            JSONArray peaks=session.optJSONArray("peak_levels_dbfs");
            JSONArray shortLevels=session.optJSONArray("short_levels_dbfs");
            JSONArray aiScores=session.optJSONArray("ai_snore_scores");
            JSONArray speechScores=session.optJSONArray("ai_speech_scores");
            if(levels==null||peaks==null||levels.length()!=peaks.length())
                throw new IllegalStateException("音频分析缓存不存在，请重新分析");
            if(shortLevels!=null&&shortLevels.length()!=levels.length())shortLevels=null;
            if(aiScores!=null&&aiScores.length()!=levels.length())aiScores=null;
            if(speechScores!=null&&speechScores.length()!=levels.length())speechScores=null;
            JSONArray events=SleepAudioAnalyzer.detect(levels,shortLevels,threshold,minimum,gap);
            JSONObject answer=message("sleep_analysis");
            answer.put("id",sessionId);
            answer.put("started_ms",session.optLong("started_ms"));
            answer.put("date_basis",session.optString("date_basis",
                SleepSessions.isExternal(session)?"imported_at":"recorded_at"));
            answer.put("original_name",session.optString("original_name",""));
            answer.put("total_seconds",levels.length());
            answer.put("levels_dbfs",levels);
            answer.put("peak_levels_dbfs",peaks);
            if(shortLevels!=null)answer.put("short_levels_dbfs",shortLevels);
            if(aiScores!=null){
                answer.put("ai_snore_scores",aiScores);
                if(speechScores!=null)answer.put("ai_speech_scores",speechScores);
                answer.put("ai_model",session.optString("ai_model",""));
            }
            answer.put("threshold_dbfs",threshold);
            answer.put("minimum_seconds",minimum);
            answer.put("gap_seconds",gap);
            answer.put("events",events);
            reply(answer);
            sendSleepStatus();
        }catch(Exception e){error("睡眠录音分析结果读取失败："+safeMessage(e));}
    }

    private void sendPhoneSleepReports(){
        try{reply(new PhoneSleepHistory(this).scanAllRetainedEvents());}
        catch(Exception failure){
            try{reply(message("phone_sleep").put("state","error")
                .put("message","手机行为报告生成失败："+safeMessage(failure)));}
            catch(Exception ignored){}
        }
    }

    private void sendSleepStatus() {
        try {
            JSONObject result=message("sleep_status");
            result.put("recording",SleepRecorderService.isRecording());
            result.put("active_id",SleepRecorderService.currentSessionId());
            result.put("analysis_running",SleepAnalysisService.isRunning());
            result.put("analysis_id",SleepAnalysisService.currentId());
            result.put("analysis_percent",SleepAnalysisService.currentProgress());
            android.content.SharedPreferences last=getSharedPreferences(
                "bodytrace_sleep_analysis",MODE_PRIVATE);
            result.put("last_analysis_id",last.getString("last_id",""));
            result.put("sessions",SleepSessions.list(this));
            reply(result);
            reply(SleepRecorderService.feedbackStatus(this));
        }catch(Exception e){error("读取睡眠记录失败："+safeMessage(e));}
    }
    private void startSleepCapture() {
        if(SleepRecorderService.isRecording()){worker.execute(this::sendSleepStatus);return;}
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            error("没有麦克风权限，无法开始睡眠录音");return;
        }
        try{
            Intent service=new Intent(this,SleepRecorderService.class).setAction(SleepRecorderService.ACTION_START);
            startForegroundService(service);
            sleepHandler.postDelayed(()->worker.execute(this::sendSleepStatus),1300);
        }catch(Exception e){error("启动前台录音失败："+safeMessage(e));}
    }
    private void startMicMonitor() {
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            error("麦克风权限未开启，不能监听");return;
        }
        try {
            startForegroundService(new Intent(this,SleepRecorderService.class)
                .setAction(SleepRecorderService.ACTION_MONITOR_ON));
            sleepHandler.postDelayed(()->worker.execute(()->{
                try{reply(SleepRecorderService.feedbackStatus(this));}
                catch(Exception ignored){}
            }),650);
        }catch(Exception e){error("麦克风监听失败："+safeMessage(e));}
    }
    private void startSnoreFeedback() {
        if(SleepRecorderService.isFeedbackEnabled()){
            worker.execute(()->{
                try{reply(SleepRecorderService.feedbackStatus(this));}catch(Exception ignored){}
            });return;
        }
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            error("没有麦克风权限，无法启动实时反馈");return;
        }
        try{
            startForegroundService(new Intent(this,SleepRecorderService.class)
                .setAction(SleepRecorderService.ACTION_FEEDBACK_ON));
            sleepHandler.postDelayed(()->worker.execute(()->{
                try{reply(SleepRecorderService.feedbackStatus(this));}catch(Exception ignored){}
            }),1100);
        }catch(Exception e){error("无法启动鼾声反馈："+safeMessage(e));}
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        if(requestCode==VOICE_LAB_MIC_PERMISSION_REQUEST){
            String requested=pendingVoiceLabMode;
            pendingVoiceLabMode="";
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==
                    PackageManager.PERMISSION_GRANTED){
                if("phoneme".equals(requested)){
                    try{reply(message("voice_lab").put("mode","phoneme")
                        .put("state","permission_ready")
                        .put("message","麦克风权限已开启，请再次按住录音按钮"));}
                    catch(Exception ignored){}
                }else voiceLab.start(requested);
            }else try{
                reply(message("voice_lab").put("state","error")
                    .put("message","麦克风权限被拒绝，实时声音实验未启动"));
            }catch(Exception ignored){}
            return;
        }
        if(requestCode==SLEEP_MONITOR_PERMISSION_REQUEST){
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
                startMicMonitor();
            else error("麦克风权限未开启，监听未启动");
            return;
        }
        if(requestCode==SLEEP_FEEDBACK_PERMISSION_REQUEST){
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
                startSnoreFeedback();
            else error("麦克风权限被拒绝，实时反馈未启动");
            return;
        }
        if(requestCode!=SLEEP_AUDIO_PERMISSION_REQUEST)return;
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
            startSleepCapture();
        else error("麦克风授权被拒绝，未启动录音");
    }
    @Override protected void onResume(){
        super.onResume();
        if(uiReady)worker.execute(this::sendSleepStatus);
        if(awaitingPhoneUsagePermission){
            awaitingPhoneUsagePermission=false;
            worker.execute(this::sendPhoneSleepReports);
        }
        if(awaitingApkInstallerPermission&&apkUpdates!=null&&
            apkUpdates.hasPendingInstall()&&
            (Build.VERSION.SDK_INT<26||
                getPackageManager().canRequestPackageInstalls())){
            awaitingApkInstallerPermission=false;
            // The user has explicitly returned from the per-app install
            // permission screen. Android still confirms the APK installation.
            sleepHandler.post(()->{
                try{apkUpdates.launchInstaller(this);}
                catch(Exception e){error("打开系统安装器失败："+safeMessage(e));}
            });
        }
    }
    private void playbackEvent(boolean playing,int startSec){
        if(playbackSessionId.isEmpty())return;
        try{
            JSONObject msg=message("sleep_playback");
            msg.put("id",playbackSessionId);
            msg.put("playing",playing);
            msg.put("start_sec",startSec);
            msg.put("position_ms",Math.max(0,startSec)*1000L);
            msg.put("segment_index",playbackIndex+1);
            msg.put("total_segments",playbackRanges.size());
            msg.put("skip",playbackSkipping);
            reply(msg);
        }catch(Exception ignored){}
    }

    /** Poll the actual MediaPlayer clock. Android's media seek may be
     * approximate; never synthesize playback progress with wall time. */
    private void playbackPosition(int positionMs){
        if(playbackSessionId.isEmpty())return;
        try{
            JSONObject msg=message("sleep_playback_position");
            msg.put("id",playbackSessionId);
            msg.put("playing",true);
            msg.put("position_ms",Math.max(0,positionMs));
            msg.put("segment_index",playbackIndex+1);
            msg.put("total_segments",playbackRanges.size());
            msg.put("skip",playbackSkipping);
            reply(msg);
        }catch(Exception ignored){}
    }

    private void stopSleepPlayback(){
        if(stopPlayback!=null){sleepHandler.removeCallbacks(stopPlayback);stopPlayback=null;}
        if(sleepPlayer!=null){
            try{sleepPlayer.stop();}catch(Exception ignored){}
            try{sleepPlayer.release();}catch(Exception ignored){}
            sleepPlayer=null;
        }
        playbackEvent(false,-1);
        playbackRanges.clear();
        playbackSessionId="";
        playbackIndex=0;
        playbackSkipping=false;
    }

    /** Seek through validated ranges inside one MediaPlayer. No PCM copies and
     * no JS timers; backgrounded WebView cannot interrupt event advancement. */
    private void playNextRange(MediaPlayer player){
        if(sleepPlayer!=player)return;
        if(stopPlayback!=null){sleepHandler.removeCallbacks(stopPlayback);stopPlayback=null;}
        if(playbackIndex>=playbackRanges.size()){stopSleepPlayback();return;}
        int[] range=playbackRanges.get(playbackIndex);
        player.seekTo(range[0]*1000);
    }

    private void beginRangePlayback(String sessionId,java.util.ArrayList<int[]> ranges,
            boolean skip) throws Exception {
        stopSleepPlayback();
        JSONObject session=SleepSessions.loadMetadata(this,sessionId);
        playbackSessionId=sessionId;
        playbackRanges.addAll(ranges);
        playbackIndex=0;
        playbackSkipping=skip;
        MediaPlayer player=new MediaPlayer();
        sleepPlayer=player;
        SleepSessions.configurePlayer(this,session,player);
        player.setOnErrorListener((m,what,extra)->{
            stopSleepPlayback();
            error("录音播放器无法继续：媒体解码或定位失败");
            return true;
        });
        player.setOnCompletionListener(m->{
            if(sleepPlayer!=m)return;
            playbackIndex++;
            playNextRange(m);
        });
        player.setOnPreparedListener(this::playNextRange);
        player.setOnSeekCompleteListener(m->{
            if(sleepPlayer!=m||playbackIndex>=playbackRanges.size())return;
            int[] segment=playbackRanges.get(playbackIndex);
            m.start();
            playbackEvent(true,segment[0]);
            stopPlayback=new Runnable(){
                @Override public void run(){
                    if(sleepPlayer!=m||playbackIndex>=playbackRanges.size())return;
                    try{
                        int actualPosition=m.getCurrentPosition();
                        // Stop at the requested end based on PLAYBACK position,
                        // not a wall-time delay that drifts after a slow seek.
                        if(actualPosition>=segment[1]*1000L||!m.isPlaying()){
                            if(m.isPlaying())m.pause();
                            playbackIndex++;
                            playNextRange(m);
                            return;
                        }
                        playbackPosition(actualPosition);
                        sleepHandler.postDelayed(this,PLAYBACK_POSITION_POLL_MS);
                    }catch(IllegalStateException badState){
                        stopSleepPlayback();
                        error("录音播放状态异常："+safeMessage(badState));
                    }
                }
            };
            sleepHandler.post(stopPlayback);
        });
        player.prepareAsync();
    }

    private JSONArray localDays() throws Exception {
        return plain.getDays();
    }

    /** Migrate old encrypted JSON once; leave PAT encrypted in Keystore. */
    private void ensureMigrated() throws Exception {
        if (migrated) return;
        String oldDays = vault.read("daily_json");
        if (oldDays != null) {
            JSONArray combined = mergeDays(plain.getDays(), new JSONArray(oldDays));
            plain.putDays(combined);
            vault.delete("daily_json");
        }
        String oldPending = vault.read("pending");
        if (oldPending != null) {
            JSONArray combined = plain.getPending();
            java.util.HashSet<String> ids = new java.util.HashSet<>();
            for (int i = 0; i < combined.length(); ++i) {
                ids.add(combined.getJSONObject(i).optString("id", ""));
            }
            JSONArray old = new JSONArray(oldPending);
            for (int i = 0; i < old.length(); ++i) {
                JSONObject row = old.getJSONObject(i);
                if (ids.add(row.optString("id", ""))) combined.put(row);
            }
            plain.putPending(combined);
            vault.delete("pending");
        }
        String oldRaw = vault.read("raw_entries");
        if (oldRaw != null) {
            JSONArray combined = plain.getRaw();
            java.util.HashSet<String> ids = new java.util.HashSet<>();
            for (int i = 0; i < combined.length(); ++i) {
                ids.add(combined.getJSONObject(i).optString("id", ""));
            }
            JSONArray old = new JSONArray(oldRaw);
            for (int i = 0; i < old.length(); ++i) {
                JSONObject row = old.getJSONObject(i);
                if (ids.add(row.optString("id", ""))) combined.put(row);
            }
            plain.putRaw(combined);
            vault.delete("raw_entries");
        }
        plain.putView(ViewProjector.project(plain.getDays()));
        migrated = true;
    }

    private void replyData(JSONArray days, boolean cached) throws Exception {
        JSONObject view = ViewProjector.project(days);
        plain.putView(view);
        JSONObject result = message("data");
        result.put("days", days);
        result.put("view_model", view);
        result.put("cached", cached);
        reply(result);
    }


    /** A daily array is a local encrypted snapshot, not a CSV or derived chart. */
    private static JSONArray appendLocal(JSONArray days, JSONObject event) throws Exception {
        String date = event.getString("date");
        JSONObject current = null;
        for (int i = 0; i < days.length(); ++i) {
            JSONObject item = days.getJSONObject(i);
            if (date.equals(item.optString("date"))) {
                current = item;
                break;
            }
        }
        if (current == null) {
            current = new JSONObject();
            current.put("schema_version", 2);
            current.put("date", date);
            current.put("workouts", new JSONArray());
            current.put("measurements", new JSONArray());
            current.put("nutrition", new JSONArray());
            days.put(current);
        }
        String type = event.optString("type");
        String category = "nutrition".equals(type) ? "nutrition" :
                "measurement".equals(type) ? "measurements" :
                "workout_edit".equals(type) ? "workout_edits" : "workouts";
        JSONArray entries = current.optJSONArray(category);
        if (entries == null) {
            entries = new JSONArray();
            current.put(category, entries);
        }
        for (int i = 0; i < entries.length(); ++i) {
            if (event.getString("id").equals(entries.getJSONObject(i).optString("id"))) {
                return days;
            }
        }
        JSONObject row = new JSONObject(event.toString());
        row.remove("schema_version");
        row.remove("date");
        row.remove("type");
        entries.put(row);
        return days;
    }

    /** Remote values win on the same UUID; locally saved/unsynced UUIDs survive pull. */
    private static JSONArray mergeDays(JSONArray local, JSONArray remote) throws Exception {
        java.util.TreeMap<String, JSONObject> merged = new java.util.TreeMap<>();
        for (int pass = 0; pass < 2; ++pass) {
            JSONArray source = pass == 0 ? local : remote;
            for (int i = 0; i < source.length(); ++i) {
                JSONObject incoming = source.getJSONObject(i);
                String date = incoming.getString("date");
                JSONObject existing = merged.get(date);
                if (existing == null) {
                    merged.put(date, new JSONObject(incoming.toString()));
                    continue;
                }
                // Preserve future optional root fields added by ChatGPT.
                // Remote wins on matching keys, arrays below merge by UUID.
                java.util.Iterator<String> keys = incoming.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    if (!key.equals("workouts") && !key.equals("measurements")
                            && !key.equals("nutrition") && !key.equals("workout_edits")) {
                        existing.put(key, incoming.get(key));
                    }
                }
                for (String category : new String[]{"workouts", "measurements", "nutrition", "workout_edits"}) {
                    java.util.LinkedHashMap<String, JSONObject> byId = new java.util.LinkedHashMap<>();
                    JSONArray oldItems = existing.optJSONArray(category);
                    JSONArray newItems = incoming.optJSONArray(category);
                    if (oldItems != null) {
                        for (int n = 0; n < oldItems.length(); ++n) {
                            JSONObject row = oldItems.getJSONObject(n);
                            String id = row.optString("id", "");
                            if (id.isEmpty()) id = "local:" + n;
                            byId.put(id, row);
                        }
                    }
                    if (newItems != null) {
                        for (int n = 0; n < newItems.length(); ++n) {
                            JSONObject row = newItems.getJSONObject(n);
                            String id = row.optString("id", "");
                            if (id.isEmpty()) id = "remote:" + n;
                            byId.put(id, row);
                        }
                    }
                    JSONArray combined = new JSONArray();
                    for (JSONObject row : byId.values()) combined.put(row);
                    existing.put(category, combined);
                }
            }
        }
        JSONArray result = new JSONArray();
        for (JSONObject day : merged.values()) result.put(day);
        return result;
    }

    /** Device-global display preference, not stored in the workout catalog
     * or private GitHub repo. Persists between relaunches and APK upgrades. */
    private void sendUiPreferences(){
        try{
            android.content.SharedPreferences p=getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE);
            JSONObject event=message("ui_preferences");
            event.put("show_workout_history",p.getBoolean("show_workout_history",true));
            event.put("strength_detail_expanded",p.getBoolean("strength_detail_expanded",false));
            JSONObject scroll=new JSONObject();
            for(String page:new String[]{"home","analytics","record","body","sleep","voice","settings"})
                scroll.put(page,Math.max(0,p.getInt("scroll_"+page,0)));
            event.put("page_scroll_positions",scroll);
            event.put("rest_timer_state",p.getString("rest_timer_state","{}"));
            event.put("record_advanced_expanded",p.getBoolean("record_advanced_expanded",false));
            String lastPage=p.getString("last_main_page","home");
            if("home".equals(lastPage)&&"trends".equals(p.getString("overview_view","summary")))
                lastPage="analytics"; // Upgrade from former nested Trends view.
            event.put("last_main_page",lastPage);
            reply(event);
        }catch(Exception ex){error("读取训练显示设置失败："+safeMessage(ex));}
    }

    private void restore() {
        try {
            ensureMigrated();
            String token = vault.read("token");
            JSONObject status = message("status");
            status.put("connected", token != null && !token.isEmpty());
            status.put("repo", "z2846852/-");
            reply(status);
            replyData(localDays(), true);
            JSONArray pending = plain.getPending();
            JSONObject q = message("pending");
            q.put("count", pending.length());
            q.put("events", pending);
            reply(q);
            JSONObject rawHistory = message("raw_history");
            rawHistory.put("notes", localRawNotes());
            reply(rawHistory);
            sendCatalog(plain.getCatalog());
            sendSyncHistory("history"); // Local-only metadata, zero network calls.
            // Offline-first local restore; daily GitHub sync starts only after the UI is ready.
        } catch (Exception e) {
            error("本机 JSON 读取或旧版本迁移失败，可先在 GitHub 检查备份。");
        }
    }

    /** Push queued events and pull remote JSON only on daily launch or a manual tap.
     * Failed uploads stay queued; a successful pull cannot silently claim full sync. */
    private boolean syncInternal(String token) {
        boolean complete=true;
        try {
            try { drainPending(token); }
            catch (Exception upload) {
                complete=false;
                error("有记录尚未上传，已保留本地：" + safeMessage(upload));
            }
            try { syncExerciseCatalog(token); }
            catch (Exception catalogError) {
                complete=false;
                error("动作目录尚未同步，保留本机设置：" + safeMessage(catalogError));
            }
            JSONArray remote = github.readDaily(token);
            JSONArray combined = mergeDays(localDays(), remote);
            plain.putDays(combined);
            replyData(combined, false);
            return complete;
        } catch (Exception e) {
            error("GitHub 同步失败，本地数据仍保留：" + safeMessage(e));
            return false;
        }
    }

    /** Sync metadata never leaves the device; separate last attempt and last success.
     * A partially failed sync must NOT advance last_success_ms. */
    private void sendSyncHistory(String state){
        try{
            android.content.SharedPreferences p=getSharedPreferences(
                "bodytrace_daily_sync",MODE_PRIVATE);
            reply(message("sync_status").put("state",state)
                .put("last_attempt_ms",p.getLong("last_attempt_ms",0))
                .put("last_success_ms",p.getLong("last_success_ms",0))
                .put("last_result",p.getString("last_result","never")));
        }catch(Exception e){error("读取同步时间失败："+safeMessage(e));}
    }

    private boolean syncWithHistory(String token){
        android.content.SharedPreferences p=getSharedPreferences(
            "bodytrace_daily_sync",MODE_PRIVATE);
        p.edit().putLong("last_attempt_ms",System.currentTimeMillis())
            .putString("last_result","started").commit();
        sendSyncHistory("started");
        boolean success=syncInternal(token);
        android.content.SharedPreferences.Editor edit=p.edit()
            .putString("last_result",success?"complete":"partial");
        if(success)edit.putLong("last_success_ms",System.currentTimeMillis());
        edit.commit();
        sendSyncHistory(success?"complete":"partial");
        return success;
    }

    /** App startup triggers a single network attempt per Beijing calendar day.
     * Persist the attempt BEFORE networking: failures never cause retry storms.
     * The user can always retry explicitly via either Sync button. */
    private void syncOnceOnFirstOpenToday() {
        try {
            String token=vault.read("token");
            if(token==null||token.isEmpty())return;
            android.content.SharedPreferences p=getSharedPreferences(
                "bodytrace_daily_sync",MODE_PRIVATE);
            String today=LocalDate.now(BEIJING).toString();
            if(today.equals(p.getString("last_attempt_date","")))return;
            if(!p.edit().putString("last_attempt_date",today).commit())
                throw new IllegalStateException("无法保存每日同步状态");
            syncWithHistory(token);
        }catch(Exception e){
            error("每日同步未能完成，本机记录保留；可手动同步：" + safeMessage(e));
        }
    }

    private JSONArray localRawNotes() throws Exception {
        return plain.getRaw();
    }

    private void sendPending() throws Exception {
        JSONArray pending = plain.getPending();
        JSONObject update = message("pending");
        update.put("count", pending.length());
        update.put("events", pending);
        reply(update);
    }

    private void markRawUploaded(String id) throws Exception {
        JSONArray history = localRawNotes();
        for (int i = 0; i < history.length(); i++) {
            JSONObject note = history.getJSONObject(i);
            if (id.equals(note.optString("id"))) {
                note.put("local_status", "uploaded");
                break;
            }
        }
        plain.putRaw(history);
        JSONObject update = message("raw_history");
        update.put("notes", history);
        reply(update);
    }

    /** Upload all events from the same calendar day in one request.
     * The durable queue is shortened ONLY after GitHub confirms that date;
     * any timeout or conflict leaves that date's events available for retry.
     * Raw inbox notes retain their independent, idempotent uploads. */
    private void drainPending(String token) throws Exception {
        JSONArray pending = plain.getPending();
        while (pending.length() > 0) {
            JSONObject first = pending.getJSONObject(0);
            boolean isRaw = "raw_note".equals(first.optString("type"));
            java.util.HashSet<String> uploadedIds = new java.util.HashSet<>();
            JSONArray completed = new JSONArray();
            if (isRaw) {
                github.createRawNote(token, first);
                uploadedIds.add(first.getString("id"));
                completed.put(first);
            } else {
                String date = first.getString("date");
                for (int i = 0; i < pending.length(); ++i) {
                    JSONObject event = pending.getJSONObject(i);
                    if (!"raw_note".equals(event.optString("type")) &&
                            date.equals(event.optString("date"))) {
                        completed.put(event);
                        uploadedIds.add(event.getString("id"));
                    }
                }
                github.createEvents(token, completed); // A single daily JSON commit.
            }
            JSONArray remaining = new JSONArray();
            for (int i = 0; i < pending.length(); ++i) {
                JSONObject event = pending.getJSONObject(i);
                if (!uploadedIds.contains(event.optString("id")))
                    remaining.put(event);
            }
            // A successful remote write is the ONLY point at which we advance
            // the local queue. UUID de-duplication also covers lost responses.
            plain.putPending(remaining);
            pending = remaining;
            if (isRaw) {
                markRawUploaded(first.getString("id"));
                JSONObject result = message("raw_uploaded");
                result.put("id", first.getString("id"));
                reply(result);
            } else {
                JSONObject result = message("saved_batch");
                result.put("count", completed.length());
                result.put("date", first.getString("date"));
                reply(result);
            }
            sendPending();
        }
    }

    private static String safeMessage(Exception e) {
        String s = e.getMessage();
        return s == null ? "未知错误" : s.length() > 140 ? s.substring(0, 140) : s;
    }

    private static JSONObject validateCatalog(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        if (input.optInt("schema_version", 1) != 1) {
            throw new IllegalArgumentException("动作库 JSON 版本不兼容");
        }
        String mode = input.optString("sort_mode", "recent");
        if (!"recent".equals(mode) && !"region".equals(mode)) {
            throw new IllegalArgumentException("动作排序方式不合法");
        }
        JSONArray custom = input.optJSONArray("custom");
        if (custom == null) custom = new JSONArray();
        if (custom.length() > 64) throw new IllegalArgumentException("自定义动作最多64项");
        JSONArray hidden = input.optJSONArray("hidden");
        if (hidden == null) hidden = new JSONArray();
        if (hidden.length() > 128) throw new IllegalArgumentException("隐藏动作数量超出限制");

        JSONArray sanitizedCustom = new JSONArray();
        java.util.HashSet<String> ids = new java.util.HashSet<>();
        for (int i=0; i<custom.length(); ++i) {
            JSONObject item = custom.getJSONObject(i);
            String id = item.optString("id");
            String label = item.optString("label").trim();
            String region = item.optString("region").trim();
            if (!id.matches("custom_[a-z0-9]{8,32}") || !ids.add(id) ||
                    label.isEmpty() || label.length()>60 ||
                    label.matches("(?s).*?[\\p{Cntrl}].*") ||
                    !("胸".equals(region)||"肩".equals(region)||"背".equals(region)||
                      "腿".equals(region)||"手臂".equals(region)||
                      "核心".equals(region)||"其他".equals(region))) {
                throw new IllegalArgumentException("自定义动作 ID、名称或部位不合法");
            }
            JSONObject entry = new JSONObject();
            entry.put("id", id);entry.put("label",label);entry.put("region",region);
            sanitizedCustom.put(entry);
        }
        java.util.HashSet<String> hideIds = new java.util.HashSet<>();
        JSONArray sanitizedHidden = new JSONArray();
        for (int i=0; i<hidden.length(); ++i) {
            String id = hidden.getString(i);
            if (!id.matches("[a-z][a-z0-9_]{1,50}")) {
                throw new IllegalArgumentException("隐藏动作标识不合法");
            }
            if (hideIds.add(id)) sanitizedHidden.put(id);
        }
        JSONObject result = new JSONObject();
        result.put("schema_version", 1);
        result.put("sort_mode", mode);
        result.put("custom",sanitizedCustom);
        result.put("hidden",sanitizedHidden);
        return result;
    }

    private void sendCatalog(JSONObject catalog) throws Exception {
        JSONObject response = message("exercise_catalog");
        response.put("catalog",catalog);
        reply(response);
    }

    /** Prefer local unsynced catalog over remote; otherwise pull the shared GitHub file. */
    private void syncExerciseCatalog(String token) throws Exception {
        JSONObject local = plain.getCatalog();
        if (local.optBoolean("_dirty", false)) {
            String updatedSha = github.writeExerciseCatalog(token,local);
            local.put("_remote_sha", updatedSha);
            local.put("_dirty",false);
            plain.putCatalog(local);
            sendCatalog(local);
        } else {
            JSONObject remote = github.readExerciseCatalog(token);
            if (remote != null) {
                JSONObject clean = validateCatalog(remote.toString());
                clean.put("_remote_sha", remote.optString("_remote_sha", ""));
                clean.put("_dirty",false);
                plain.putCatalog(clean);
                sendCatalog(clean);
            } else {
                sendCatalog(local);
            }
        }
    }

    private JSONObject validatedEvent(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!day.toString().equals(date) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("训练日期不合法");
        }
        String id = input.getString("exercise_id");
        String ex = id, customLabel = null, customRegion = null;
        switch (id) {
            case "adductor": case "abductor": case "lateral_raise": case "row":
            case "assisted_pullup": case "assisted_dip":
            case "smith_bench": case "chest_press": case "pec_deck":
            case "reverse_fly": case "vertical_traction":
            case "prone_leg_curl": case "seated_leg_curl": case "hip_thrust":
            case "leg_press": case "leg_press_45": case "single_leg_press":
            case "leg_extension": case "shoulder_press": case "incline_chest_press":
            case "horizontal_bench": case "barbell_bench": case "dumbbell_bench":
            case "incline_dumbbell_bench": case "decline_bench":
            case "front_raise": case "rear_delt_fly":
            case "dumbbell_shoulder_press": case "overhead_press": case "face_pull":
                break;
            default:
                if (!id.matches("custom_[a-z0-9]{8,32}")) {
                    throw new IllegalArgumentException("未知训练动作，请在动作管理中新增");
                }
                JSONArray configured = plain.getCatalog().optJSONArray("custom");
                boolean found = false;
                if (configured != null) for (int i=0; i<configured.length(); ++i) {
                    JSONObject option = configured.getJSONObject(i);
                    if (id.equals(option.optString("id"))) {
                        customLabel = option.optString("label");
                        customRegion = option.optString("region");
                        found = true;break;
                    }
                }
                if (!found) throw new IllegalArgumentException("自定义动作不存在，请先保存动作目录");
        }
        int reps = input.getInt("reps");
        double kg = input.getDouble("kg");
        if (reps < 0 || reps > 200 || !Double.isFinite(kg) || kg < 0 || kg > 500
                || Math.rint(kg * 10) != kg * 10) {
            throw new IllegalArgumentException("重量须为0–500kg、最多一位小数；次数0–200（0=尝试失败）");
        }
        JSONObject result = new JSONObject();
        result.put("schema_version", 1);
        result.put("type", "workout");
        result.put("id", UUID.randomUUID().toString());
        result.put("date", date);
        result.put("exercise_id", ex);
        if (customLabel != null) {
            result.put("exercise_label", customLabel);
            result.put("exercise_region", customRegion);
        }
        result.put("reps", reps);
        if (reps == 0) result.put("attempt_status", "failed");
        String loadBasis = input.optString("load_basis", "machine");
        if (!"machine".equals(loadBasis) && !"per_side".equals(loadBasis) &&
            !"bodyweight".equals(loadBasis) && !"unspecified".equals(loadBasis)) {
            throw new IllegalArgumentException("重量记录方式不合法");
        }
        result.put("load_basis", loadBasis);
        String note = input.optString("note", "").trim();
        if (note.length() > 200 || note.matches("(?s).*?[\\p{Cntrl}].*")) {
            throw new IllegalArgumentException("训练备注过长或包含非法字符");
        }
        if (!note.isEmpty()) result.put("note", note);
        result.put(ex.equals("assisted_pullup") || ex.equals("assisted_dip") ?
                "assistance_kg" : "load_kg", kg);
        result.put("created_at", OffsetDateTime.now(BEIJING).toString());
        result.put("source", "bodytrace-android");
        return result;
    }


    /** A recorded set is never overwritten. Corrections have their own UUID and
     * are appended to the source day, so GitHub pull cannot resurrect deletions. */
    private static JSONObject validatedWorkoutEdit(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if(!date.equals(day.toString()) || day.isAfter(LocalDate.now(BEIJING).plusDays(1)))
            throw new IllegalArgumentException("修正日期不合法");
        String target=input.getString("target_id");
        if(!target.matches("[0-9a-fA-F-]{36}"))
            throw new IllegalArgumentException("目标训练记录没有可编辑 UUID");
        String action=input.getString("action");
        if(!"replace".equals(action) && !"delete".equals(action))
            throw new IllegalArgumentException("不支持该修正操作");
        JSONObject event=new JSONObject();
        event.put("schema_version",1);
        event.put("type","workout_edit");
        event.put("id",UUID.randomUUID().toString());
        event.put("date",date);
        event.put("target_id",target);
        event.put("action",action);
        if("replace".equals(action)){
            // The edit is stored next to the original row; the effective session
            // day can move without losing its stable UUID or creating a second row.
            String sessionDate=input.optString("session_date",date);
            LocalDate sessionDay=LocalDate.parse(sessionDate);
            if(!sessionDate.equals(sessionDay.toString()) ||
               sessionDay.isAfter(LocalDate.now(BEIJING).plusDays(1)))
                throw new IllegalArgumentException("修改后的训练日期不合法");
            event.put("session_date",sessionDate);
            String loadKey=input.getString("load_key");
            if(!"load_kg".equals(loadKey) && !"assistance_kg".equals(loadKey))
                throw new IllegalArgumentException("无效的负重字段");
            double load=input.getDouble("load_kg");
            int reps=input.getInt("reps");
            int copies=input.getInt("copies");
            if(!Double.isFinite(load) || load<0 || load>500 ||
               Math.abs(load*10-Math.rint(load*10))>0.00001 ||
               reps<0 || reps>200 || copies<1 || copies>10)
                throw new IllegalArgumentException("负重0–500kg、次数0–200、组数1–10；重量精度0.1kg");
            event.put("load_key",loadKey);
            event.put("load_kg",Math.round(load*10)/10.0);
            event.put("reps",reps);
            event.put("copies",copies);
            String note=input.optString("note","").trim();
            if(note.length()>200)throw new IllegalArgumentException("备注最多200字");
            event.put("note",note);
        }
        event.put("created_at",OffsetDateTime.now(BEIJING).toString());
        event.put("source","bodytrace-android");
        return event;
    }

    private static JSONObject validatedNutrition(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!date.equals(day.toString()) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("饮食日期不合法");
        }
        if ("daily_checkin".equals(input.optString("entry_kind"))) {
            String[] flags = new String[]{"intake_creatine", "intake_protein_powder",
                    "intake_carbs", "intake_sugar_oil"};
            JSONObject event = new JSONObject();
            event.put("schema_version", 1);
            event.put("type", "nutrition");
            event.put("id", UUID.randomUUID().toString());
            event.put("date", date);
            event.put("entry_kind", "daily_checkin");
            for (String key : flags) {
                if (!input.has(key) || !(input.get(key) instanceof Boolean)) {
                    throw new IllegalArgumentException("摄入勾选必须明确填写四个布尔值");
                }
                event.put(key, input.getBoolean(key));
            }
            event.put("source", "bodytrace-android");
            event.put("created_at", OffsetDateTime.now(BEIJING).toString());
            return event;
        }
        if (input.has("entry_kind")) {
            throw new IllegalArgumentException("未知饮食条目类型");
        }
        String food = input.getString("food").trim();
        if (food.isEmpty() || food.length() > 100) {
            throw new IllegalArgumentException("食物名称需1至100字符");
        }
        String meal = input.optString("meal", "other");
        if (!meal.equals("breakfast") && !meal.equals("lunch") &&
                !meal.equals("dinner") && !meal.equals("snack") && !meal.equals("other")) {
            throw new IllegalArgumentException("餐次不合法");
        }
        double grams = input.getDouble("grams");
        double kcal = input.getDouble("kcal_per_100g");
        double protein = input.has("protein_per_100g") ?
                input.getDouble("protein_per_100g") : 0;
        double carbs = input.has("carbs_per_100g") ?
                input.getDouble("carbs_per_100g") : 0;
        double fat = input.has("fat_per_100g") ?
                input.getDouble("fat_per_100g") : 0;
        if (!Double.isFinite(grams) || grams <= 0 || grams > 5000 ||
                !Double.isFinite(kcal) || kcal < 0 || kcal > 1200 ||
                !Double.isFinite(protein) || protein < 0 || protein > 100 ||
                !Double.isFinite(carbs) || carbs < 0 || carbs > 100 ||
                !Double.isFinite(fat) || fat < 0 || fat > 100) {
            throw new IllegalArgumentException("重量、热量或营养素超出合理输入范围");
        }
        JSONObject event = new JSONObject();
        event.put("schema_version", 1);
        event.put("type", "nutrition");
        event.put("id", UUID.randomUUID().toString());
        event.put("date", date);
        event.put("meal", meal);
        event.put("food", food);
        event.put("grams", grams);
        event.put("kcal_per_100g", kcal);
        if (input.has("protein_per_100g")) event.put("protein_per_100g", protein);
        if (input.has("carbs_per_100g")) event.put("carbs_per_100g", carbs);
        if (input.has("fat_per_100g")) event.put("fat_per_100g", fat);
        event.put("source", "bodytrace-android");
        event.put("created_at", OffsetDateTime.now(BEIJING).toString());
        return event;
    }


    /** Preserve only fields explicitly measured/edited; never copy old measurements. */
    private static JSONObject validatedMeasurement(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!date.equals(day.toString()) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("测量日期不合法");
        }
        JSONObject event = new JSONObject();
        event.put("schema_version", 1);
        event.put("type", "measurement");
        event.put("id", UUID.randomUUID().toString());
        event.put("date", date);
        final String[] keys = {"weight_kg", "body_fat_pct", "shoulder_cm", "chest_cm",
                "waist_cm", "upper_arm_cm", "abdomen_cm", "hip_cm", "thigh_cm",
                "calf_cm", "muscle_mass_kg"};
        int supplied = 0;
        for (String key : keys) {
            if (!input.has(key) || input.isNull(key)) continue;
            Object raw = input.get(key);
            if (!(raw instanceof Number)) throw new IllegalArgumentException(key + " 需要数字");
            double value = ((Number) raw).doubleValue();
            double min = key.equals("weight_kg") ? 20 : key.equals("body_fat_pct") ? 1 : 5;
            double max = key.equals("body_fat_pct") ? 75 : 300;
            if (!Double.isFinite(value) || value < min || value > max ||
                    Math.abs(value * 10 - Math.rint(value * 10)) > 0.00001) {
                throw new IllegalArgumentException(key + " 超出范围或不是0.1精度");
            }
            event.put(key, Math.round(value * 10.0) / 10.0);
            supplied++;
        }
        if (supplied == 0) throw new IllegalArgumentException("请先选择至少一项本次实际测量数据");
        event.put("source", "bodytrace-android");
        event.put("created_at", OffsetDateTime.now(BEIJING).toString());
        return event;
    }

    private static JSONObject validatedRaw(String text) throws Exception {
        if (text == null || text.trim().isEmpty() || text.length() > 10000) {
            throw new IllegalArgumentException("Raw 原文必须为1至10000字符");
        }
        JSONObject note = new JSONObject();
        note.put("schema_version", 1);
        note.put("type", "raw_note");
        note.put("id", UUID.randomUUID().toString());
        note.put("date", LocalDate.now(BEIJING).toString());
        note.put("created_at", OffsetDateTime.now(BEIJING).toString());
        note.put("source", "bodytrace-android");
        note.put("status", "unprocessed");
        note.put("text", text);
        return note;
    }

    private final class Bridge {
        @JavascriptInterface public void pickAvatar() {
            runOnUiThread(() -> {
                try {
                    Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    choose.addCategory(Intent.CATEGORY_OPENABLE);
                    choose.setType("image/*");
                    choose.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(choose, PICK_AVATAR_REQUEST);
                } catch (Exception e) {
                    error("打开图片选择器失败：" + safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void ready() {
            if(uiBundles!=null)uiBundles.markReady();
            worker.execute(() -> {
                restore();
                sendUiPreferences();
                try{
                    android.content.SharedPreferences diagnostic=getSharedPreferences(
                        "bodytrace_startup_diagnostics",MODE_PRIVATE);
                    String detail=diagnostic.getString("last_error","");
                    if(!detail.isEmpty())
                        reply(message("startup_diagnostic")
                            .put("message",detail)
                            .put("when_ms",diagnostic.getLong("last_error_ms",0L)));
                }catch(Exception ignored){}
                // Show the local installed version without fetching GitHub.
                try{reply(message("apk_update").put("state","local_version")
                    .put("installed_version",apkUpdates.currentVersion())
                    .put("previous_version",apkUpdates.previousVersion()));}
                catch(Exception ignored){}
                uiReady = true;
                consumePendingSharedAvatar();
                sendSleepStatus();
                try{
                    if(uiBundles!=null)reply(uiBundles.status());
                }catch(Exception ignored){}
                syncOnceOnFirstOpenToday();
            });
        }

        @JavascriptInterface public void checkApkVersion(){
            worker.execute(()->{
                try{
                    // Report the local PackageManager version immediately, then
                    // make ONE small GitHub Release JSON request. No APK download.
                    reply(message("apk_update").put("state","version_checking")
                        .put("installed_version",apkUpdates.currentVersion())
                        .put("message","正在读取 GitHub 最新版本…"));
                    reply(apkUpdates.checkVersionsOnly());
                }catch(Exception e){
                    try{
                        JSONObject failed=message("apk_update")
                            .put("state","version_error")
                            .put("message","版本检查失败："+safeMessage(e));
                        try{failed.put("installed_version",apkUpdates.currentVersion());}
                        catch(Exception ignored){}
                        reply(failed);
                    }catch(Exception ignored){}
                }
            });
        }

        @JavascriptInterface public void fetchReleaseHistory(int page){
            worker.execute(()->{
                try{reply(ReleaseHistory.list(page));}
                catch(Exception e){
                    try{reply(message("release_history").put("state","error")
                        .put("page",page).put("message","版本历史查询失败："+safeMessage(e)));}
                    catch(Exception ignored){}
                }
            });
        }
        @JavascriptInterface public void fetchReleaseChanges(String previous,String current){
            worker.execute(()->{
                try{reply(ReleaseHistory.changes(previous,current));}
                catch(Exception e){
                    try{reply(message("release_history").put("state","error")
                        .put("previous",previous).put("current",current)
                        .put("message","提交对比失败："+safeMessage(e)));}
                    catch(Exception ignored){}
                }
            });
        }
        @JavascriptInterface public void githubRequestStats(){
            worker.execute(()->{
                try{reply(GitHubRequestStats.snapshot(MainActivity.this));}
                catch(Exception e){error("读取请求统计失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void checkApkUpdate(){
            worker.execute(()->{
                try{
                    JSONObject status=apkUpdates.checkAndPrepare(MainActivity.this::reply);
                    reply(status);
                    if("ready".equals(status.optString("state"))){
                        runOnUiThread(()->openVerifiedApkInstaller());
                    }
                }catch(Exception e){
                    try{
                        reply(message("apk_update").put("state","error")
                            .put("message","APK 更新失败："+safeMessage(e)));
                    }catch(Exception ignored){}
                }
            });
        }
        @JavascriptInterface public void importApkPatch(){
            runOnUiThread(()->{
                try{
                    Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    pick.setType("*/*");
                    pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(pick,PICK_APK_PATCH_REQUEST);
                }catch(Exception e){error("无法选择补丁："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void installPendingApk(){
            runOnUiThread(()->openVerifiedApkInstaller());
        }


        @JavascriptInterface public void checkUiUpdates(){
            worker.execute(()->{
                try {
                    if(uiBundles==null)
                        throw new IllegalStateException("请先安装支持界面增量更新的 APK");
                    reply(uiBundles.fetchLatest());
                }catch(Exception e){
                    JSONObject report=message("ui_update");
                    try{
                        report.put("state","error");
                        report.put("message","检查界面更新失败："+safeMessage(e));
                    }catch(Exception ignored){}
                    reply(report);
                }
            });
        }

        @JavascriptInterface public void rollbackUi(){
            worker.execute(()->{
                if(uiBundles!=null){
                    uiBundles.rollback();
                    try{reply(uiBundles.status());}catch(Exception ignored){}
                }
            });
        }

        @JavascriptInterface public void restartUi(){
            runOnUiThread(()->recreate());
        }

        @JavascriptInterface public void connect(String rawToken) {
            worker.execute(() -> {
                String token = rawToken == null ? "" : rawToken.trim();
                if (token.length() < 20 || token.length() > 300) {
                    error("请粘贴有效的 GitHub fine-grained token。");
                    return;
                }
                try {
                    // GitHub is an optional sync backend, not the primary UI store.
                    ensureMigrated();
                    // Do not describe a private-repo 404 as "repo missing":
                    // first test repository metadata, then Contents permission.
                    github.verifyRepositoryAccess(token);
                    // Connection validation is explicit, but does not imply
                    // upload/download. The first daily launch or Sync button does that.
                    vault.write("token",token);
                    JSONObject status=message("status");
                    status.put("connected",true);
                    status.put("repo","z2846852/-");
                    reply(status);
                } catch (Exception e) {
                    error("连接失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void sync() {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    String token = vault.read("token");
                    if (token == null || token.isEmpty()) {
                        error("请先连接 GitHub"); return;
                    }
                    syncWithHistory(token);
                } catch (Exception e) { error(safeMessage(e)); }
            });
        }
        @JavascriptInterface public void readGitLog() {
            worker.execute(() -> {
                try {
                    String token = vault.read("token");
                    if (token == null || token.isEmpty()) {
                        throw new IllegalStateException("请先连接 GitHub");
                    }
                    JSONObject result = message("git_log");
                    result.put("commits", github.readRecentCommits(token));
                    reply(result);
                } catch (Exception e) {
                    try {
                        JSONObject response = message("git_log_error");
                        response.put("message", safeMessage(e));
                        reply(response);
                    } catch (Exception ignored) { }
                }
            });
        }
        @JavascriptInterface public void showViewModel() {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject out = message("view_json");
                    out.put("view_model", new JSONObject(plain.getView()));
                    reply(out);
                } catch (Exception e) {
                    error("读取派生 JSON 失败：" + safeMessage(e));
                }
            });
        }

        /** Durable navigation preference, independent of WebView DOM Storage.
         * Synchronous commit avoids losing the last tap when the app closes. */
        @JavascriptInterface public void setUiNavigation(String mainPage){
            if(mainPage==null||!("home".equals(mainPage)||"analytics".equals(mainPage)||
                 "record".equals(mainPage)||"body".equals(mainPage)||
                 "sleep".equals(mainPage)||"voice".equals(mainPage)||
                 "settings".equals(mainPage)))return;
            boolean written=getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                .edit().putString("last_main_page",mainPage)
                .remove("overview_view").commit();
            if(!written)error("页面偏好保存失败");
        }

        /** The record-page e1RM predictor calibrates each exercise independently.
         * DOM Storage is disabled, so persist to native SharedPreferences. */
        @JavascriptInterface public String loadE1rmCalibration(){
            return getSharedPreferences("bodytrace_e1rm_calibration",MODE_PRIVATE)
                .getString("v1","{}");
        }

        @JavascriptInterface public boolean saveE1rmCalibration(String raw){
            try{
                if(raw==null||raw.length()>64000)
                    throw new IllegalArgumentException("e1RM 校准内容过大");
                JSONObject source=new JSONObject(raw);
                if(source.length()>250)
                    throw new IllegalArgumentException("校准动作数量超限");
                JSONObject clean=new JSONObject();
                java.util.Iterator<String> keys=source.keys();
                while(keys.hasNext()){
                    String id=keys.next();
                    if(!id.matches("[a-z][a-z0-9_]{1,63}"))
                        throw new IllegalArgumentException("无效的校准动作编号");
                    JSONObject item=source.optJSONObject(id);
                    if(item==null)throw new IllegalArgumentException("校准参数格式错误");
                    double coeff=item.optDouble("coeff",Double.NaN);
                    double gain=item.optDouble("gain",Double.NaN);
                    double offset=item.optDouble("offset",Double.NaN);
                    if(!Double.isFinite(coeff)||coeff<15||coeff>60||
                       !Double.isFinite(gain)||gain<0.05||gain>5||
                       !Double.isFinite(offset)||offset< -200||offset>500)
                        throw new IllegalArgumentException("校准参数超出有效范围");
                    clean.put(id,new JSONObject()
                        .put("coeff",coeff).put("gain",gain).put("offset",offset));
                }
                return getSharedPreferences("bodytrace_e1rm_calibration",MODE_PRIVATE)
                    .edit().putString("v1",clean.toString()).commit();
            }catch(Exception e){
                error("保存 e1RM 校准失败："+safeMessage(e));return false;
            }
        }

        /** Reference goals are local training preferences, not uploaded workout
         * entries. DOM storage is deliberately disabled in this WebView. */
        @JavascriptInterface public String loadStrengthGoals(){
            return getSharedPreferences("bodytrace_strength_goals",MODE_PRIVATE)
                .getString("v1","{}");
        }

        @JavascriptInterface public boolean saveStrengthGoals(String payload){
            try{
                if(payload==null||payload.length()>64000)
                    throw new IllegalArgumentException("目标设置过大");
                JSONObject input=new JSONObject(payload);
                if(input.length()>300)
                    throw new IllegalArgumentException("目标动作过多");
                JSONObject clean=new JSONObject();
                java.util.Iterator<String> keys=input.keys();
                while(keys.hasNext()){
                    String key=keys.next();
                    if(!key.matches("[a-zA-Z0-9_\\-]{1,72}\\|(machine|per_side|assisted|bodyweight)"))
                        throw new IllegalArgumentException("目标动作编号无效");
                    JSONObject item=input.optJSONObject(key);
                    if(item==null)throw new IllegalArgumentException("无效的目标数据");
                    Object rawKg=item.opt("kg");
                    double kg=rawKg==null||rawKg==JSONObject.NULL?0:item.optDouble("kg",0);
                    int reps=item.optInt("reps",8);
                    if(!Double.isFinite(kg)||kg<0||kg>1000||reps<1||reps>15)
                        throw new IllegalArgumentException("目标重量或次数无效");
                    String origin=item.optString("origin","manual");
                    if(!("manual".equals(origin)||"generated".equals(origin)||
                         "personal".equals(origin)||"device".equals(origin)||
                         "none".equals(origin)))
                        throw new IllegalArgumentException("目标来源无效");
                    JSONObject saved=new JSONObject();
                    if(kg>0)saved.put("kg",kg);
                    else saved.put("kg",JSONObject.NULL);
                    saved.put("reps",reps);
                    saved.put("hidden",item.optBoolean("hidden",false));
                    saved.put("origin",origin);
                    clean.put(key,saved);
                }
                return getSharedPreferences("bodytrace_strength_goals",MODE_PRIVATE)
                    .edit().putString("v1",clean.toString()).commit();
            }catch(Exception e){
                error("保存力量参考设置失败："+safeMessage(e));
                return false;
            }
        }

        /** External standards are opened OUTSIDE the bridge-enabled WebView.
         * The slug is restricted to a fixed HTTPS path. */
        @JavascriptInterface public void openStrengthGuide(String slug){
            if(slug==null||slug.length()>70||!slug.matches("[a-z]+(-[a-z]+)*"))return;
            Uri destination=Uri.parse(
                "https://strengthlevel.com/strength-standards/"+slug+"/kg");
            runOnUiThread(()->{
                try{startActivity(new Intent(Intent.ACTION_VIEW,destination)
                    .addCategory(Intent.CATEGORY_BROWSABLE));}
                catch(Exception e){error("无法打开标准查询网页："+safeMessage(e));}
            });
        }

        /** Persist expansion of the per-exercise chart section across app restarts. */
        @JavascriptInterface public void setStrengthDetailExpanded(boolean expanded){
            boolean written=getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                .edit().putBoolean("strength_detail_expanded",expanded).commit();
            if(!written)error("单动作详情展开状态保存失败");
        }

        /** Save the page's document scroll offset when switching tabs or pausing.
         * Do not write on every scroll frame. WebView DOM storage is disabled. */
        @JavascriptInterface public void setUiScrollPosition(String mainPage,int top){
            if(mainPage==null||!("home".equals(mainPage)||"analytics".equals(mainPage)||
                 "record".equals(mainPage)||"body".equals(mainPage)||
                 "sleep".equals(mainPage)||"voice".equals(mainPage)||
                 "settings".equals(mainPage)))return;
            getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                .edit().putInt("scroll_"+mainPage,Math.max(0,Math.min(top,2000000))).apply();
        }

        /** Keep rest timer and per-exercise rest presets after WebView recreation.
         * Persist only when the user changes a timer or preset, never per tick. */
        /** Keep optional recording settings collapsed/expanded between launches. */
        @JavascriptInterface public void setRecordAdvancedExpanded(boolean expanded){
            getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                .edit().putBoolean("record_advanced_expanded",expanded).apply();
        }

        @JavascriptInterface public void setRestTimerState(String json){
            try{
                if(json==null||json.length()>12000)
                    throw new IllegalArgumentException("休息设置过长");
                JSONObject request=new JSONObject(json);
                JSONObject safe=new JSONObject();
                boolean running=request.optBoolean("running",false);
                String exercise=request.optString("exercise_id","");
                long deadline=request.optLong("deadline_ms",0L);
                int seconds=request.optInt("duration_seconds",0);
                if(running&&(!exercise.matches("[a-z][a-z0-9_]{1,63}")||
                   seconds<30||seconds>600||deadline<=0||
                   deadline>System.currentTimeMillis()+24L*3600000L))
                    throw new IllegalArgumentException("无效的休息计时状态");
                safe.put("running",running);
                safe.put("deadline_ms",running?deadline:0L);
                safe.put("duration_seconds",running?seconds:0);
                safe.put("exercise_id",running?exercise:"");
                for(String category:new String[]{"overrides","goals"}){
                    JSONObject raw=request.optJSONObject(category);
                    JSONObject clean=new JSONObject();
                    if(raw!=null){
                        if(raw.length()>128)throw new IllegalArgumentException("动作设置太多");
                        java.util.Iterator<String> it=raw.keys();
                        while(it.hasNext()){
                            String key=it.next();
                            if(!key.matches("[a-z][a-z0-9_]{1,63}"))
                                throw new IllegalArgumentException("无效的动作编号");
                            int value=raw.getInt(key);
                            if("overrides".equals(category)?value<30||value>600:
                               !(value==2||value==3||value==4||value==5||
                                 value==6||value==8||value==10))
                                throw new IllegalArgumentException("组间休息或目标组数无效");
                            clean.put(key,value);
                        }
                    }
                    safe.put(category,clean);
                }
                if(!getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                     .edit().putString("rest_timer_state",safe.toString()).commit())
                    throw new IllegalStateException("休息设置写入失败");
            }catch(Exception ex){error("休息计时保存失败："+safeMessage(ex));}
        }

        @JavascriptInterface public void setWorkoutHistoryVisible(boolean visible){
            worker.execute(()->{
                try{
                    boolean written=getSharedPreferences("bodytrace_ui_prefs",MODE_PRIVATE)
                        .edit().putBoolean("show_workout_history",visible).commit();
                    if(!written)throw new IllegalStateException("偏好设置写入失败");
                    sendUiPreferences();
                }catch(Exception ex){
                    error("无法持久保存训练历史开关："+safeMessage(ex));
                }
            });
        }

        @JavascriptInterface public void saveCatalog(String catalogJson) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject clean = validateCatalog(catalogJson);
                    clean.put("_remote_sha", plain.getCatalog().optString("_remote_sha", ""));
                    clean.put("_dirty",true);
                    plain.putCatalog(clean);
                    sendCatalog(clean); // UI responds immediately offline.
                    // Dirty catalog is committed to GitHub at the next scheduled
                    // or explicitly requested sync, never on each local edit.
                } catch (Exception e) {
                    error("动作管理保存失败：" + safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void save(String eventJson) {
            saveBatch(eventJson); // Backward compatible one-set bridge method.
        }
        @JavascriptInterface public void saveBatch(String batchJson) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject params = new JSONObject(batchJson);
                    int setCount = params.optInt("sets", 1);
                    if (setCount < 1 || setCount > 10)
                        throw new IllegalArgumentException("连续组数仅支持1–10组");
                    // Validate every request before mutating local storage.
                    JSONObject first = validatedEvent(batchJson);
                    JSONArray created = new JSONArray().put(first);
                    for (int i = 1; i < setCount; ++i) created.put(validatedEvent(batchJson));

                    JSONArray pending = plain.getPending();
                    JSONArray days = localDays();
                    for (int i = 0; i < created.length(); ++i) {
                        JSONObject event = created.getJSONObject(i);
                        pending.put(event);
                        days = appendLocal(days, event);
                    }
                    // Persist queue before UI refresh/network to survive interruptions.
                    plain.putPending(pending);
                    plain.putDays(days);
                    JSONObject view = ViewProjector.project(days);
                    plain.putView(view);
                    JSONObject saved = message("local_saved");
                    saved.put("event", first);
                    saved.put("events", created);
                    saved.put("count", pending.length());
                    saved.put("days", days);
                    saved.put("view_model", view);
                    reply(saved);
                    // Queue is durable; no automatic GitHub request on save.
                } catch (Exception e) {
                    error("记录训练失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void editWorkout(String json) {
            worker.execute(()->{
                try{
                    ensureMigrated();
                    JSONObject event=validatedWorkoutEdit(json);
                    JSONArray days=localDays();
                    String target=event.getString("target_id");
                    JSONObject day=null;
                    for(int i=0;i<days.length();i++){
                        JSONObject item=days.getJSONObject(i);
                        if(event.getString("date").equals(item.optString("date"))){day=item;break;}
                    }
                    if(day==null)throw new IllegalArgumentException("该日期没有原始训练记录");
                    // Materialize existing edits first. Also permit future edits of
                    // duplicated sets with deterministic, stable UUIDs.
                    JSONArray effective=WorkoutEdits.apply(day.optJSONArray("workouts"),
                        day.optJSONArray("workout_edits"));
                    boolean present=false;
                    for(int i=0;i<effective.length();i++){
                        if(target.equals(effective.getJSONObject(i).optString("id"))){
                            present=true;break;
                        }
                    }
                    if(!present)throw new IllegalArgumentException("此训练组已经删除或不存在，请刷新后再操作");
                    JSONArray pending=plain.getPending();
                    pending.put(event);
                    days=appendLocal(days,event);
                    // Offline-first: queue is durable before any GitHub calls.
                    plain.putPending(pending);
                    plain.putDays(days);
                    JSONObject view=ViewProjector.project(days);
                    plain.putView(view);
                    JSONObject msg=message("workout_edit_local_saved");
                    msg.put("event",event);
                    msg.put("count",pending.length());
                    msg.put("view_model",view);
                    reply(msg);
                    // Workout corrections stay in the local outbox until daily/manual sync.
                }catch(Exception e){error("训练修正失败："+safeMessage(e));}
            });
        }

        @JavascriptInterface public void saveMeasurement(String measurementJson) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject event = validatedMeasurement(measurementJson);
                    JSONArray pending = plain.getPending();
                    pending.put(event);
                    plain.putPending(pending);
                    JSONArray days = appendLocal(localDays(), event);
                    plain.putDays(days);
                    JSONObject view = ViewProjector.project(days);
                    plain.putView(view);
                    JSONObject saved = message("measurement_local_saved");
                    saved.put("event", event);
                    saved.put("count", pending.length());
                    saved.put("view_model", view);
                    reply(saved);
                    // Measurement remains local until daily/manual sync.
                } catch (Exception e) {
                    error("记录身体数据失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void sleepImport(String reportedStart){
            runOnUiThread(()->{
                try{
                    if(SleepRecorderService.isRecording())
                        throw new IllegalStateException("请先停止当前录音再导入");
                    if(reportedStart!=null && !reportedStart.trim().isEmpty()){
                        LocalDateTime.parse(reportedStart.trim(),DateTimeFormatter.ISO_LOCAL_DATE_TIME);
                    }
                    pendingSleepStart=reportedStart==null?"":reportedStart.trim();
                    Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    choose.addCategory(Intent.CATEGORY_OPENABLE);
                    choose.setType("audio/*");
                    choose.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(choose,PICK_SLEEP_AUDIO_REQUEST);
                }catch(Exception ex){error("无法打开录音选择器："+safeMessage(ex));}
            });
        }

        @JavascriptInterface public void phoneSleepReports(){
            worker.execute(MainActivity.this::sendPhoneSleepReports);
        }
        @JavascriptInterface public void reviewPhoneSleep(String id,String decision){
            worker.execute(()->{
                try{
                    new PhoneSleepHistory(MainActivity.this).review(id,decision);
                    sendPhoneSleepReports();
                }catch(Exception failure){
                    error("手机行为确认保存失败："+safeMessage(failure));
                    sendPhoneSleepReports(); // Clear UI busy state even on failure.
                }
            });
        }
        @JavascriptInterface public void requestPhoneUsageAccess(){
            runOnUiThread(()->{
                try{
                    if(new PhoneSleepHistory(MainActivity.this).hasUsageAccess()){
                        worker.execute(MainActivity.this::sendPhoneSleepReports);
                        return;
                    }
                    awaitingPhoneUsagePermission=true;
                    Intent settings=new Intent(
                        android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    startActivity(settings);
                }catch(Exception e){
                    awaitingPhoneUsagePermission=false;
                    error("无法打开手机使用情况权限设置："+safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void vivoSleepProbe(){
            // Never request private permissions silently or send results online.
            worker.execute(()->{
                try{reply(new VivoSleepProbe(MainActivity.this).read());}
                catch(Exception e){
                    try{reply(message("vivo_sleep").put("capability","ERROR")
                        .put("message","vivo 健康读取失败："+safeMessage(e)));}
                    catch(Exception ignored){}
                }
            });
        }

        @JavascriptInterface public void voiceLabStart(String requestedMode){
            runOnUiThread(()->{
                if(!("pitch".equals(requestedMode)||"phoneme".equals(requestedMode))){
                    error("无效的实时声音模式");return;
                }
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=
                        PackageManager.PERMISSION_GRANTED){
                    pendingVoiceLabMode=requestedMode;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                        VOICE_LAB_MIC_PERMISSION_REQUEST);
                }else voiceLab.start(requestedMode);
            });
        }
        @JavascriptInterface public void voiceLabLookupWord(String word){
            worker.execute(()->voiceLab.lookupWord(word));
        }
        @JavascriptInterface public void voiceLabPlayPhoneme(String ipa){
            if(ipa==null||ipa.codePointCount(0,ipa.length())>4)return;
            runOnUiThread(()->ipaSamplePlayer.play(ipa));
        }
        @JavascriptInterface public void voiceLabSpeakReference(String word,String language){
            if(word==null||word.length()>40||
                !("en".equals(language)||"zh".equals(language)))return;
            if("en".equals(language)&&!word.matches("[A-Za-z]{1,40}"))return;
            if("zh".equals(language)&&!word.matches("[\\p{IsHan}]{1,6}"))return;
            java.util.Locale loc="zh".equals(language)?java.util.Locale.SIMPLIFIED_CHINESE:
                java.util.Locale.UK;
            runOnUiThread(()->playVoiceIpaWord(word,loc));
        }
        @JavascriptInterface public void voiceLabSpeakExample(String word){
            if(word==null||!word.matches("[A-Za-z]{1,32}")){
                voiceIpaTtsReport("示例词只能包含英文字母");return;
            }
            runOnUiThread(()->playVoiceIpaWord(word,java.util.Locale.UK));
        }

        @JavascriptInterface public void voiceLabSetLanguage(String language){
            voiceLab.setLanguage(language);
        }
        @JavascriptInterface public void voiceLabStop(){
            runOnUiThread(()->voiceLab.cancel(true));
        }
        @JavascriptInterface public void voiceLabFinishPhoneme(){
            runOnUiThread(()->voiceLab.finishPhoneme());
        }
        @JavascriptInterface public void voiceModelsStatus(){
            worker.execute(()->{
                try{reply(phoneModels.state("手机本地模型状态"));}
                catch(Exception e){error("读取音素模型列表失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void voiceModelsInstall(String modelId){
            worker.execute(()->{
                try{
                    if("all".equals(modelId))
                        phoneModels.installAll(MainActivity.this::reply);
                    else phoneModels.install(modelId,MainActivity.this::reply);
                }
                catch(Exception e){
                    try{reply(message("voice_models").put("state","error")
                        .put("id",modelId).put("message","模型安装失败："+safeMessage(e)));}
                    catch(Exception ignored){}
                    try{reply(phoneModels.state("下载失败："+safeMessage(e)+
                        "；已完整资源不会重复下载"));}
                    catch(Exception ignored){}
                }
            });
        }
        @JavascriptInterface public void voiceModelsSelect(String modelId){
            worker.execute(()->{
                try{
                    phoneModels.select(modelId);
                    reply(phoneModels.state("已切换所选音素模型"));
                }catch(Exception e){error("模型切换失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void voiceModelsDelete(String modelId){
            worker.execute(()->{
                try{
                    if(voiceLab.isRunning())
                        throw new IllegalStateException("请先结束麦克风录音");
                    phoneModels.delete(modelId);
                    reply(phoneModels.state("已删除模型包；APK 无需重新安装"));
                }catch(Exception e){error("删除模型失败："+safeMessage(e));}
            });
        }

        @JavascriptInterface public void voiceLabCapabilities(){
            runOnUiThread(()->{
                try{
                    reply(message("voice_lab").put("state","capabilities")
                        .put("raw_pcm",true).put("pitch_yin",true)
                        .put("acoustic_vowel_probe",true)
                        .put("acoustic_fricative_probe",true)
                        .put("segment_on_release",true)
                        .put("trained_phone_model",false)
                        .put("recognition_uses_asr",false));
                }catch(Exception ignored){}
            });
        }

        @JavascriptInterface public boolean sleepFeedbackSave(String raw) {
            try {
                SnoreFeedbackController.Settings.save(MainActivity.this,raw);
                return true;
            }catch(Exception e){error("反馈配置保存失败："+safeMessage(e));return false;}
        }
        @JavascriptInterface public void sleepMicMonitorStart(){
            runOnUiThread(()->{
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=
                        PackageManager.PERMISSION_GRANTED){
                    if(Build.VERSION.SDK_INT>=33)
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                            Manifest.permission.POST_NOTIFICATIONS},
                            SLEEP_MONITOR_PERMISSION_REQUEST);
                    else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                        SLEEP_MONITOR_PERMISSION_REQUEST);
                }else startMicMonitor();
            });
        }
        @JavascriptInterface public void sleepMicMonitorStop(){
            runOnUiThread(()->{
                if(SleepRecorderService.isRecording()){
                    error("正在录音，不能单独关闭麦克风；可以关闭反馈");
                    return;
                }
                if(SleepRecorderService.isMicrophoneActive())
                    startService(new Intent(MainActivity.this,SleepRecorderService.class)
                        .setAction(SleepRecorderService.ACTION_MONITOR_OFF));
            });
        }
        @JavascriptInterface public void sleepFeedbackStatus(){
            worker.execute(()->{
                try{reply(SleepRecorderService.feedbackStatus(MainActivity.this));}
                catch(Exception e){error("无法读取实时反馈状态："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepFeedbackMark(){
            try{
                if(!SleepRecorderService.markSnore()){
                    reply(message("sleep_feedback_error").put("message","请先开启麦克风采集"));return;
                }
                reply(SleepRecorderService.feedbackStatus(MainActivity.this));
            }catch(Exception e){error("鼾声标记失败："+safeMessage(e));}
        }
        @JavascriptInterface public void sleepFeedbackExportLog(){
            runOnUiThread(()->{
                try{
                    String raw=SleepRecorderService.liveLogExport().toString(2);
                    Intent share=new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT,"MyWork 实时鼾声实验记录")
                        .putExtra(Intent.EXTRA_TEXT,raw);
                    startActivity(Intent.createChooser(share,"分享或保存实验日志"));
                }catch(Exception e){error("鼾声反馈日志导出失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepFeedbackPreview(String raw){
            try{
                SnoreFeedbackController.Settings settings=SnoreFeedbackController.Settings.parse(raw);
                new Thread(()->{
                    boolean played=false;
                    String failure="";
                    try{played=SnoreFeedbackController.playCue(getApplicationContext(),settings,
                        (samples,rate,duration,vibrate)->{
                            try{reply(SleepRecorderService.speakerWave(samples,rate,
                                duration,vibrate,"手动试听"));}
                            catch(Exception ignored){}
                        });}catch(Exception e){failure=safeMessage(e);}
                    try{reply(message("sleep_feedback_preview").put("ok",played)
                        .put("message",played?"试听完成":failure.isEmpty()?"仍在播放上一个提示":failure)); }
                    catch(Exception ignored){}
                },"snore-feedback-preview").start();
            }catch(Exception e){error("试听配置无效："+safeMessage(e));}
        }
        @JavascriptInterface public void sleepFeedbackStart(String raw){
            runOnUiThread(()->{
                try{
                    SnoreFeedbackController.Settings.save(MainActivity.this,raw);
                    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=
                            PackageManager.PERMISSION_GRANTED){
                        if(Build.VERSION.SDK_INT>=33)
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                                Manifest.permission.POST_NOTIFICATIONS},
                                SLEEP_FEEDBACK_PERMISSION_REQUEST);
                        else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                            SLEEP_FEEDBACK_PERMISSION_REQUEST);
                    }else startSnoreFeedback();
                }catch(Exception e){error("实时反馈启动失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepFeedbackStop(){
            runOnUiThread(()->{
                try{
                    if(SleepRecorderService.isFeedbackEnabled())
                        startService(new Intent(MainActivity.this,SleepRecorderService.class)
                            .setAction(SleepRecorderService.ACTION_FEEDBACK_OFF));
                    sleepHandler.postDelayed(()->worker.execute(()->{
                        try{reply(SleepRecorderService.feedbackStatus(MainActivity.this));}
                        catch(Exception ignored){}
                    }),500);
                }catch(Exception e){error("无法停止反馈："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepStatus(){
            worker.execute(MainActivity.this::sendSleepStatus);
        }
        @JavascriptInterface public void sleepStart(){
            runOnUiThread(()->{
                if(SleepRecorderService.isRecording()){
                    worker.execute(MainActivity.this::sendSleepStatus);return;
                }
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                    if(Build.VERSION.SDK_INT>=33)
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                            Manifest.permission.POST_NOTIFICATIONS},SLEEP_AUDIO_PERMISSION_REQUEST);
                    else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                        SLEEP_AUDIO_PERMISSION_REQUEST);
                }else startSleepCapture();
            });
        }
        @JavascriptInterface public void sleepSetStartTime(String sessionId,String localStart){
            worker.execute(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    JSONObject data=SleepSessions.loadMetadata(MainActivity.this,sessionId);
                    if(!SleepSessions.isExternal(data))
                        throw new IllegalArgumentException("APP 自录音有准确起点，无需修改");
                    if(SleepAnalysisService.isRunning()&&
                            sessionId.equals(SleepAnalysisService.currentId()))
                        throw new IllegalStateException("AI 分析进行中，请完成后再修正时间");
                    LocalDateTime local=LocalDateTime.parse(localStart,
                        DateTimeFormatter.ISO_LOCAL_DATE_TIME);
                    long start=local.toInstant(BEIJING).toEpochMilli();
                    if(start<946684800000L || start>System.currentTimeMillis()+86400000L)
                        throw new IllegalArgumentException("时间超出允许范围");
                    long duration=data.optLong("duration_ms",0);
                    data.put("started_ms",start);
                    data.put("ended_ms",start+duration);
                    data.put("date_basis","user_supplied");
                    // Metadata only. The stored waveform and 8h AI scores are untouched.
                    SleepSessions.write(MainActivity.this,data);
                    reply(message("sleep_start_updated").put("id",sessionId)
                        .put("started_ms",start));
                    sendSleepStatus();
                }catch(Exception e){
                    error("睡眠录音开始时间修改失败："+safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void sleepExport(String sessionId){
            runOnUiThread(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    JSONObject metadata=SleepSessions.loadMetadata(MainActivity.this,sessionId);
                    if(SleepSessions.isExternal(metadata))
                        throw new IllegalArgumentException("请直接在原文件所在位置管理导入录音");
                    File file=SleepSessions.audio(MainActivity.this,sessionId);
                    if(!file.isFile()||file.length()<=1024)
                        throw new IllegalStateException("尚未保存有效的 M4A 录音");
                    if(SleepRecorderService.isCurrentSession(sessionId))
                        throw new IllegalStateException("请停止录音后再导出");
                    String filename="BodyTrace_"+sessionId+".m4a";
                    Intent choose=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    choose.addCategory(Intent.CATEGORY_OPENABLE);
                    choose.setType("audio/mp4");
                    choose.putExtra(Intent.EXTRA_TITLE,filename);
                    pendingSleepExportId=sessionId;
                    startActivityForResult(choose,EXPORT_SLEEP_AUDIO_REQUEST);
                }catch(Exception e){
                    pendingSleepExportId="";
                    error("睡眠录音导出失败："+safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void sleepStop(){
            runOnUiThread(()->{
                if(!SleepRecorderService.isRecording()){
                    worker.execute(MainActivity.this::sendSleepStatus);return;
                }
                Intent service=new Intent(MainActivity.this,SleepRecorderService.class)
                    .setAction(SleepRecorderService.ACTION_STOP);
                startService(service);
                sleepHandler.postDelayed(()->worker.execute(MainActivity.this::sendSleepStatus),1200);
            });
        }
        @JavascriptInterface public void sleepAnalyze(String sessionId,int threshold,int seconds,int gap){
            launchSleepAnalysis(sessionId,threshold,seconds,gap,false);
        }
        /** Explicit one-time YAMNet rebuild for old sleep recordings. */
        @JavascriptInterface public void sleepAnalyzeSpeech(String sessionId,int threshold,int seconds,int gap){
            launchSleepAnalysis(sessionId,threshold,seconds,gap,true);
        }
        private void launchSleepAnalysis(String sessionId,int threshold,int seconds,int gap,boolean refreshSpeech){
            // Foreground service is launched from a user action on the UI thread.
            // Never block the one worker shared by GitHub sync and local JSON.
            runOnUiThread(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    if(SleepRecorderService.isRecording())
                        throw new IllegalStateException("请先停止录音再分析");
                    if(threshold<-90||threshold>-5||seconds<1||seconds>120||gap<0||gap>5)
                        throw new IllegalArgumentException("阈值或持续时间超出范围");
                    if(SleepAnalysisService.isRunning()){
                        if(sessionId.equals(SleepAnalysisService.currentId())){
                            worker.execute(MainActivity.this::sendSleepStatus);
                            return;
                        }
                        throw new IllegalStateException("已有另一段录音正在后台分析");
                    }
                    Intent service=new Intent(MainActivity.this,SleepAnalysisService.class)
                        .setAction(SleepAnalysisService.ACTION_START)
                        .putExtra(SleepAnalysisService.EXTRA_ID,sessionId)
                        .putExtra(SleepAnalysisService.EXTRA_THRESHOLD,threshold)
                        .putExtra(SleepAnalysisService.EXTRA_MINIMUM,seconds)
                        .putExtra(SleepAnalysisService.EXTRA_GAP,gap)
                        .putExtra(SleepAnalysisService.EXTRA_REFRESH_SPEECH,refreshSpeech);
                    startForegroundService(service);
                }catch(Exception e){error("睡眠录音分析启动失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepReadCached(String sessionId,int threshold,int seconds,int gap){
            worker.execute(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    if(threshold<-90||threshold>-5||seconds<1||seconds>120||gap<0||gap>5)
                        throw new IllegalArgumentException("音频筛选参数无效");
                    deliverSleepAnalysis(sessionId,threshold,seconds,gap);
                }catch(Exception e){error("睡眠录音缓存读取失败："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepPlay(String sessionId,int offset,int duration){
            runOnUiThread(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    if(SleepRecorderService.isRecording())
                        throw new IllegalStateException("录音进行中不可播放");
                    if(offset<0||duration<1||duration>180||
                            (long)offset+duration>86400)
                        throw new IllegalArgumentException("无效回放时段");
                    java.util.ArrayList<int[]> ranges=new java.util.ArrayList<>();
                    ranges.add(new int[]{offset,offset+duration});
                    beginRangePlayback(sessionId,ranges,false);
                }catch(Exception e){stopSleepPlayback();error("无法播放片段："+safeMessage(e));}
            });
        }

        /** Consecutive playback with precise native seeks between qualifying
         * sound events. The user can alternatively supply one long range from
         * their cursor to the end of the original recording. */
        @JavascriptInterface public void sleepPlaySequence(String sessionId,
                String rangesJson,boolean skip){
            runOnUiThread(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    if(SleepRecorderService.isRecording())
                        throw new IllegalStateException("录音进行中不可播放");
                    if(rangesJson==null||rangesJson.length()>200000)
                        throw new IllegalArgumentException("播放时间段参数过长");
                    JSONArray request=new JSONArray(rangesJson);
                    if(request.length()<1||request.length()>5000)
                        throw new IllegalArgumentException("播放片段数量不合法");
                    java.util.ArrayList<int[]> ranges=new java.util.ArrayList<>();
                    int prevEnd=0;
                    for(int i=0;i<request.length();i++){
                        JSONArray pair=request.getJSONArray(i);
                        if(pair.length()!=2)throw new IllegalArgumentException("无效播放区间");
                        int first=pair.getInt(0),last=pair.getInt(1);
                        if(first<prevEnd||last<=first||last>86400)
                            throw new IllegalArgumentException("播放区间必须有序且在24小时内");
                        ranges.add(new int[]{first,last});
                        prevEnd=last;
                    }
                    beginRangePlayback(sessionId,ranges,skip);
                }catch(Exception e){stopSleepPlayback();error("无法连播声音片段："+safeMessage(e));}
            });
        }
        @JavascriptInterface public void sleepStopPlayback(){
            runOnUiThread(MainActivity.this::stopSleepPlayback);
        }

        @JavascriptInterface public void sleepDelete(String sessionId){
            runOnUiThread(MainActivity.this::stopSleepPlayback);
            worker.execute(()->{
                try{
                    SleepSessions.verifyId(sessionId);
                    if(SleepRecorderService.isCurrentSession(sessionId))
                        throw new IllegalStateException("不能删除正在录制的文件");
                    if(SleepAnalysisService.isRunning()&&
                        SleepAnalysisService.currentId().equals(sessionId))
                        throw new IllegalStateException("该录音仍在后台分析，完成后再移除");
                    JSONObject session=SleepSessions.load(MainActivity.this,sessionId);
                    // External SAF files are NEVER deleted or modified here.
                    // Old imported copies / our own recorder files are app-owned.
                    if(!SleepSessions.isExternal(session)){
                        File audio=SleepSessions.audio(MainActivity.this,sessionId);
                        if(audio.exists()&&!audio.delete())
                            throw new IllegalStateException("无法删除 App 内音频副本");
                    }
                    File cache=SleepSessions.envelopeFile(MainActivity.this,sessionId);
                    if(cache.exists()&&!cache.delete())
                        throw new IllegalStateException("无法删除 App 的图表缓存");
                    File metadata=SleepSessions.json(MainActivity.this,sessionId);
                    if(!metadata.delete())throw new IllegalStateException("无法移除睡眠记录");
                    if(SleepSessions.isExternal(session)){
                        try{
                            getContentResolver().releasePersistableUriPermission(
                                SleepSessions.externalUri(session),Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        }catch(SecurityException ignored){
                            // Permission may already be revoked by the document provider.
                        }
                    }
                    JSONObject notice=message("sleep_removed");
                    notice.put("id",sessionId);
                    notice.put("original_preserved",SleepSessions.isExternal(session));
                    reply(notice);
                    sendSleepStatus();
                }catch(Exception e){error("删除睡眠录音失败："+safeMessage(e));}
            });
        }

        @JavascriptInterface public void saveNutrition(String nutritionJson) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject event = validatedNutrition(nutritionJson);
                    JSONArray pending = plain.getPending();
                    pending.put(event);
                    plain.putPending(pending);
                    JSONArray days = appendLocal(localDays(), event);
                    plain.putDays(days);
                    JSONObject msg = message("nutrition_local_saved");
                    msg.put("event", event);
                    msg.put("count", pending.length());
                    msg.put("view_model", ViewProjector.project(days));
                    reply(msg);
                    // Nutrition event remains queued until daily/manual sync.
                } catch (Exception e) {
                    error("饮食记录失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void saveRaw(String text) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject raw = validatedRaw(text);
                    JSONArray pending = plain.getPending();
                    pending.put(raw);
                    plain.putPending(pending);
                    JSONArray history = localRawNotes();
                    JSONObject copy = new JSONObject(raw.toString());
                    copy.put("local_status", "queued");
                    history.put(copy);
                    plain.putRaw(history);
                    JSONObject saved = message("raw_local_saved");
                    saved.put("note", copy);
                    saved.put("count", pending.length());
                    reply(saved);
                    // Raw inbox stays local until daily/manual sync.
                } catch (Exception e) {
                    error("保存 Raw 失败：" + safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void disconnect() {
            worker.execute(() -> {
                // Offline-first: removing a token must never delete local history.
                vault.delete("token");
                JSONObject result = message("disconnected");
                reply(result);
            });
        }
    }

    private void voiceIpaTtsReport(String message){
        try{
            reply(message("voice_tts").put("state","status")
                .put("message",message));
        }catch(Exception ignored){}
    }

    private void playVoiceIpaWord(String word, java.util.Locale locale){
        if(exampleSpeechPlayer==null)
            exampleSpeechPlayer=new ExampleSpeechPlayer(this,this::voiceIpaTtsReport);
        exampleSpeechPlayer.speak(word,locale);
    }

    @Override protected void onPause() {
        if(ipaSamplePlayer!=null)ipaSamplePlayer.stop();
        if(voiceLab!=null&&voiceLab.isRunning())voiceLab.cancel(true);
        super.onPause();
    }

    @Override protected void onDestroy() {
        if(ipaSamplePlayer!=null)ipaSamplePlayer.stop();
        if(voiceLab!=null)voiceLab.cancel(false);
        if(exampleSpeechPlayer!=null){
            exampleSpeechPlayer.close();
            exampleSpeechPlayer=null;
        }
        unregisterReceiver(sleepAnalysisReceiver);
        stopSleepPlayback();
        sleepHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
        worker.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("BodyTraceNative");
            web.destroy();
            web = null;
        }
    }
}
