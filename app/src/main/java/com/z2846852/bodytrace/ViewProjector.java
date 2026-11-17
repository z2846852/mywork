package com.z2846852.bodytrace;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * Pure, versioned projection of source daily JSON.
 * Unknown optional fields remain untouched in raw JSON; derived data can be
 * discarded and rebuilt at any time without a network connection or Actions.
 */
final class ViewProjector {
    static final int VIEW_SCHEMA_VERSION = 1;

    private static String label(String key) {
        switch (key) {
            case "adductor": return "坐姿髋内收机（Adductor）";
            case "abductor": return "坐姿髋外展机（Abductor）";
            case "lateral_raise": return "坐姿侧平举机（Lateral Raise）";
            case "row": return "坐姿单侧划船（Seated Row）";
            case "assisted_pullup": return "辅助引体向上";
            case "assisted_dip": return "辅助双杠臂屈伸";
            case "smith_bench": return "史密斯卧推（Smith Machine Bench Press）";
            case "chest_press": return "坐姿胸推器";
            case "pec_deck": return "蝴蝶机夹胸（正向）";
            case "reverse_fly": return "反向蝴蝶机";
            case "vertical_traction": return "垂直下拉（Vertical Traction）";
            case "hip_thrust": return "臀推（Hip Thrust）";
            case "leg_press": return "倒蹬（Leg Press）";
            case "leg_extension": return "坐姿腿屈伸";
            case "shoulder_press": return "坐姿肩推器";
            case "incline_chest_press": return "上斜胸推器";
            case "horizontal_bench": return "水平卧推机";
            case "prone_leg_curl": return "俯卧腿弯举（Prone Leg Curl）";
            default: return key == null ? "未知动作" : key;
        }
    }

    static JSONObject project(JSONArray days) throws Exception {
        JSONArray workouts = new JSONArray();
        JSONArray measurements = new JSONArray();
        JSONArray nutrition = new JSONArray();
        TreeMap<String, Integer> counts = new TreeMap<>();
        TreeMap<String, JSONArray> metricSeries = new TreeMap<>();
        String[] metrics = { "weight_kg", "height_cm", "waist_cm", "chest_cm",
                "abdomen_cm", "hip_cm", "body_fat_pct", "muscle_mass_kg",
                "shoulder_cm", "upper_arm_cm", "thigh_cm", "calf_cm" };

        for (int d = 0; d < days.length(); d++) {
            JSONObject day = days.getJSONObject(d);
            String date = day.optString("date");
            if (!date.matches("\\d{4}-\\d{2}-\\d{2}")) continue;
            JSONArray training = day.optJSONArray("workouts");
            if (training != null) {
                for (int i = 0; i < training.length(); i++) {
                    JSONObject src = training.optJSONObject(i);
                    if (src == null) continue;
                    JSONObject item = new JSONObject();
                    item.put("id", src.optString("id", ""));
                    item.put("session_date", date);
                    String ex = src.optString("exercise_id", "unknown");
                    item.put("exercise_id", ex);
                    item.put("exercise", src.optString("exercise_label", label(ex)));
                    item.put("set_no", String.valueOf(i + 1));
                    item.put("reps", src.optString("reps", ""));
                    item.put("load_kg", src.has("load_kg") ? src.get("load_kg").toString() : "");
                    item.put("assistance_kg", src.has("assistance_kg")
                            ? src.get("assistance_kg").toString() : "");
                    item.put("machine_setting", src.has("machine_setting")
                            ? src.get("machine_setting").toString() : "");
                    item.put("approx", src.optBoolean("approx", false));
                    item.put("source", src.optString("source", "daily-json"));
                    item.put("rir", src.has("rir") && !src.isNull("rir")
                            ? src.get("rir").toString() : "");
                    String rirSource = src.optString("rir_source", "");
                    if (rirSource.isEmpty() && !src.has("rir") && src.optInt("reps", 99) < 15) {
                        rirSource = "user_rule_under_15";
                    }
                    item.put("rir_source", rirSource);
                    workouts.put(item);
                    counts.put(date, counts.getOrDefault(date, 0) + 1);
                }
            }
            JSONArray body = day.optJSONArray("measurements");
            if (body != null) {
                for (int i = 0; i < body.length(); i++) {
                    JSONObject src = body.optJSONObject(i);
                    if (src == null) continue;
                    JSONObject normalized = new JSONObject(src.toString());
                    normalized.put("reported_date", date);
                    measurements.put(normalized);
                    for (String metric : metrics) {
                        if (!src.has(metric) || src.isNull(metric)) continue;
                        Object value = src.get(metric);
                        if (!(value instanceof Number)) continue;
                        JSONArray series = metricSeries.get(metric);
                        if (series == null) {
                            series = new JSONArray();
                            metricSeries.put(metric, series);
                        }
                        series.put(new JSONObject().put("date", date).put("value", value));
                    }
                }
            }
            JSONArray food = day.optJSONArray("nutrition");
            if (food != null) {
                for (int i = 0; i < food.length(); i++) {
                    JSONObject item = food.optJSONObject(i);
                    if (item != null) {
                        JSONObject normalized = new JSONObject(item.toString());
                        normalized.put("date", date);
                        nutrition.put(normalized);
                    }
                }
            }
        }
        JSONArray heatmap = new JSONArray();
        for (Map.Entry<String,Integer> e : counts.entrySet()) {
            heatmap.put(new JSONObject().put("date", e.getKey()).put("sets", e.getValue()));
        }
        JSONObject series = new JSONObject();
        for (Map.Entry<String,JSONArray> e : metricSeries.entrySet()) {
            series.put(e.getKey(), e.getValue());
        }
        return new JSONObject()
                .put("view_schema_version", VIEW_SCHEMA_VERSION)
                .put("source_schema_version", 2)
                .put("workouts", workouts)
                .put("measurements", measurements)
                .put("nutrition", nutrition)
                .put("heatmap", heatmap)
                .put("metric_series", series);
    }

    private ViewProjector() { }
}
