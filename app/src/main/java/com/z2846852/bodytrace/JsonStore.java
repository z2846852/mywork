package com.z2846852.bodytrace;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Plain UTF-8 JSON stored in app-private files. Only the PAT uses Keystore.
 * Original daily JSON is separate from derived view_model.json.
 */
final class JsonStore {
    private final File root;
    private final File daysDir;

    JsonStore(Context context) {
        root = new File(context.getFilesDir(), "bodytrace");
        daysDir = new File(root, "daily");
        if (!daysDir.isDirectory() && !daysDir.mkdirs()) {
            throw new IllegalStateException("Cannot create BodyTrace storage");
        }
    }

    private String read(File path) throws Exception {
        if (!path.isFile()) return null;
        if (path.length() > 8 * 1024 * 1024) throw new IllegalStateException("JSON file too large");
        return new String(Files.readAllBytes(path.toPath()), StandardCharsets.UTF_8);
    }

    private static void atomicWrite(File destination, String value) throws Exception {
        AtomicFile atomic = new AtomicFile(destination);
        FileOutputStream out = null;
        try {
            out = atomic.startWrite();
            out.write(value.getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(out);
        } catch (Exception failure) {
            if (out != null) atomic.failWrite(out);
            throw failure;
        }
    }

    synchronized JSONArray getDays() throws Exception {
        File[] list = daysDir.listFiles((dir, name) ->
                name.matches("\\d{4}-\\d{2}-\\d{2}\\.json"));
        if (list == null) throw new IllegalStateException("Unable to list local daily JSON");
        Arrays.sort(list, (a,b) -> a.getName().compareTo(b.getName()));
        JSONArray data = new JSONArray();
        for (File f : list) {
            JSONObject item = new JSONObject(read(f));
            if (!f.getName().equals(item.getString("date") + ".json")) {
                throw new IllegalStateException("Local daily JSON date mismatch");
            }
            data.put(item);
        }
        return data;
    }

    synchronized void putDays(JSONArray days) throws Exception {
        for (int i = 0; i < days.length(); i++) {
            JSONObject item = days.getJSONObject(i);
            String date = item.getString("date");
            if (!date.matches("\\d{4}-\\d{2}-\\d{2}")) {
                throw new IllegalArgumentException("Bad daily JSON date");
            }
            File file = new File(daysDir, date + ".json");
            atomicWrite(file, item.toString(2) + "\n");
        }
    }

    synchronized JSONArray getPending() throws Exception {
        String s = read(new File(root, "pending.json"));
        return new JSONArray(s == null ? "[]" : s);
    }

    synchronized void putPending(JSONArray list) throws Exception {
        atomicWrite(new File(root, "pending.json"), list.toString(2) + "\n");
    }

    synchronized JSONArray getRaw() throws Exception {
        String s = read(new File(root, "raw_entries.json"));
        return new JSONArray(s == null ? "[]" : s);
    }

    synchronized void putRaw(JSONArray list) throws Exception {
        atomicWrite(new File(root, "raw_entries.json"), list.toString(2) + "\n");
    }

    synchronized void putView(JSONObject projection) throws Exception {
        atomicWrite(new File(root, "view_model.json"), projection.toString(2) + "\n");
    }

    synchronized String getView() throws Exception {
        String s = read(new File(root, "view_model.json"));
        return s == null ? "{}" : s;
    }

    String locationDescription() {
        return "应用私有存储/files/bodytrace (明文 JSON，无媒体权限，其他普通应用不能直接读取)";
    }
}
