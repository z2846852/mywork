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
    static int[][] vibrationLadder(int lower,int upper,int durationCap){
        if(upper<1||durationCap<100)return new int[0][];
        int hi=Math.min(100,upper),lo=Math.max(1,Math.min(lower,hi)),base=Math.min(500,durationCap),end=Math.min(durationCap,1500);
        java.util.ArrayList<int[]> out=new java.util.ArrayList<>();
        out.add(new int[]{lo,base});
        for(int v=lo+20;v<hi;v+=20)out.add(new int[]{v,base});
        if(hi!=lo)out.add(new int[]{hi,base});
        for(int ms:new int[]{800,1200})if(ms>base&&ms<end)out.add(new int[]{hi,ms});
        if(end>base)out.add(new int[]{hi,end});
        return out.toArray(new int[0][]);
    }
    static int nextVibrationLevel(int level,int length,String outcome){
        if(length<=0)return 0;
        int current=Math.max(0,Math.min(length-1,level));
        return "stopped".equals(outcome)?Math.max(0,current-1):"continued".equals(outcome)?Math.min(length-1,current+1):current;
    }
    static boolean thresholdBaseline(int valid,int hits){return valid>=10&&hits>=3;}
    static final int SNORE_WINDOW_SECONDS=300;
    // Count rises of the 50ms RMS envelope, independently of classifier windows.
    // 150ms dwell and separate on/off thresholds reject carrier cycles and brief clicks.
    static final class SnoreTrigger {
        private final java.util.ArrayDeque<Long> peaks=new java.util.ArrayDeque<>(),snore=new java.util.ArrayDeque<>();
        private long last=Long.MIN_VALUE;
        private double floor=-65;
        private int rise,fall;
        private boolean active,classified,needQuiet;
        void reset(){peaks.clear();snore.clear();last=Long.MIN_VALUE;floor=-65;rise=fall=0;active=classified=needQuiet=false;}
        private void expire(long tick){
            while(!peaks.isEmpty()&&tick-peaks.peekFirst()>=SNORE_WINDOW_SECONDS*20L)peaks.removeFirst();
            while(!snore.isEmpty()&&tick-snore.peekFirst()>=SNORE_WINDOW_SECONDS*20L)snore.removeFirst();
        }
        // A gap is not a quiet valley. Keep older verified counts, but require
        // a new real valley before counting any new rise.
        void interrupt(long tick){last=tick;expire(tick);active=classified=false;needQuiet=true;rise=fall=0;}
        void sample(long tick,double db,boolean ai){
            if(last!=Long.MIN_VALUE&&tick!=last+1)interrupt(tick-1);
            if(!Double.isFinite(db)){interrupt(tick);return;}
            last=tick;expire(tick);
            double on=Math.max(-65,floor+8),off=Math.max(-69,floor+4);
            if(needQuiet){
                if(db<=off){if(++fall>=3){needQuiet=false;fall=0;}}
                else fall=0;
                return;
            }
            if(!active){
                if(db>=on){
                    if(++rise>=3){active=true;classified=false;fall=0;peaks.addLast(tick);}
                }else{
                    rise=0;
                    floor=Math.max(-96,Math.min(-25,floor+(db-floor)*(db<floor?.25:.025)));
                }
            }else{
                if(db<=off){if(++fall>=3){active=false;classified=false;rise=fall=0;}}
                else fall=0;
            }
            if(active&&!classified&&ai&&db>off){snore.addLast(tick);classified=true;}
        }
        void updatePcm(long second,boolean valid,short[] pcm,int rate,boolean ai){
            if(!valid||rate<20||pcm.length!=rate){interrupt(second*20+19);return;}
            int n=rate/20;
            for(int i=0;i<20;i++){
                double sum=0;
                for(int k=i*n;k<(i+1)*n;k++){double v=pcm[k]/32768.0;sum+=v*v;}
                double db=10*Math.log10(Math.max(1e-10,sum/n));
                sample(second*20+i,db,ai);
            }
        }
        int peaks(){return peaks.size();}
        int count(){return snore.size();}
        boolean ready(int required){return snore.size()>=Math.max(3,required)&&last-snore.peekLast()<40;}
        void consume(){peaks.clear();snore.clear();} // preserve current pulse latch
    }
    static boolean thresholdBudget(int count,int max,long lastWall,long now,long sinceEnd){
        return count<Math.min(max,8)&&sinceEnd>=300000&&(lastWall==0||now-lastWall>=300000);
    }
    static boolean reportLink(String current,String trialSession,long age){
        return current!=null&&!current.isEmpty()&&current.equals(trialSession)&&age>=0&&age<=120000;
    }
}