package com.z2846852.bodytrace;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Conservative phone-inactivity detection, NOT a measurement of actual sleep.
 * Uses complete screen-off -> screen-on evidence without a fixed bedtime cutoff.
 * Short, paired screen-on periods are tolerated; power loss is a hard barrier.
 * Never infers a duration from the first/last event to the scan boundary.
 */
final class PhoneSleepInference {
    static final int SCREEN_ON=15, SCREEN_OFF=16;
    static final int KEYGUARD_SHOWN=17, KEYGUARD_HIDDEN=18;
    static final int USER_INTERACTION=7;
    static final int SHUTDOWN=26, STARTUP=27;
    static final long MINUTE=60_000L, HOUR=60*MINUTE;
    static final long MIN_GAP=4*HOUR;
    static final long QUICK_CHECK=30_000L;
    static final long MAX_SHORT_USE=2*MINUTE;
    static final long MAX_TOTAL_SHORT_USE=5*MINUTE;
    static final long REPEATED_WINDOW=30*MINUTE;
    static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");

    static final class Event {
        final long ms;
        final int kind;
        Event(long ms,int kind){this.ms=ms;this.kind=kind;}
    }

    static final class Night {
        final String day, state, reason;
        final long offMs,onMs,gapMs,shortUseMs;
        final int screenOn,unlock,screenOff,shortUseCount;
        Night(String day,String state,long off,long on,long gap,
              long shortUseMs,int shortUseCount,int screenOn,int unlock,
              int screenOff,String reason){
            this.day=day;this.state=state;offMs=off;onMs=on;gapMs=gap;
            this.shortUseMs=shortUseMs;this.shortUseCount=shortUseCount;
            this.screenOn=screenOn;this.unlock=unlock;this.screenOff=screenOff;
            this.reason=reason;
        }
    }

    private static final class Interval {
        final long from,to;
        final int epoch;
        Interval(long from,long to,int epoch){
            this.from=from;this.to=to;this.epoch=epoch;
        }
    }

    private PhoneSleepInference(){}
    static String date(long ms){
        return Instant.ofEpochMilli(ms).atZone(ZONE).toLocalDate().toString();
    }

    /**
     * Default label is an algorithmic sleep entry, never a medically verified
     * result. The user may override it manually at any time.
     */
    static String automaticStatus(long start,long end){
        if(end<=start||end-start<MIN_GAP)return "unknown";
        int hour=Instant.ofEpochMilli(start).atZone(ZONE).getHour();
        // Late sleepers (including 05:00) are normal; afternoon inactivity is not.
        boolean typical=hour>=21 || hour<9;
        return typical && end-start<=16*HOUR?"auto_sleep":"unknown";
    }

    private static Night report(long start,long end,long shortUse,int shortCount,
                                List<Event> events){
        if(end-start<MIN_GAP)return null;
        int ons=0,offs=0,unlocks=0;
        for(Event e:events){
            if(e.ms<start)continue;
            if(e.ms>end)break;
            if(e.kind==SCREEN_ON)ons++;
            if(e.kind==SCREEN_OFF)offs++;
            if(e.kind==KEYGUARD_HIDDEN)unlocks++;
        }
        boolean typical="auto_sleep".equals(automaticStatus(start,end));
        String state=typical?"candidate":"unknown";
        String reason=typical?
            "睡眠（自动识别）：基于连续无明显手机使用记录，并非实测睡眠":
            "异常时间或超长未使用：保持未知，可自行查看或修改";
        return new Night(date(end),state,start,end,end-start,shortUse,shortCount,
            ons,unlocks,offs,reason);
    }

    static List<Night> infer(List<Event> input,long now){
        ArrayList<Night> result=new ArrayList<>();
        if(input==null||input.isEmpty())return result;
        ArrayList<Event> events=new ArrayList<>();
        for(Event event:input){
            if(event.ms>0&&event.ms<=now)events.add(event);
        }
        if(events.isEmpty())return result;
        events.sort(Comparator.comparingLong(e->e.ms));
        ArrayList<Interval> intervals=new ArrayList<>();
        long lastOff=-1;
        int epoch=0;
        for(Event event:events){
            if(event.kind==SHUTDOWN||event.kind==STARTUP){
                lastOff=-1;
                epoch++; // Never merge across a reboot or event discontinuity.
            }else if(event.kind==SCREEN_OFF){
                if(lastOff<0)lastOff=event.ms;
            }else if(event.kind==SCREEN_ON){
                if(lastOff>=0&&event.ms>lastOff)
                    intervals.add(new Interval(lastOff,event.ms,epoch));
                lastOff=-1;
            }
        }

        if(!intervals.isEmpty()){
            Interval first=intervals.get(0);
            long start=first.from,end=first.to,totalShort=0,activeShort=0;
            int count=0,activeEpoch=first.epoch;
            ArrayList<Long> activeWakes=new ArrayList<>();
            for(int i=1;i<intervals.size();i++){
                Interval next=intervals.get(i);
                long awake=next.from-end;
                boolean evidenceOfInteraction=false;
                for(Event event:events){
                    if(event.ms<end)continue; // Unlock may share the ON timestamp.
                    if(event.ms>=next.from)break;
                    if(event.kind==KEYGUARD_HIDDEN ||
                       event.kind==USER_INTERACTION){
                        evidenceOfInteraction=true;break;
                    }
                }
                // A notification/clock flash is NOT a deliberate phone use.
                // Frequent passive flashes therefore do not trigger the
                // three-active-wakes rule or consume its 5-minute budget.
                boolean passive=awake>=0&&awake<=QUICK_CHECK &&
                                !evidenceOfInteraction;
                long counted=passive?0:awake;
                int recent=0;
                for(long wake:activeWakes)
                    if(next.from-wake<=REPEATED_WINDOW)recent++;
                boolean canMerge=next.epoch==activeEpoch &&
                    awake>=0 && awake<=MAX_SHORT_USE &&
                    activeShort+counted<=MAX_TOTAL_SHORT_USE &&
                    (passive||recent<2);
                if(canMerge){
                    totalShort+=awake;
                    activeShort+=counted;
                    count++;
                    if(!passive)activeWakes.add(end);
                    end=next.to;
                }else{
                    Night night=report(start,end,totalShort,count,events);
                    if(night!=null)result.add(night);
                    start=next.from;end=next.to;totalShort=0;
                    activeShort=0;count=0;
                    activeEpoch=next.epoch;
                    activeWakes.clear();
                }
            }
            Night night=report(start,end,totalShort,count,events);
            if(night!=null)result.add(night);
        }
        // The last OFF without a subsequent ON is an unfinished observation.
        // It has no measured end time and must not be saved as completed sleep.
        if(lastOff>=0&&now>lastOff){
            result.add(new Night(date(now),"pending",lastOff,0,0,0,0,0,0,1,
                "仍未观察到后续亮屏，区间尚未结束，不推测睡眠时长"));
        }
        result.sort(Comparator.comparingLong(n->n.offMs));
        return result;
    }
}
