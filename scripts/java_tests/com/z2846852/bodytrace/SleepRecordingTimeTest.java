package com.z2846852.bodytrace;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

/** Plain-JDK regression for sleep start dates inferred from recorder filenames. */
public final class SleepRecordingTimeTest {
    private static long beijing(int y,int m,int d,int h,int minute,int sec){
        return LocalDateTime.of(y,m,d,h,minute,sec)
            .toInstant(ZoneOffset.ofHours(8)).toEpochMilli();
    }
    private static void check(boolean okay,String what){
        if(!okay)throw new AssertionError(what);
    }
    public static void main(String[] args){
        long now=beijing(2026,11,22,12,0,0);
        long start=beijing(2026,7,28,2,5,55);
        long duration=(5*3600L+24*60L+38)*1000L;
        long mediaDate=beijing(2026,7,28,7,30,34);
        SleepRecordingTime.Guess sample=SleepRecordingTime.infer(
            "20260728_020555.m4a",duration,mediaDate,now);
        check(sample!=null,"Recognize recorder filename datetime");
        check(sample.startMillis==start,"Recorder started at 02:05:55, NOT 07:30:34");
        check(sample.mediaLooksLikeEnd,"Metadata near recording end");
        check(sample.basis.equals(SleepRecordingTime.FILENAME_END_MATCH),
            "Mark filename and duration corroboration");
        check(Math.abs((sample.startMillis+duration)-mediaDate)==1000,
            "Container DATE is almost exactly the end (+1 second)");
        check(SleepRecordingTime.filenameStart("REC_2026-07-28_02-05-55.m4a",now)==start,
            "Allow ISO-like date and time separators");
        check(SleepRecordingTime.filenameStart("20260728020555.mp3",now)==start,
            "Recognize contiguous 14-digit timestamp");
        check(SleepRecordingTime.filenameStart("20260230_020555.m4a",now)==null,
            "Reject invalid dates");
        check(SleepRecordingTime.filenameStart("20270728_020555.m4a",now)==null,
            "Reject future filenames");
        check(SleepRecordingTime.filenameStart("voice_123456789.m4a",now)==null,
            "Reject filenames without a complete timestamp");
        SleepRecordingTime.Guess notCorroborated=SleepRecordingTime.infer(
            "20260728_020555.m4a",duration,start,now);
        check(notCorroborated!=null&&!notCorroborated.mediaLooksLikeEnd,
            "Media start-like dates must not be mislabeled as end");
        check(notCorroborated.basis.equals(SleepRecordingTime.FILENAME_INFERRED),
            "Without end corroboration, keep filename-based inference labeled");
        check(SleepRecordingTime.infer("voice.m4a",duration,mediaDate,now)==null,
            "Without filename date, do not silently infer recording start");
        System.out.println("SleepRecordingTimeTest passed: filename start, "
            +"1-second end corroboration, variants, invalid/future and uncertainty");
    }
}
