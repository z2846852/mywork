package com.z2846852.bodytrace;

import android.util.Base64;
import org.json.JSONObject;

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

    String readFile(String token, String path) throws Exception {
        if (!path.equals("data/workouts.csv") && !path.equals("data/measurements.csv")) {
            throw new IllegalArgumentException("Read path not allowed");
        }
        String address = REPO + "/contents/" + path + "?ref=main";
        JSONObject response = new JSONObject(request("GET", address, token, null));
        if (!"base64".equals(response.optString("encoding"))) {
            throw new IllegalStateException("GitHub file encoding unsupported");
        }
        String encoded = response.getString("content").replace("\n", "");
        return new String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8);
    }

    void createEvent(String token, JSONObject event) throws Exception {
        String date = event.getString("date");
        String id = event.getString("id");
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}") ||
                !id.matches("[0-9a-f]{8}-[0-9a-f-]{27,40}")) {
            throw new IllegalArgumentException("Invalid event path");
        }
        String path = "data/app_events/" + date + "/" + id + ".json";
        JSONObject body = new JSONObject();
        body.put("message", "app: training event " + date + " " + id.substring(0, 8));
        body.put("branch", "main");
        body.put("content", Base64.encodeToString(
                (event.toString(2) + "\n").getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        request("PUT", REPO + "/contents/" + path, token, body.toString());
    }

    private String request(String method, String address, String token, String json) throws Exception {
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
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            String response = stream == null ? "" : slurp(stream);
            if (status < 200 || status >= 300) {
                // Never echo API response or bearer token into the WebView.
                String label = status == 401 ? "令牌无效或过期"
                        : status == 403 ? "没有访问权限或触发 GitHub 限制"
                        : status == 404 ? "文件不存在或仓库不可访问"
                        : status == 409 ? "GitHub 写入冲突"
                        : status == 422 ? "事件已存在或请求不符合 GitHub 规则"
                        : "GitHub HTTP " + status;
                throw new IllegalStateException(label);
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
