package com.z2846852.bodytrace;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
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
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SecureStore vault;
    private JsonStore plain;
    private boolean migrated = false;
    private final GitHubApi github = new GitHubApi();
    private static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);
    private static final int PICK_AVATAR_REQUEST = 7005;
    private static final int AVATAR_MAX_BYTES = 12 * 1024 * 1024;
    private volatile Uri pendingSharedAvatar = null;
    private volatile boolean uiReady = false;

    @Override @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        pendingSharedAvatar = sharedImageUri(getIntent());
        getWindow().setStatusBarColor(Color.rgb(13, 17, 23));
        getWindow().setNavigationBarColor(Color.rgb(13, 17, 23));
        vault = new SecureStore(getApplicationContext());
        plain = new JsonStore(getApplicationContext());
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
        });
        web.addJavascriptInterface(new Bridge(), "BodyTraceNative");
        setContentView(web);
        try {
            String html = readAsset("index.html");
            // Bundle all UI code with the APK: no remote scripts or styles.
            String css = readAsset("features.css");
            String js = readAsset("features.js");
            html = html.replace("</head>", "<style>" + css + "</style></head>");
            // The friendly cartoon avatar is a local SVG; no heavy GLB or
            // third-party scripts are loaded in the 2D release.
            html = html.replace("</body>", "<script>" + js + "</script></body>");
            // Embed the bundled cartoon or imported artwork as a data URI: the WebView
            // intentionally cannot fetch network or local-file URLs.
            AvatarResource resource = activeAvatar();
            String avatar = android.util.Base64.encodeToString(
                    resource.bytes, android.util.Base64.NO_WRAP);
            html = html.replace("__BODY_AVATAR_BASE64__", avatar)
                    .replace("__BODY_AVATAR_MIME__", resource.mime);
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
        return new AvatarResource(readAssetBytes("avatar_cartoon.svg"), "image/svg+xml");
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_AVATAR_REQUEST || resultCode != RESULT_OK) return;
        Uri uri = data == null ? null : data.getData();
        worker.execute(() -> {
            try {
                importAvatar(uri);
            } catch (Exception error) {
                error("导入高清人物图失败：" + safeMessage(error));
            }
        });
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
        boolean nutrition = "nutrition".equals(event.optString("type"));
        String category = nutrition ? "nutrition" : "workouts";
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
                            && !key.equals("nutrition")) {
                        existing.put(key, incoming.get(key));
                    }
                }
                for (String category : new String[]{"workouts", "measurements", "nutrition"}) {
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
            // No network pull on startup. Records are still locally available. User controls sync.
        } catch (Exception e) {
            error("本机 JSON 读取或旧版本迁移失败，可先在 GitHub 检查备份。");
        }
    }

    /** Explicit sync is push-outbox followed by pull-and-merge, never overwrite. */
    private void syncInternal(String token) {
        try {
            try { drainPending(token); }
            catch (Exception upload) {
                error("有记录尚未上传，已保留本地：" + safeMessage(upload));
            }
            JSONArray remote = github.readDaily(token);
            JSONArray combined = mergeDays(localDays(), remote);
            plain.putDays(combined);
            replyData(combined, false);
        } catch (Exception e) {
            error("GitHub 同步失败，本地数据仍保留：" + safeMessage(e));
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

    private void drainPending(String token) throws Exception {
        JSONArray pending = plain.getPending();
        while (pending.length() > 0) {
            JSONObject event = pending.getJSONObject(0);
            boolean isRaw = "raw_note".equals(event.optString("type"));
            if (isRaw) {
                github.createRawNote(token, event);
            } else {
                // Legacy queued records without type remain workouts.
                github.createEvent(token, event);
            }
            JSONArray remaining = new JSONArray();
            for (int i = 1; i < pending.length(); ++i) remaining.put(pending.getJSONObject(i));
            plain.putPending(remaining);
            pending = remaining;
            if (isRaw) {
                markRawUploaded(event.getString("id"));
                JSONObject result = message("raw_uploaded");
                result.put("id", event.getString("id"));
                reply(result);
            } else {
                JSONObject saved = message("saved");
                saved.put("event", event);
                saved.put("category", "nutrition".equals(event.optString("type")) ?
                        "nutrition" : "workouts");
                reply(saved);
            }
            sendPending();
        }
    }

    private static String safeMessage(Exception e) {
        String s = e.getMessage();
        return s == null ? "未知错误" : s.length() > 140 ? s.substring(0, 140) : s;
    }

    private static JSONObject validatedEvent(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!day.toString().equals(date) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("训练日期不合法");
        }
        String id = input.getString("exercise_id");
        String ex;
        switch (id) {
            case "adductor": case "abductor": case "lateral_raise": case "row":
            case "assisted_pullup": case "smith_bench": case "chest_press":
            case "pec_deck": case "reverse_fly": case "vertical_traction":
                ex = id; break;
            default: throw new IllegalArgumentException("暂不支持该训练动作");
        }
        int reps = input.getInt("reps");
        double kg = input.getDouble("kg");
        if (reps < 1 || reps > 200 || !Double.isFinite(kg) || kg < 0 || kg > 500
                || Math.rint(kg * 10) != kg * 10) {
            throw new IllegalArgumentException("重量须为0–500kg、最多一位小数；次数1–200");
        }
        JSONObject result = new JSONObject();
        result.put("schema_version", 1);
        result.put("type", "workout");
        result.put("id", UUID.randomUUID().toString());
        result.put("date", date);
        result.put("exercise_id", ex);
        result.put("reps", reps);
        result.put(ex.equals("assisted_pullup") ? "assistance_kg" : "load_kg", kg);
        result.put("created_at", OffsetDateTime.now(BEIJING).toString());
        result.put("source", "bodytrace-android");
        return result;
    }

    private static JSONObject validatedNutrition(String request) throws Exception {
        JSONObject input = new JSONObject(request);
        String date = input.getString("date");
        LocalDate day = LocalDate.parse(date);
        if (!date.equals(day.toString()) || day.isAfter(LocalDate.now(BEIJING).plusDays(1))) {
            throw new IllegalArgumentException("饮食日期不合法");
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
            worker.execute(() -> {
                restore();
                uiReady = true;
                consumePendingSharedAvatar();
            });
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
                    JSONArray remote = github.readDaily(token);
                    JSONArray combined = mergeDays(localDays(), remote);
                    // Persist the JSON first; only the PAT remains encrypted.
                    plain.putDays(combined);
                    vault.write("token", token);
                    JSONObject status = message("status");
                    status.put("connected", true);
                    status.put("repo", "z2846852/-");
                    reply(status);
                    replyData(combined, false);
                    // Connected App writes upload immediately; new local records
                    // are always saved before network starts.
                    try { drainPending(token); }
                    catch (Exception upload) {
                        error("待上传记录已保留本机：" + safeMessage(upload));
                    }
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
                    if (token == null) { error("请先连接 GitHub"); return; }
                    syncInternal(token);
                } catch (Exception e) { error(safeMessage(e)); }
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
        @JavascriptInterface public void save(String eventJson) {
            worker.execute(() -> {
                try {
                    ensureMigrated();
                    JSONObject event = validatedEvent(eventJson);
                    JSONArray pending = plain.getPending();
                    pending.put(event);
                    // Outbox is persisted first, so interrupted saves can retry.
                    plain.putPending(pending);
                    JSONArray days = appendLocal(localDays(), event);
                    plain.putDays(days);
                    JSONObject view = ViewProjector.project(days);
                    plain.putView(view);
                    JSONObject saved = message("local_saved");
                    saved.put("event", event);
                    saved.put("count", pending.length());
                    saved.put("days", days);
                    saved.put("view_model", view);
                    reply(saved);
                    // Persist-first, then upload immediately when authenticated.
                    String token = vault.read("token");
                    if (token != null) {
                        try { drainPending(token); }
                        catch (Exception upload) {
                            error("已保存本地，GitHub 上传失败，稍后可重试：" + safeMessage(upload));
                            sendPending();
                        }
                    }
                } catch (Exception e) {
                    error("记录失败：" + safeMessage(e));
                }
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
                    String token = vault.read("token");
                    if (token != null && !token.isEmpty()) {
                        try { drainPending(token); }
                        catch (Exception e) {
                            error("饮食记录已保留本机，尚未同步 GitHub：" + safeMessage(e));
                        }
                    }
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
                    String token = vault.read("token");
                    if (token != null) {
                        try { drainPending(token); }
                        catch (Exception upload) {
                            error("Raw 已保存本地，GitHub 上传失败：" + safeMessage(upload));
                            sendPending();
                        }
                    }
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

    @Override protected void onDestroy() {
        super.onDestroy();
        worker.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("BodyTraceNative");
            web.destroy();
            web = null;
        }
    }
}
