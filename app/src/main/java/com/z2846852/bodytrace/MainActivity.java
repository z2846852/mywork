package com.z2846852.bodytrace;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    private final GitHubApi github = new GitHubApi();
    private static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);

    @Override @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(13, 17, 23));
        getWindow().setNavigationBarColor(Color.rgb(13, 17, 23));
        vault = new SecureStore(getApplicationContext());
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
            web.loadDataWithBaseURL("https://bodytrace.invalid/", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            web.loadData("<h1>本地界面加载失败</h1>", "text/html", "UTF-8");
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
        String value = vault.read("daily_json");
        return new JSONArray(value == null ? "[]" : value);
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
        JSONArray workouts = current.getJSONArray("workouts");
        for (int i = 0; i < workouts.length(); ++i) {
            if (event.getString("id").equals(workouts.getJSONObject(i).optString("id"))) {
                return days;
            }
        }
        JSONObject set = new JSONObject();
        for (String key : new String[]{"id", "exercise_id", "reps", "source", "created_at"}) {
            if (event.has(key)) set.put(key, event.get(key));
        }
        String loadKey = event.has("assistance_kg") ? "assistance_kg" : "load_kg";
        set.put(loadKey, event.getDouble(loadKey));
        workouts.put(set);
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
            String token = vault.read("token");
            JSONObject status = message("status");
            status.put("connected", token != null && !token.isEmpty());
            status.put("repo", "z2846852/-");
            reply(status);
            JSONObject cached = message("data");
            cached.put("days", localDays());
            cached.put("cached", true);
            reply(cached);
            String raw = vault.read("pending");
            JSONArray pending = new JSONArray(raw == null ? "[]" : raw);
            JSONObject q = message("pending");
            q.put("count", pending.length());
            q.put("events", pending);
            reply(q);
            // No automatic GitHub network access on startup. User controls sync.
        } catch (Exception e) {
            error("本机加密缓存无法读取，请检查系统密钥或重新连接。");
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
            vault.write("daily_json", combined.toString());
            JSONObject result = message("data");
            result.put("days", combined);
            result.put("cached", false);
            reply(result);
        } catch (Exception e) {
            error("GitHub 同步失败，本地数据仍保留：" + safeMessage(e));
        }
    }

    private void drainPending(String token) throws Exception {
        String str = vault.read("pending");
        JSONArray pending = new JSONArray(str == null ? "[]" : str);
        while (pending.length() > 0) {
            JSONObject event = pending.getJSONObject(0);
            github.createEvent(token, event);
            JSONArray remaining = new JSONArray();
            for (int i = 1; i < pending.length(); ++i) remaining.put(pending.getJSONObject(i));
            vault.write("pending", remaining.toString());
            pending = remaining;
            JSONObject saved = message("saved");
            saved.put("event", event);
            reply(saved);
        }
        JSONObject result = message("pending");
        result.put("count", 0);
        reply(result);
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
        result.put("id", UUID.randomUUID().toString());
        result.put("date", date);
        result.put("exercise_id", ex);
        result.put("reps", reps);
        result.put(ex.equals("assisted_pullup") ? "assistance_kg" : "load_kg", kg);
        result.put("created_at", OffsetDateTime.now(BEIJING).toString());
        result.put("source", "bodytrace-android");
        return result;
    }

    private final class Bridge {
        @JavascriptInterface public void ready() {
            worker.execute(MainActivity.this::restore);
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
                    JSONArray remote = github.readDaily(token);
                    JSONArray combined = mergeDays(localDays(), remote);
                    vault.write("token", token);
                    vault.write("daily_json", combined.toString());
                    JSONObject status = message("status");
                    status.put("connected", true);
                    status.put("repo", "z2846852/-");
                    reply(status);
                    JSONObject data = message("data");
                    data.put("days", combined);
                    data.put("cached", false);
                    reply(data);
                    // Do not upload automatically. User chooses when to sync.
                } catch (Exception e) {
                    error("连接失败：" + safeMessage(e));
                }
            });
        }
        @JavascriptInterface public void sync() {
            worker.execute(() -> {
                try {
                    String token = vault.read("token");
                    if (token == null) { error("请先连接 GitHub"); return; }
                    syncInternal(token);
                } catch (Exception e) { error(safeMessage(e)); }
            });
        }
        @JavascriptInterface public void save(String eventJson) {
            worker.execute(() -> {
                try {
                    JSONObject event = validatedEvent(eventJson);
                    String raw = vault.read("pending");
                    JSONArray pending = new JSONArray(raw == null ? "[]" : raw);
                    pending.put(event);
                    // Keep the outbox first: recovery can replay it if storage
                    // fails between the two encrypted preference writes.
                    vault.write("pending", pending.toString());
                    JSONArray days = appendLocal(localDays(), event);
                    vault.write("daily_json", days.toString());
                    JSONObject saved = message("local_saved");
                    saved.put("event", event);
                    saved.put("count", pending.length());
                    saved.put("days", days);
                    reply(saved);
                    // No network action until manual Sync GitHub.
                } catch (Exception e) {
                    error("记录失败：" + safeMessage(e));
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
