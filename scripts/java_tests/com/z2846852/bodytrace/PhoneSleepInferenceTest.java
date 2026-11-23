package com.z2846852.bodytrace;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Plain-JDK regressions for all-day phone inactivity detection. */
public final class PhoneSleepInferenceTest {
    private static long t(String date,int hour,int minute){
        return LocalDate.parse(date).atTime(hour,minute)
            .atZone(PhoneSleepInference.ZONE).toInstant().toEpochMilli();
    }
    private static PhoneSleepInference.Event e(String day,int h,int m,int kind){
        return new PhoneSleepInference.Event(t(day,h,m),kind);
    }
    private static void check(boolean ok,String reason){
        if(!ok)throw new AssertionError(reason);
    }
    private static PhoneSleepInference.Night find(List<PhoneSleepInference.Night> items,
                                                  String day){
        for(PhoneSleepInference.Night item:items)
            if(day.equals(item.day)&&!"pending".equals(item.state))return item;
        throw new AssertionError("Missing completed window for "+day);
    }
    private static List<PhoneSleepInference.Night> run(List<PhoneSleepInference.Event> events,
                                                       String day,int hour){
        return PhoneSleepInference.infer(events,t(day,hour,0));
    }

    public static void main(String[] args){
        final int off=PhoneSleepInference.SCREEN_OFF;
        final int on=PhoneSleepInference.SCREEN_ON;
        List<PhoneSleepInference.Event> normal=List.of(
            e("2026-11-20",23,30,off),
            e("2026-11-21",7,30,on));
        PhoneSleepInference.Night first=find(run(normal,"2026-11-21",13),"2026-11-21");
        check("candidate".equals(first.state),"Normal night should be suspected");
        check(first.gapMs==8*PhoneSleepInference.HOUR,"Normal eight-hour interval");
        check(first.reason.contains("不等于真实睡眠"),"Never assert actual sleep");

        // The old hardcoded 04:00 bedtime and 12:00 wake cutoffs excluded this.
        List<PhoneSleepInference.Event> late=List.of(
            e("2026-11-22",5,20,off),
            e("2026-11-22",13,5,on));
        PhoneSleepInference.Night lateNight=find(run(late,"2026-11-22",16),"2026-11-22");
        check(lateNight.offMs==t("2026-11-22",5,20),"Must accept late bedtime");
        check(lateNight.gapMs==7*PhoneSleepInference.HOUR+45*60_000L,
            "Late-morning wake can extend past noon");

        // Two short screen activations: clock/notification and a brief unlock.
        List<PhoneSleepInference.Event> brief=new ArrayList<>();
        brief.add(e("2026-11-21",23,0,off));
        brief.add(e("2026-11-22",1,0,on));
        brief.add(new PhoneSleepInference.Event(t("2026-11-22",1,0)+20_000L,off));
        brief.add(e("2026-11-22",3,0,on));
        brief.add(e("2026-11-22",3,0,PhoneSleepInference.KEYGUARD_HIDDEN));
        brief.add(e("2026-11-22",3,1,off));
        brief.add(e("2026-11-22",8,0,on));
        PhoneSleepInference.Night joined=find(run(brief,"2026-11-22",13),"2026-11-22");
        check(joined.offMs==t("2026-11-21",23,0),"Merge starts at original off");
        check(joined.onMs==t("2026-11-22",8,0),"Merge ends at final wake");
        check(joined.shortUseCount==2,"Track two short interruptions");
        check(joined.shortUseMs==80_000L,"Track exact short-use duration");
        check(joined.gapMs==9*PhoneSleepInference.HOUR,"Wall-clock interval");
        check(joined.unlock==1,"Unlock evidence should be preserved");

        // Meaningful >2-minute awake period splits two independent candidates.
        List<PhoneSleepInference.Event> split=List.of(
            e("2026-11-21",23,0,off),e("2026-11-22",3,10,on),
            e("2026-11-22",3,20,off),e("2026-11-22",9,0,on));
        List<PhoneSleepInference.Night> splitReports=run(split,"2026-11-22",13);
        check(splitReports.size()==2,"Two long windows on the same day are retained");
        check(splitReports.get(0).onMs==t("2026-11-22",3,10),
            "Long screen-on period ends the first candidate");
        check(splitReports.get(1).offMs==t("2026-11-22",3,20),
            "Second candidate starts at the next screen off");

        // Three short wakes in half an hour must NOT all be fused.
        List<PhoneSleepInference.Event> repeated=List.of(
            e("2026-11-21",22,0,off),
            e("2026-11-22",3,0,on),e("2026-11-22",3,0,PhoneSleepInference.KEYGUARD_HIDDEN),
            e("2026-11-22",3,1,off),
            e("2026-11-22",3,10,on),e("2026-11-22",3,10,PhoneSleepInference.KEYGUARD_HIDDEN),
            e("2026-11-22",3,11,off),
            e("2026-11-22",3,20,on),e("2026-11-22",3,20,PhoneSleepInference.KEYGUARD_HIDDEN),
            e("2026-11-22",3,21,off),
            e("2026-11-22",8,0,on));
        List<PhoneSleepInference.Night> repeatedReports=run(repeated,"2026-11-22",13);
        check(repeatedReports.size()==2,"Third repeated wake splits the sequence");

        // Three brief notifications in half an hour without a user unlock
        // must not be counted as three active wakeups.
        List<PhoneSleepInference.Event> notifications=List.of(
            e("2026-11-21",23,0,off),
            e("2026-11-22",3,0,on),
            new PhoneSleepInference.Event(t("2026-11-22",3,0)+20_000L,off),
            e("2026-11-22",3,10,on),
            new PhoneSleepInference.Event(t("2026-11-22",3,10)+20_000L,off),
            e("2026-11-22",3,20,on),
            new PhoneSleepInference.Event(t("2026-11-22",3,20)+20_000L,off),
            e("2026-11-22",8,0,on));
        List<PhoneSleepInference.Night> passive=run(notifications,"2026-11-22",13);
        check(passive.size()==1&&passive.get(0).shortUseCount==3,
            "Passive notification flashes must not fragment a long sleep candidate");

        List<PhoneSleepInference.Event> day=List.of(
            e("2026-11-22",14,0,off),e("2026-11-22",19,0,on));
        check("unknown".equals(find(run(day,"2026-11-22",21),
            "2026-11-22").state),"Nonstandard daytime gap requires review");

        List<PhoneSleepInference.Event> shutdown=List.of(
            e("2026-11-20",23,0,off),
            e("2026-11-21",3,0,PhoneSleepInference.SHUTDOWN),
            e("2026-11-21",7,0,PhoneSleepInference.STARTUP),
            e("2026-11-21",7,1,on));
        check(run(shutdown,"2026-11-21",13).isEmpty(),
            "Power cycle cannot create a continuous sleep interval");
        check(run(List.of(
            e("2026-11-20",21,0,PhoneSleepInference.KEYGUARD_SHOWN),
            e("2026-11-21",7,0,PhoneSleepInference.KEYGUARD_HIDDEN)),
            "2026-11-21",13).isEmpty(),
            "Unpaired keyguard events cannot invent sleep");

        List<PhoneSleepInference.Event> old=List.of(
            e("2026-10-20",23,0,off),e("2026-10-21",7,0,on));
        check(run(old,"2026-11-22",13).size()==1,
            "Retained old events must work without a fixed 7-day cutoff");
        List<PhoneSleepInference.Night> pending=run(
            List.of(e("2026-11-21",23,0,off)),"2026-11-22",3);
        check(pending.size()==1&&"pending".equals(pending.get(0).state)&&
              pending.get(0).gapMs==0,
            "Unfinished observation must not claim any measured duration");
        check(run(List.of(),"2026-11-22",13).isEmpty(),
            "No events must never create a fake record");
        System.out.println("PhoneSleepInferenceTest passed");
    }
}
