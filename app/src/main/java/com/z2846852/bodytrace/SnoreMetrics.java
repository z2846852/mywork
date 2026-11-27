package com.z2846852.bodytrace;

/** One-second candidate windows, not measured sleep or clinical apnea events.
 * q/h: silent quiet/hit; Q/H: feedback armed quiet/hit; ?: unobserved.
 * Unknown windows are never treated as quiet. */
final class SnoreMetrics {
    private SnoreMetrics() {}
    static final int MAX_SECONDS=12*3600;
    static boolean valid(char c){return c=='q'||c=='h'||c=='Q'||c=='H';}
    static boolean hit(char c){return c=='h'||c=='H';}
    static boolean armed(char c){return c=='Q'||c=='H';}
    static char at(CharSequence windows,int i){return i>=0&&i<windows.length()?windows.charAt(i):'?';}
    static void record(StringBuilder windows,int second,char value){
        if(second<0||second>=MAX_SECONDS||second<windows.length())return;
        while(windows.length()<second)windows.append('?');
        windows.append(value);
    }
    static final double OFFLINE_THRESHOLD=0.15;
    /** Old cache padded an unfinished final window with zero; exclude it.
     * Lowercase states encode candidates only; mode is explicitly unknown in offline summaries. */
    static String offlineWindows(double[] scores){
        StringBuilder out=new StringBuilder(scores.length);
        for(int i=0;i<scores.length;i++){
            double x=scores[i];
            out.append(i==scores.length-1||!Double.isFinite(x)||x<0||x>1?'?':x>=OFFLINE_THRESHOLD?'h':'q');
        }
        return out.toString();
    }
    static void maskCue(StringBuilder windows,long offsetMs,int durationMs){
        if(offsetMs<0)return;
        int from=(int)Math.min(windows.length(),offsetMs/1000);
        int to=(int)Math.min(windows.length(),(offsetMs+Math.max(0,durationMs)+3500+999)/1000);
        for(int i=from;i<to;i++)windows.setCharAt(i,'?');
    }
    static final class Stats {
        int valid,hit,episodes,armed,silent;
        double perHour(){return valid==0?Double.NaN:episodes*3600.0/valid;}
    }
    static Stats summarize(CharSequence windows,int start,int end){
        Stats s=new Stats();
        for(int i=Math.max(0,start);i<Math.min(end,windows.length());i++){
            char c=at(windows,i);
            if(!valid(c))continue;
            s.valid++;if(armed(c))s.armed++;else s.silent++;
            if(hit(c)){s.hit++;if(!hit(at(windows,i-1)))s.episodes++;}
        }
        return s;
    }
    static final class Response {
        final int quiet; final boolean censored;
        Response(int quiet,boolean censored){this.quiet=quiet;this.censored=censored;}
    }
    /** Start only after actuator output and conservative washout; unknown windows
     * or another intervention terminate the observation without inventing silence. */
    static Response response(CharSequence windows,int start,int exclusiveEnd){
        int quiet=0;
        for(int i=start;i<exclusiveEnd&&i<windows.length();i++){
            char c=at(windows,i);
            if(!valid(c))return new Response(quiet,true);
            if(hit(c))return new Response(quiet,false);
            quiet++;
        }
        return new Response(quiet,true);
    }
}
