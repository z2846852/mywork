package com.z2846852.bodytrace;
public final class SnoreMetricsTest {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    public static void main(String[] args){
        String s="qhh?HQQh";
        SnoreMetrics.Stats st=SnoreMetrics.summarize(s,0,s.length());
        check(st.valid==7&&st.hit==4&&st.episodes==3&&st.armed==3&&st.silent==4);
        check(SnoreMetrics.summarize(s,2,3).episodes==0);
        check(Double.isNaN(SnoreMetrics.summarize("?",0,1).perHour()));
        check(SnoreMetrics.response("qqH",0,3).quiet==2&&!SnoreMetrics.response("qqH",0,3).censored);
        check(SnoreMetrics.response("q?H",0,3).quiet==1&&SnoreMetrics.response("q?H",0,3).censored);
        check(SnoreMetrics.response("qqH",0,2).censored);
        check(SnoreMetrics.response("q",2,1).censored);
        StringBuilder windows=new StringBuilder();SnoreMetrics.record(windows,2,'h');SnoreMetrics.record(windows,2,'q');
        check(windows.toString().equals("??h"));
        String cross="q".repeat(3599)+"hhh";check(SnoreMetrics.summarize(cross,0,3600).episodes==1);
        check(SnoreMetrics.summarize(cross,3600,7200).episodes==0&&SnoreMetrics.summarize(cross,3600,7200).hit==2);
        String offline=SnoreMetrics.offlineWindows(new double[]{.14,.15,.9,Double.NaN,0});
        check(offline.equals("qhh??"));
        StringBuilder masked=new StringBuilder("hhhhhhhhhh");
        SnoreMetrics.maskCue(masked,1500,1000);
        check(masked.toString().equals("h?????hhhh"));
        check(SnoreMetrics.summarize(masked,0,masked.length()).hit==5);
        System.out.println("SnoreMetricsTest passed");
    }
}
