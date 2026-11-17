package com.z2846852.bodytrace;

import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;

import javax.net.ssl.HttpsURLConnection;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** All network traffic goes directly to GitHub over HTTPS; no app-owned backend. */
final class GitHubApi {
    private static final String REPO = "https://api.github.com/repos/z2846852/-";
    private static final int LIMIT = 4 * 1024 * 1024;

    /** List and retrieve daily JSON directly. No CSV or Actions required for charts. */
    JSONArray readDaily(String token) throws Exception {
        JSONArray listing = new JSONArray(request("GET", REPO + "/contents/data/daily?ref=main",
                token, null));
        if (listing.length() >= 1000) {
            throw new IllegalStateException("GitHub directory listing reached 1000 files; shard by year before continuing");
        }
        JSONArray result = new JSONArray();
        for (int i = 0; i < listing.length(); i++) {
            JSONObject entry = listing.getJSONObject(i);
            String name = entry.optString("name");
            if (!"file".equals(entry.optString("type")) ||
                    !name.matches("\\d{4}-\\d{2}-\\d{2}\\.json")) continue;
            if (entry.optLong("size") > 1000000) {
                throw new IllegalStateException("One daily JSON file is too large");
            }
            String url = REPO + "/contents/data/daily/" + name + "?ref=main";
            JSONObject meta = new JSONObject(request("GET", url, token, null));
            if (!"base64".equals(meta.optString("encoding"))) {
                throw new IllegalStateException("Unsupported daily file encoding");
            }
            String decoded = new String(Base64.decode(
                    meta.getString("content"), Base64.DEFAULT),
                    StandardCharsets.UTF_8);
            JSONObject daily = new JSONObject(decoded);
            if (daily.getInt("schema_version") != 2 ||
                    !name.equals(daily.getString("date") + ".json")) {
                throw new IllegalStateException("Invalid daily JSON schema/date");
            }
            result.put(daily);
        }
        return result;
    }

    /** Append a single event to ONE daily JSON file with SHA optimistic locking. */
    void createEvent(String token, JSONObject event) throws Exception {
        String date = event.getString("date");
        String id = event.getString("id");
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}") ||
                !id.matches("[0-9a-f]{8}-[0-9a-f-]{27,40}")) {
            throw new IllegalArgumentException("Invalid daily record identity");
        }
        final String path = "data/daily/" + date + ".json";
        final String url = REPO + "/contents/" + path;
        for (int attempt = 0; attempt < 4; ++attempt) {
            // A missing day is expected; a missing repository/token was already
            // rejected when the user connected via the protected workouts CSV.
            String existing = request("GET", url + "?ref=main", token, null, true);
            JSONObject daily;
            String sha = null;
            if (existing == null) {
                daily = new JSONObject();
                daily.put("schema_version", 2);
                daily.put("date", date);
                daily.put("workouts", new org.json.JSONArray());
                daily.put("measurements", new org.json.JSONArray());
                daily.put("nutrition", new org.json.JSONArray());
            } else {
                JSONObject meta = new JSONObject(existing);
                sha = meta.getString("sha");
                if (!"base64".equals(meta.getString("encoding"))) {
                    throw new IllegalStateException("Unexpected daily file encoding");
                }
                String decoded = new String(Base64.decode(
                        meta.getString("content").replace("\n", ""), Base64.DEFAULT),
                        StandardCharsets.UTF_8);
                daily = new JSONObject(decoded);
                if (daily.getInt("schema_version") != 2 ||
                        !date.equals(daily.getString("date"))) {
                    throw new IllegalStateException("Unsupported daily JSON format/date");
                }
            }
            boolean isNutrition = "nutrition".equals(event.optString("type"));
            String category = isNutrition ? "nutrition" : "workouts";
            JSONArray records = daily.optJSONArray(category);
            if (records == null) {
                records = new JSONArray();
                daily.put(category, records);
            }
            if (records.length() >= 500) throw new IllegalStateException("Daily record is full");
            for (int i = 0; i < records.length(); ++i) {
                if (id.equals(records.getJSONObject(i).optString("id"))) {
                    return; // Successful earlier upload: idempotent retry.
                }
            }
            JSONObject row = new JSONObject();
            String[] allowed = isNutrition ?
                    new String[]{"id", "meal", "food", "grams", "kcal_per_100g",
                        "protein_per_100g", "carbs_per_100g", "fat_per_100g",
                        "source", "created_at"} :
                    new String[]{"id", "exercise_id", "reps", "load_kg",
                        "assistance_kg", "source", "created_at"};
            for (String key : allowed) if (event.has(key)) row.put(key, event.get(key));
            records.put(row);
            JSONObject put = new JSONObject();
            put.put("message", "daily: append " + category + " " + date + " " + id.substring(0, 8));
            put.put("branch", "main");
            if (sha != null) put.put("sha", sha);
            put.put("content", Base64.encodeToString(
                    (daily.toString(2) + "\n").getBytes(StandardCharsets.UTF_8),
                    Base64.NO_WRAP));
            try {
                request("PUT", url, token, put.toString());
                return;
            } catch (ApiStatusException conflict) {
                if ((conflict.status == 409 || conflict.status == 422) && attempt < 3) {
                    // Re-read latest SHA and reapply event, never clobber a group.
                    continue;
                }
                throw conflict;
            }
        }
        throw new IllegalStateException("Concurrent daily file update did not settle");
    }
    /** Write a raw, uninterpreted note to the private inbox; one file per note. */
    void createRawNote(String token, JSONObject note) throws Exception {
        String date = note.getString("date");
        String id = note.getString("id");
        String value = note.getString("text");
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}") ||
                !id.matches("[0-9a-f]{8}-[0-9a-f-]{27,40}") ||
                value.trim().isEmpty() || value.length() > 10000) {
            throw new IllegalArgumentException("Invalid raw inbox note");
        }
        String path = "data/raw_inbox/" + date + "/" + id + ".json";
        String url = REPO + "/contents/" + path;
        JSONObject body = new JSONObject();
        body.put("message", "raw: archive unprocessed note " + date + " " + id.substring(0, 8));
        body.put("branch", "main");
        body.put("content", Base64.encodeToString(
                (note.toString(2) + "\n").getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        try {
            request("PUT", url, token, body.toString());
        } catch (ApiStatusException e) {
            if (e.status != 409 && e.status != 422) throw e;
            // A request may have succeeded before a network timeout. Treat it as
            // idempotent only if the stored note is exactly the same raw text.
            JSONObject saved = new JSONObject(request("GET", url + "?ref=main", token, null));
            String decoded = new String(Base64.decode(
                    saved.getString("content"), Base64.DEFAULT), StandardCharsets.UTF_8);
            JSONObject existing = new JSONObject(decoded);
            if (!id.equals(existing.optString("id")) ||
                    !value.equals(existing.optString("text"))) {
                throw e;
            }
        }
    }

    private static final class ApiStatusException extends IllegalStateException {
        final int status;
        ApiStatusException(int status, String text) {
            super(text);
            this.status = status;
        }
    }

    private String request(String method, String address, String token, String json) throws Exception {
        return request(method, address, token, json, false);
    }

    private String request(String method, String address, String token, String json,
                           boolean allowMissing) throws Exception {
        if (!address.startsWith(REPO + "/contents/")) {
            throw new SecurityException("Unexpected API host/path");
        }
        if (token == null || token.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing GitHub token");
        }
        HttpsURLConnection connection = (HttpsURLConnection) new URL(address).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            if (json != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] payload = json.getBytes(StandardCharsets.UTF_8);
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(payload);
                }
            }
            int status = connection.getResponseCode();
            if (status == 204) return ""; // repository_dispatch success has no body
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            String response = stream == null ? "" : slurp(stream);
            if (status == 404 && allowMissing) return null;
            if (status < 200 || status >= 300) {
                // Never echo API response or bearer token into the WebView.
                String label = status == 401 ? "令牌无效或过期"
                        : status == 403 ? "没有访问权限或触发 GitHub 限制"
                        : status == 404 ? "文件不存在或仓库不可访问"
                        : status == 409 ? "GitHub 写入冲突"
                        : status == 422 ? "事件已存在或请求不符合 GitHub 规则"
                        : "GitHub HTTP " + status;
                throw new ApiStatusException(status, label);
            }
            return response;
        } finally {
            connection.disconnect();
        }
    }

    private static String slurp(InputStream stream) throws Exception {
        try (InputStream in = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (bytes.size() + n > LIMIT) throw new IllegalStateException("GitHub response too large");
                bytes.write(buffer, 0, n);
            }
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }
}
