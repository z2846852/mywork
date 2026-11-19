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
            case "leg_extension": return "坐姿腿屈伸（Leg Extension）";
            case "seated_leg_curl": return "坐姿腿弯举";
            case "leg_press_45": return "45°倒蹬";
            case "single_leg_press": return "单腿倒蹬";
            case "barbell_bench": return "杠铃平板卧推";
            case "dumbbell_bench": return "哑铃平板卧推";
            case "incline_dumbbell_bench": return "上斜哑铃卧推";
            case "decline_bench": return "下斜卧推";
            case "front_raise": return "三角肌前束 · 前平举";
            case "rear_delt_fly": return "三角肌后束 · 反向飞鸟";
            case "dumbbell_shoulder_press": return "哑铃肩推";
            case "overhead_press": return "杠铃推举";
            case "face_pull": return "面拉";
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
        TreeMap<String, JSONObject> nutritionTotals = new TreeMap<>();
        TreeMap<String, Integer> regionCounts = new TreeMap<>();
        JSONArray strengthPoints = new JSONArray();
        final String[] areas = {"胸","肩","背","腿","其他"};
        for (String area : areas) regionCounts.put(area, 0);
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
                    item.put("exercise_region", src.optString("exercise_region", ""));
                    item.put("set_no", String.valueOf(i + 1));
                    item.put("reps", src.optString("reps", ""));
                    item.put("load_kg", src.has("load_kg") ? src.get("load_kg").toString() : "");
                    item.put("assistance_kg", src.has("assistance_kg")
                            ? src.get("assistance_kg").toString() : "");
                    item.put("machine_setting", src.has("machine_setting")
                            ? src.get("machine_setting").toString() : "");
                    item.put("approx", src.optBoolean("approx", false));
                    item.put("attempt_status", src.optString("attempt_status", ""));
                    item.put("load_basis", src.optString("load_basis", ""));
                    item.put("date_basis", src.optString("date_basis", ""));
                    item.put("note", src.optString("note", ""));
                    item.put("source", src.optString("source", "daily-json"));
                    item.put("created_at", src.optString("created_at", ""));
                    item.put("rir", src.has("rir") && !src.isNull("rir")
                            ? src.get("rir").toString() : "");
                    String rirSource = src.optString("rir_source", "");
                    if (rirSource.isEmpty() && !src.has("rir") && src.optInt("reps", 99) > 0 && src.optInt("reps", 99) < 15) {
                        rirSource = "user_rule_under_15";
                    }
                    item.put("rir_source", rirSource);
                    workouts.put(item);
                    counts.put(date, counts.getOrDefault(date, 0) + 1);
                    String region = src.optString("exercise_region", "");
                    if (region.isEmpty()) switch (ex) {
                        case "chest_press": case "smith_bench": case "pec_deck":
                        case "incline_chest_press": case "horizontal_bench":
                        case "assisted_dip": case "barbell_bench": case "dumbbell_bench":
                        case "incline_dumbbell_bench": case "decline_bench":
                            region = "胸"; break;
                        case "lateral_raise": case "reverse_fly": case "shoulder_press":
                        case "front_raise": case "rear_delt_fly":
                        case "dumbbell_shoulder_press": case "overhead_press": case "face_pull":
                            region = "肩"; break;
                        case "row": case "assisted_pullup": case "vertical_traction":
                            region = "背"; break;
                        case "adductor": case "abductor": case "leg_press":
                        case "leg_extension": case "prone_leg_curl": case "hip_thrust":
                        case "leg_press_45": case "single_leg_press": case "seated_leg_curl":
                            region = "腿"; break;
                        default: region = "";
                    }
                    // Keep only four named macro-regions; all residual categories
                    // (including legacy arms/core) are counted under Other.
                    if (!regionCounts.containsKey(region)) region = "其他";
                    regionCounts.put(region, regionCounts.get(region) + 1);
                    if (src.has("load_kg") && src.has("reps") &&
                            !src.isNull("load_kg") && !src.isNull("reps")) {
                        double load = src.optDouble("load_kg", Double.NaN);
                        int reps = src.optInt("reps", 0);
                        if (Double.isFinite(load) && load >= 0 && reps > 0 && reps <= 15) {
                            strengthPoints.put(new JSONObject()
                                    .put("id", src.optString("id"))
                                    .put("date", date)
                                    .put("exercise_id", ex)
                                    .put("load_kg", load)
                                    .put("reps", reps)
                                    .put("e1rm_reference_kg",
                                            Math.round(load * (1 + reps / 30.0) * 10.0) / 10.0));
                        }
                    }
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
                        // Checkboxes are a qualitative daily snapshot, not a food with
                        // kcal/100g. Keep them in nutrition, exclude them from calorie totals.
                        if ("daily_checkin".equals(item.optString("entry_kind"))) continue;
                        JSONObject daily = nutritionTotals.get(date);
                        if (daily == null) {
                            daily = new JSONObject().put("date", date)
                                    .put("entry_count", 0).put("known_calories", 0)
                                    .put("missing_calories", 0);
                            nutritionTotals.put(date, daily);
                        }
                        daily.put("entry_count", daily.getInt("entry_count") + 1);
                        double calories = Double.NaN;
                        if (item.has("grams") && item.has("kcal_per_100g")) {
                            calories = item.optDouble("grams", Double.NaN) *
                                    item.optDouble("kcal_per_100g", Double.NaN) / 100.0;
                        } else if (item.has("kcal_total")) {
                            calories = item.optDouble("kcal_total", Double.NaN);
                        }
                        if (Double.isFinite(calories) && calories >= 0) {
                            daily.put("known_calories",
                                    Math.round((daily.getDouble("known_calories") +
                                            calories) * 10.0) / 10.0);
                        } else {
                            daily.put("missing_calories", daily.getInt("missing_calories") + 1);
                        }
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
                .put("metric_series", series)
                .put("strength_points", strengthPoints)
                .put("region_total_sets", new JSONObject(regionCounts))
                .put("nutrition_daily", new JSONArray(nutritionTotals.values()))
                .put("profile_defaults",
                        new JSONObject().put("height_cm", 173.5)
                                .put("height_source", "user_selected_constant"));
    }

    private ViewProjector() { }
}
