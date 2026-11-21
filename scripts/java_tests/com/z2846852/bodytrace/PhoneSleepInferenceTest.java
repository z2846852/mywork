package com.z2846852.bodytrace;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Plain JDK regression: no invented sleep duration, no arbitrary 7-day cut. */
public final class PhoneSleepInferenceTest {
    private static long t(String date,int hour,int minute){
        return LocalDate.parse(date).atTime(hour,minute)
            .atZone(PhoneSleepInference.ZONE).toInstant().toEpochMilli();
    }
    private static PhoneSleepInference.Event event(String day,int h,int m,int kind){
        return new PhoneSleepInference.Event(t(day,h,m),kind);
    }
    private static void check(boolean v,String reason){
        if(!v)throw new AssertionError(reason);
    }
    private static PhoneSleepInference.Night find(List<PhoneSleepInference.Night> nights,String day){
        for(PhoneSleepInference.Night n:nights)if(day.equals(n.day))return n;
        throw new AssertionError("Missing "+day);
    }
    public static void main(String[] args){
        List<PhoneSleepInference.Event> data=new ArrayList<>();
        data.add(event("2026-11-20",23,30,PhoneSleepInference.SCREEN_OFF));
        data.add(event("2026-11-21",7,30,PhoneSleepInference.SCREEN_ON));
        data.add(event("2026-11-21",7,31,PhoneSleepInference.KEYGUARD_HIDDEN));
        data.add(event("2026-11-21",23,10,PhoneSleepInference.SCREEN_OFF));
        data.add(event("2026-11-22",7,15,PhoneSleepInference.SCREEN_ON));
        List<PhoneSleepInference.Night> nights=PhoneSleepInference.infer(
            data,t("2026-11-22",10,0));
        PhoneSleepInference.Night first=find(nights,"2026-11-21");
        check("candidate".equals(first.state),"Must find paired off/on window");
        check(first.offMs==t("2026-11-20",23,30),"Correct screen off start");
        check(first.onMs==t("2026-11-21",7,30),"Correct morning screen on end");
        check(first.gapMs==8*PhoneSleepInference.HOUR,"Eight-hour inactivity");
        check(first.unlock==1,"Count keyguard unlock separately from screen activation");
        check(first.reason.contains("不等于真实睡眠"),
            "Must never assert phone inactivity proves sleep");
        PhoneSleepInference.Night next=find(nights,"2026-11-22");
        check(next.gapMs==8*PhoneSleepInference.HOUR+5*60000L,
            "Second night should be inferred independently");
        check(first.day.equals("2026-11-21")&&next.day.equals("2026-11-22"),
            "Night assigned to morning date");
        List<PhoneSleepInference.Event> disconnected=new ArrayList<>();
        disconnected.add(event("2026-11-20",23,0,PhoneSleepInference.SCREEN_OFF));
        disconnected.add(event("2026-11-21",3,0,PhoneSleepInference.SHUTDOWN));
        disconnected.add(event("2026-11-21",7,0,PhoneSleepInference.STARTUP));
        disconnected.add(event("2026-11-21",7,1,PhoneSleepInference.SCREEN_ON));
        PhoneSleepInference.Night off=find(PhoneSleepInference.infer(disconnected,
            t("2026-11-21",10,0)),"2026-11-21");
        check("insufficient".equals(off.state),
            "Shutdown must not be misread as a continuous screen-off night");
        List<PhoneSleepInference.Event> unpaired=new ArrayList<>();
        unpaired.add(event("2026-11-20",21,0,PhoneSleepInference.KEYGUARD_SHOWN));
        unpaired.add(event("2026-11-21",7,0,PhoneSleepInference.KEYGUARD_HIDDEN));
        check("insufficient".equals(find(PhoneSleepInference.infer(unpaired,
            t("2026-11-21",10,0)),"2026-11-21").state),
            "Unpaired keyguard events must not create fabricated time windows");
        // No app-imposed recent N-day history: an old event is processed if
        // Android's queryEvents actually returns it.
        List<PhoneSleepInference.Event> older=new ArrayList<>();
        older.add(event("2026-10-20",23,0,PhoneSleepInference.SCREEN_OFF));
        older.add(event("2026-10-21",7,0,PhoneSleepInference.SCREEN_ON));
        check("candidate".equals(find(PhoneSleepInference.infer(older,
            t("2026-11-22",10,0)),"2026-10-21").state),
            "Old retained events must not be discarded by a seven-day cutoff");
        check(PhoneSleepInference.infer(List.of(),t("2026-11-22",10,0)).isEmpty(),
            "No events must not create a fabricated report");
        System.out.println("PhoneSleepInferenceTest passed: multiple nights, clock, "
            +"missing pairs, shutdown, historical range, non-medical semantics");
    }
}
