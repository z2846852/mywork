package com.z2846852.bodytrace;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Distinguish a recorder filename's start timestamp from an M4A media date,
 * which commonly denotes the end of recording / the final file write.
 *
 * A filename timestamp is an inference, not an authenticated creation time.
 * The user-specified recording start always takes precedence in MainActivity.
 * This helper is standard Java and can be regression-tested without Android.
 */
final class SleepRecordingTime {
    private SleepRecordingTime(){}

    static final String FILENAME_INFERRED="filename_inferred";
    static final String FILENAME_END_MATCH="filename_media_end_match";

    private static final long EARLIEST=946684800000L; // 2000-01-01 UTC
    private static final long DAY_MS=86_400_000L;
    private static final Pattern START_PATTERN=Pattern.compile(
        "(?<![0-9])((?:19|20)[0-9]{2})[-_]?([0-9]{2})[-_]?([0-9]{2})"+
        "[T _-]?([0-9]{2})[:._-]?([0-9]{2})[:._-]?([0-9]{2})(?![0-9])");

    static final class Guess {
        final long startMillis;
        final String basis;
        final boolean mediaLooksLikeEnd;
        Guess(long millis,String source,boolean end){
            startMillis=millis;basis=source;mediaLooksLikeEnd=end;
        }
    }

    static Long filenameStart(String name,long nowMillis) {
        if(name==null||name.length()>255)return null;
        Matcher matcher=START_PATTERN.matcher(name);
        while(matcher.find()){
            try{
                LocalDateTime date=LocalDateTime.of(
                    Integer.parseInt(matcher.group(1)),
                    Integer.parseInt(matcher.group(2)),
                    Integer.parseInt(matcher.group(3)),
                    Integer.parseInt(matcher.group(4)),
                    Integer.parseInt(matcher.group(5)),
                    Integer.parseInt(matcher.group(6)));
                long start=date.toInstant(ZoneOffset.ofHours(8)).toEpochMilli();
                // Do not treat unrelated, future or placeholder numbers as dates.
                if(start>=EARLIEST && start<=nowMillis+DAY_MS)return start;
            }catch(DateTimeException|NumberFormatException ignored){
                // Search for a later valid timestamp in the filename.
            }
        }
        return null;
    }

    static Guess infer(String name,long durationMillis,Long mediaDate,long nowMillis){
        Long filenameStart=filenameStart(name,nowMillis);
        if(filenameStart==null)return null;
        boolean mediaEnd=false;
        if(mediaDate!=null&&durationMillis>0&&durationMillis<7L*DAY_MS){
            long expectedEnd=filenameStart+durationMillis;
            // AAC/MP4 container duration may be rounded; allow 10 seconds or
            // 0.1% of duration (up to 90 seconds) for muxer finalization.
            long tolerance=Math.max(10_000L,Math.min(90_000L,durationMillis/1000));
            mediaEnd=Math.abs(mediaDate-expectedEnd)<=tolerance;
        }
        return new Guess(filenameStart,mediaEnd?FILENAME_END_MATCH:FILENAME_INFERRED,mediaEnd);
    }
}
