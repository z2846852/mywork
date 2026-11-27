package com.z2846852.bodytrace;
/** Pure policy shared by runtime and host regression test. */
final class FeedbackPolicy {
    private FeedbackPolicy(){}
    static int lowerLimit(int prior,int rejected){return Math.max(0,Math.min(prior,rejected-1));}
    static int cap(int proposed,int user,int learned){return Math.max(0,Math.min(proposed,Math.min(user,learned)));}
    static boolean canStart(boolean sound,boolean vibration,int n,int max,long now,long lastEnd,long elapsed,long delay){
        return (sound||vibration)&&n<max&&now-lastEnd>=60000&&elapsed>=delay;
    }
    static int coarse(int upper,int stage){return Math.max(1,upper*(Math.min(2,Math.max(0,stage))+1)/3);}
    static int coarseRange(int lower,int upper,int stage){
        if(upper<=0)return 0;
        int lo=Math.max(1,Math.min(lower,upper));
        return lo+(upper-lo)*Math.min(2,Math.max(0,stage))/2;
    }
    static boolean rhythmFits(String rhythm,long clipMs,int limit){
        if(limit<150||clipMs<0)return false;
        return "single".equals(rhythm)?clipMs<=limit:limit>=180&&(clipMs==0||clipMs*3+170<=limit);
    }
    static double rank(int ok,int n,int accepted){
        return (ok+1.0)/(n+2.0)+Math.min(2,accepted)*0.05;
    }
    static boolean nightBudget(int count,int max,long lastWall,long now){
        return count<max&&(lastWall==0||now-lastWall>=60000);
    }
    static boolean reduced(int valid,int hits){return valid>=30&&hits<=3;}
}