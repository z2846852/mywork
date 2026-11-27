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
