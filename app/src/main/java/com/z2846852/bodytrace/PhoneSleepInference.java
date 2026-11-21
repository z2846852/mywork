package com.z2846852.bodytrace;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Conservative, deterministic phone-activity inference.
 *
 * Only reports a SCREEN-OFF -> subsequent SCREEN-ON inactivity window.
 * This is NOT actual sleep: screen-off audiobook listening, nocturnal
 * awakenings without device use and an alarm can all bias this estimate.
 * A full night is labeled insufficient when it has no paired evidence.
 * No fixed rolling-day retention limit: Android decides queryEvents storage.
 */
final class PhoneSleepInference {
    static final int SCREEN_ON=15,SCREEN_OFF=16;
    static final int KEYGUARD_SHOWN=17,KEYGUARD_HIDDEN=18;
    static final int SHUTDOWN=26,STARTUP=27;
    static final long HOUR=3600000L;
    static final long MIN_GAP=2*HOUR;
    static final long MAX_GAP=16*HOUR;
    static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");

    static final class Event {
        final long ms;
        final int kind;
        Event(long ms,int kind){this.ms=ms;this.kind=kind;}
    }

    static final class Night {
        final String day;
        final String state;
        final long offMs,onMs,gapMs;
        final int screenOn,unlock,screenOff;
        final String reason;
        Night(String day,String state,long off,long on,long gap,
              int screenOn,int unlock,int screenOff,String reason){
            this.day=day;this.state=state;offMs=off;onMs=on;gapMs=gap;
            this.screenOn=screenOn;this.unlock=unlock;this.screenOff=screenOff;
            this.reason=reason;
        }
    }
    private PhoneSleepInference(){}
    private static long clock(LocalDate day,int hour){
        return day.atTime(hour,0).atZone(ZONE).toInstant().toEpochMilli();
    }
    static String date(long ms){
        return Instant.ofEpochMilli(ms).atZone(ZONE).toLocalDate().toString();
    }

    static List<Night> infer(List<Event> input,long now){
        ArrayList<Night> reports=new ArrayList<>();
        if(input.isEmpty())return reports;
        ArrayList<Event> data=new ArrayList<>(input);
        data.sort(Comparator.comparingLong(e->e.ms));
        LocalDate oldest=Instant.ofEpochMilli(data.get(0).ms)
            .atZone(ZONE).toLocalDate();
        LocalDate latest=Instant.ofEpochMilli(
            Math.min(now,data.get(data.size()-1).ms))
            .atZone(ZONE).toLocalDate();
        LocalDate current=Instant.ofEpochMilli(now).atZone(ZONE).toLocalDate();
        // Calendar nights end on the MORNING day. No arbitrary 7/30-day cutoff.
        for(LocalDate date=oldest;!date.isAfter(latest)&&
                !date.isAfter(current);date=date.plusDays(1)){
            long begin=clock(date.minusDays(1),18);
            long end=clock(date,12);
            long wakeBegin=clock(date,4);
            long lastBedtime=clock(date,4);
            long bestGap=0,bestOff=0,bestOn=0;
            int screenOn=0,unlock=0,screenOff=0,incidentCount=0;
            long lastOff=-1;
            boolean interrupted=false;
            for(Event event:data){
                if(event.ms<begin)continue;
                if(event.ms>=end)break;
                int type=event.kind;
                incidentCount++;
                if(type==SCREEN_OFF){
                    screenOff++;
                    lastOff=event.ms;
                    interrupted=false;
                }else if(type==SCREEN_ON){
                    screenOn++;
                    if(lastOff>=begin&&lastOff<=lastBedtime&&
                       event.ms>=wakeBegin&&event.ms<end&&!interrupted){
                        long gap=event.ms-lastOff;
                        if(gap>=MIN_GAP&&gap<=MAX_GAP&&gap>bestGap){
                            bestGap=gap;bestOff=lastOff;bestOn=event.ms;
                        }
                    }
                    lastOff=-1;interrupted=false;
                }else if(type==KEYGUARD_HIDDEN){
                    unlock++;
                    // An unlock is evidence of wakeful interaction, not itself
                    // a screen-on. Do NOT manufacture a missing pair.
                }else if(type==SHUTDOWN||type==STARTUP){
                    interrupted=true;
                    lastOff=-1;
                }
            }
            String state=bestGap>0?"candidate":"insufficient";
            String reason=bestGap>0?
                "最长连续熄屏窗口：可作为休息机会的参考，不等于真实睡眠":
                incidentCount==0?"无可用屏幕或解锁事件":
                "缺少可配对的夜间熄屏与早晨亮屏事件";
            reports.add(new Night(date.toString(),state,bestOff,bestOn,
                bestGap,screenOn,unlock,screenOff,reason));
        }
        return reports;
    }
}
