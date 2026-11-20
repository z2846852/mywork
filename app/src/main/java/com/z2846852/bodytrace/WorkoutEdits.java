package com.z2846852.bodytrace;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * A deterministic materialized view of immutable workout rows + append-only
 * edit/delete events. The original workout UUID and history stay in the JSON.
 *
 * Applying both local and remote edits after union prevents deleted entries
 * from being resurrected by the next GitHub pull.
 */
final class WorkoutEdits {
    private WorkoutEdits() {}

    static JSONArray apply(JSONArray originals, JSONArray changes) throws Exception {
        LinkedHashMap<String,JSONObject> rows = new LinkedHashMap<>();
        if (originals != null) {
            for (int i = 0; i < originals.length(); i++) {
                JSONObject source = originals.optJSONObject(i);
                if (source == null) continue;
                JSONObject copy = new JSONObject(source.toString());
                String id = copy.optString("id", "");
                if (id.isEmpty()) id = "legacy-row-" + i;
                rows.put(id, copy);
            }
        }
        if (changes == null || changes.length() == 0) {
            return new JSONArray(rows.values());
        }
        ArrayList<JSONObject> operations = new ArrayList<>();
        for (int i = 0; i < changes.length(); i++) {
            JSONObject op = changes.optJSONObject(i);
            if (op != null && !op.optString("id","").isEmpty()) operations.add(op);
        }
        operations.sort(Comparator.comparing((JSONObject op) ->
                op.optString("created_at", "")).thenComparing(op ->
                op.optString("id", "")));
        for (JSONObject op : operations) {
            String target = op.optString("target_id","");
            JSONObject original = rows.get(target);
            if (original == null) continue; // Out-of-order sync, no fabricated data.
            String action = op.optString("action","");
            if ("delete".equals(action)) {
                rows.remove(target);
                continue;
            }
            if (!"replace".equals(action)) continue;
            int reps = op.optInt("reps",-1);
            int copies = op.optInt("copies",1);
            String loadKey = op.optString("load_key","");
            double load = op.optDouble("load_kg",Double.NaN);
            if (reps<0 || reps>200 || copies<1 || copies>10 ||
                    !("load_kg".equals(loadKey)||"assistance_kg".equals(loadKey)) ||
                    !Double.isFinite(load) || load<0 || load>500) continue;
            JSONObject revised = new JSONObject(original.toString());
            revised.put("reps",reps);
            revised.remove("load_kg");
            revised.remove("assistance_kg");
            revised.put(loadKey,load);
            if(reps==0)revised.put("attempt_status","failed");
            else if("failed".equals(revised.optString("attempt_status")))revised.remove("attempt_status");
            if(op.has("note")) {
                String note = op.optString("note","");
                if (note.isEmpty()) revised.remove("note");
                else revised.put("note",note);
            }
            rows.put(target,revised); // LinkedHashMap preserves original order.
            for(int i=1;i<copies;i++){
                JSONObject extra = new JSONObject(revised.toString());
                String newId=UUID.nameUUIDFromBytes(
                    (op.getString("id")+":"+i).getBytes(StandardCharsets.UTF_8)).toString();
                extra.put("id",newId);
                extra.put("created_at",op.optString("created_at",""));
                extra.put("source","bodytrace-edit-copy");
                rows.put(newId,extra);
            }
        }
        JSONArray output = new JSONArray();
        for(Map.Entry<String,JSONObject> entry: rows.entrySet()) output.put(entry.getValue());
        return output;
    }
}
