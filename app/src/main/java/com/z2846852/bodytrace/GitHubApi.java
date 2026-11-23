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

    /** Distinguish private-repository PAT authorization from data-file access. */
    void verifyRepositoryAccess(String token) throws Exception {
        try {
            JSONObject repo = new JSONObject(request("GET", REPO, token, null));
            if (!"z2846852/-".equalsIgnoreCase(repo.optString("full_name"))) {
                throw new IllegalStateException("GitHub 返回了非预期仓库");
            }
        } catch (ApiStatusException e) {
            if (e.status == 404) {
                throw new IllegalStateException(
                        "HTTP 404（仓库授权）：私有 z2846852/- 已确认存在，当前 PAT 无权访问。" +
                        "检查 Resource owner 是否为 z2846852，且 Only select repositories " +
                        "确实勾选了名为 - 的私有仓库（不是 mywork）。");
            }
            throw e;
        }
    }

    /** List and retrieve daily JSON directly. No CSV or Actions required for charts. */
    JSONArray readDaily(String token) throws Exception {
        String listingJson;
        try {
            listingJson = request("GET", REPO + "/contents/data/daily?ref=main",
                    token, null);
        } catch (ApiStatusException e) {
            if (e.status == 404) {
                throw new IllegalStateException(
                        "HTTP 404（数据目录）：仓库授权通过，但无法读取 data/daily。" +
                        "请检查 PAT 的 Repository permissions → Contents 至少为 Read。");
            }
            throw e;
        }
        JSONArray listing = new JSONArray(listingJson);
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

    /** Upload every pending event for one date in ONE GitHub Contents PUT.
     * The date file is re-read on a write conflict; event UUIDs make retries
     * safe even if GitHub accepted a request whose response was lost.
     * Different dates remain independent commits; no force-push or overwrite. */
    void createEvents(String token, JSONArray events) throws Exception {
        if (events == null || events.length() == 0) return;
        String date = events.getJSONObject(0).getString("date");
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new IllegalArgumentException("Invalid daily date");
        }
        java.util.HashSet<String> inputIds = new java.util.HashSet<>();
        for (int i = 0; i < events.length(); ++i) {
            JSONObject event = events.getJSONObject(i);
            String id = event.getString("id");
            if (!date.equals(event.getString("date")) ||
                    !id.matches("[0-9a-f]{8}-[0-9a-f-]{27,40}") ||
                    "raw_note".equals(event.optString("type")) ||
                    !inputIds.add(id)) {
                throw new IllegalArgumentException("Invalid or duplicate daily event in batch");
            }
        }
        final String url = REPO + "/contents/data/daily/" + date + ".json";
        for (int attempt = 0; attempt < 4; ++attempt) {
            String existing = request("GET", url + "?ref=main", token, null, true);
            JSONObject daily;
            String sha = null;
            if (existing == null) {
                daily = new JSONObject();
                daily.put("schema_version", 2);
                daily.put("date", date);
                daily.put("workouts", new JSONArray());
                daily.put("measurements", new JSONArray());
                daily.put("nutrition", new JSONArray());
            } else {
                JSONObject meta = new JSONObject(existing);
                sha = meta.getString("sha");
                if (!"base64".equals(meta.getString("encoding"))) {
                    throw new IllegalStateException("Unexpected daily file encoding");
                }
                daily = new JSONObject(new String(Base64.decode(
                        meta.getString("content"), Base64.DEFAULT),
                        StandardCharsets.UTF_8));
                if (daily.getInt("schema_version") != 2 ||
                        !date.equals(daily.getString("date"))) {
                    throw new IllegalStateException("Unsupported daily JSON format/date");
                }
            }
            int added = 0;
            for (int i = 0; i < events.length(); ++i) {
                JSONObject event = events.getJSONObject(i);
                String id = event.getString("id");
                String type = event.optString("type");
                boolean isNutrition = "nutrition".equals(type);
                boolean isMeasurement = "measurement".equals(type);
                boolean isWorkoutEdit = "workout_edit".equals(type);
                String category = isNutrition ? "nutrition" :
                        isMeasurement ? "measurements" :
                        isWorkoutEdit ? "workout_edits" : "workouts";
                JSONArray records = daily.optJSONArray(category);
                if (records == null) {
                    records = new JSONArray();
                    daily.put(category, records);
                }
                boolean exists = false;
                for (int n = 0; n < records.length(); ++n) {
                    if (id.equals(records.getJSONObject(n).optString("id"))) {
                        exists = true;
                        break;
                    }
                }
                if (exists) continue; // Previously committed UUID: safe retry.
                if (records.length() >= 500)
                    throw new IllegalStateException("Daily record is full");
                JSONObject row = new JSONObject();
                String[] allowed = isNutrition ?
                        new String[]{"id", "meal", "food", "grams", "kcal_per_100g",
                            "protein_per_100g", "carbs_per_100g", "fat_per_100g",
                            "entry_kind", "intake_creatine", "intake_protein_powder",
                            "intake_carbs", "intake_sugar_oil", "source", "created_at"} :
                        isMeasurement ?
                        new String[]{"id", "weight_kg", "shoulder_cm", "chest_cm", "waist_cm",
                            "upper_arm_cm", "hip_cm", "thigh_cm", "calf_cm",
                            "source", "created_at"} :
                        isWorkoutEdit ?
                        new String[]{"id", "target_id", "action", "load_key", "load_kg",
                            "reps", "copies", "note", "source", "created_at"} :
                        new String[]{"id", "exercise_id", "exercise_label", "exercise_region",
                            "reps", "load_kg", "assistance_kg", "attempt_status",
                            "load_basis", "date_basis", "note", "source", "created_at"};
                for (String key : allowed)
                    if (event.has(key)) row.put(key, event.get(key));
                records.put(row);
                added++;
            }
            if (added == 0) return;
            JSONObject put = new JSONObject();
            put.put("message", "daily: batch append " + added + " records " + date);
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
                    // Re-read the latest remote file before merging again.
                    continue;
                }
                throw conflict;
            }
        }
        throw new IllegalStateException("Concurrent daily file update did not settle");
    }

    void createEvent(String token, JSONObject event) throws Exception {
        JSONArray one = new JSONArray();
        one.put(event);
        createEvents(token, one);
    }
    /** Fetch the latest 10 commit snapshots and their changed-file diffs from private data repo. */
    JSONArray readRecentCommits(String token) throws Exception {
        JSONArray listing = new JSONArray(request(
                "GET", REPO + "/commits?sha=main&per_page=10", token, null));
        JSONArray result = new JSONArray();
        for (int i = 0; i < listing.length() && i < 10; ++i) {
            JSONObject item = listing.getJSONObject(i);
            String sha = item.getString("sha");
            if (!sha.matches("[0-9a-f]{40}")) {
                throw new IllegalStateException("Git SHA 格式不合法");
            }
            JSONObject out = new JSONObject();
            out.put("sha", sha);
            JSONObject commit = item.optJSONObject("commit");
            if (commit != null) {
                String msg = commit.optString("message", "");
                int newLine = msg.indexOf('\n');
                out.put("message", newLine < 0 ? msg : msg.substring(0, newLine));
                JSONObject author = commit.optJSONObject("author");
                out.put("date", author == null ? "" : author.optString("date"));
            }
            try {
                JSONObject detail = new JSONObject(request(
                        "GET", REPO + "/commits/" + sha, token, null));
                JSONObject stats = detail.optJSONObject("stats");
                out.put("additions", stats == null ? 0 : stats.optInt("additions"));
                out.put("deletions", stats == null ? 0 : stats.optInt("deletions"));
                JSONArray changed = detail.optJSONArray("files");
                JSONArray files = new JSONArray();
                if (changed != null) {
                    for (int n = 0; n < changed.length() && n < 120; ++n) {
                        JSONObject remote = changed.getJSONObject(n);
                        JSONObject entry = new JSONObject();
                        for (String key : new String[]{"filename", "status", "additions", "deletions"}) {
                            if (remote.has(key)) entry.put(key, remote.get(key));
                        }
                        String patch = remote.optString("patch", "");
                        if (patch.length() > 20000) {
                            // Preserve more lines for an always-visible review, but bound
                            // WebView payload size for unusually large GitHub commits.
                            patch = patch.substring(0, 20000);
                            entry.put("patch_truncated", true);
                        }
                        entry.put("patch", patch);
                        files.put(entry);
                    }
                }
                out.put("files", files);
                out.put("incomplete", changed == null || changed.length() > files.length());
            } catch (Exception detailError) {
                out.put("detail_error", true);
            }
            result.put(out);
        }
        return result;
    }

    /** User-editable exercise settings; separate from daily training events. */
    JSONObject readExerciseCatalog(String token) throws Exception {
        String url = REPO + "/contents/data/exercise_catalog.json?ref=main";
        String current = request("GET", url, token, null, true);
        if (current == null) return null;
        JSONObject meta = new JSONObject(current);
        if (!"base64".equals(meta.getString("encoding"))) {
            throw new IllegalStateException("Exercise catalog encoding unsupported");
        }
        byte[] bytes = Base64.decode(meta.getString("content"), Base64.DEFAULT);
        if (bytes.length > 50000) throw new IllegalStateException("Exercise catalog too large");
        JSONObject result = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        result.put("_remote_sha", meta.getString("sha"));
        return result;
    }

    String writeExerciseCatalog(String token, JSONObject catalog) throws Exception {
        final String url = REPO + "/contents/data/exercise_catalog.json";
        JSONObject publicPart = new JSONObject(catalog.toString());
        publicPart.remove("_dirty"); // Local upload queue state is never remote JSON.
        publicPart.remove("_remote_sha"); // SHA baseline is never public JSON.
        String expectedSha = catalog.optString("_remote_sha", "");
        if (publicPart.optInt("schema_version") != 1) {
            throw new IllegalArgumentException("Unsupported catalog schema");
        }
        for (int attempt = 0; attempt < 4; ++attempt) {
            String existing = request("GET", url + "?ref=main", token, null, true);
            JSONObject put = new JSONObject();
            put.put("message", "settings: update BodyTrace exercise catalog");
            put.put("branch", "main");
            if (existing != null) {
                JSONObject meta = new JSONObject(existing);
                String currentSha = meta.getString("sha");
                if (!currentSha.equals(expectedSha)) {
                    // The response might have been lost after a successful upload.
                    String remoteText = new String(Base64.decode(
                            meta.getString("content"), Base64.DEFAULT), StandardCharsets.UTF_8);
                    JSONObject remote = new JSONObject(remoteText);
                    boolean equivalent = publicPart.optString("sort_mode").equals(remote.optString("sort_mode"))
                            && publicPart.getJSONArray("custom").toString().equals(
                                remote.optJSONArray("custom") == null ? "" : remote.getJSONArray("custom").toString())
                            && publicPart.getJSONArray("hidden").toString().equals(
                                remote.optJSONArray("hidden") == null ? "" : remote.getJSONArray("hidden").toString());
                    if (equivalent) return currentSha;
                    throw new IllegalStateException(
                        "远端动作目录已被其他人修改，本机设置已保留，拒绝覆盖远端；请先比较变更。");
                }
                put.put("sha", currentSha);
            } else if (!expectedSha.isEmpty()) {
                throw new IllegalStateException("远端动作目录已被删除，本机设置已保留，拒绝覆盖");
            }
            put.put("content", Base64.encodeToString(
                    (publicPart.toString(2) + "\n").getBytes(StandardCharsets.UTF_8),
                    Base64.NO_WRAP));
            try {
                JSONObject uploaded = new JSONObject(request("PUT", url, token, put.toString()));
                return uploaded.getJSONObject("content").getString("sha");
            } catch (ApiStatusException err) {
                if ((err.status == 409 || err.status == 422) && attempt < 3) continue;
                throw err;
            }
        }
        throw new IllegalStateException("Exercise catalog update did not settle");
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
        boolean allowedLogRead = "GET".equals(method) &&
                (address.equals(REPO + "/commits?sha=main&per_page=10")
                 || address.matches(java.util.regex.Pattern.quote(REPO) + "/commits/[0-9a-f]{40}"));
        if (!address.equals(REPO) && !address.startsWith(REPO + "/contents/")
                && !allowedLogRead) {
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
                String label = status == 401 ? "HTTP 401：令牌无效、被撤销或已过期"
                        : status == 403 ? ("0".equals(connection.getHeaderField("X-RateLimit-Remaining"))
                            ? "HTTP 403：GitHub API 请求额度耗尽，请稍后再同步"
                            : connection.getHeaderField("Retry-After")!=null
                                ? "HTTP 403：GitHub 暂时限流，请停止重复同步并稍后再试"
                                : "HTTP 403：私有仓库访问被拒绝，可能是 PAT 权限或 GitHub 限流")
                        : status == 404 ? "HTTP 404：私有仓库/资源对当前令牌不可见"
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
