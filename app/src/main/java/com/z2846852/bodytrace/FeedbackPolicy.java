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
    static int directGain(int completed,boolean sweep){return sweep?10*(1+Math.min(9,Math.max(0,completed))):100;}
    // Explicit subjective feedback adjusts the actual played level, not the
    // next scheduled level. No click does not prove absence of awareness.
    static final class DirectGainState {
        private long epoch=-1,lastQuietSecond=Long.MIN_VALUE;
        private boolean sweep,locked,rejected,manual,awaiting,blocked;
        private int next=10,played,lower,quiet;
        private String trial="";
        private final java.util.TreeSet<Integer> levels=new java.util.TreeSet<>();
        synchronized void ensure(long arm,boolean enabled){
            if(epoch==arm&&sweep==enabled)return;
            epoch=arm;sweep=enabled;trial="";played=lower=0;resetBout();
        }
        private void resetBout(){
            locked=rejected=manual=awaiting=blocked=false;next=sweep?10:100;
            quiet=0;lastQuietSecond=Long.MIN_VALUE;levels.clear();
        }
        synchronized int next(){return next;}
        synchronized boolean locked(){return locked;}
        synchronized boolean ready(){return !awaiting&&!blocked;}
        synchronized boolean canExtend(){return false;}
        synchronized void extended(long arm,String id){}
        synchronized boolean matches(long arm,String id){return epoch==arm&&!trial.isEmpty()&&trial.equals(id);}
        synchronized void started(long arm,String id,int gain){
            if(epoch!=arm||id==null||id.isEmpty())return;
            trial=id;played=Math.max(1,Math.min(100,gain));rejected=false;awaiting=true;
            quiet=0;lastQuietSecond=Long.MIN_VALUE;
            Integer previous=levels.lower(played);lower=previous==null?0:previous;
            levels.add(played);
        }
        synchronized void completed(long arm,String id,boolean ok){
            if(!matches(arm,id))return;
            if(!ok){awaiting=false;blocked=true;}
            // Playback completion is not evidence for increasing intensity.
        }
        synchronized void outcome(long arm,String id,String result,int valid,int hits){
            if(!matches(arm,id)||!awaiting)return;
            awaiting=false;
            if("incomplete".equals(result)||valid<30){blocked=true;return;}
            if(hits==0){resetBout();return;}
            if(locked||rejected){if(rejected)blocked=true;return;}
            if(played>=100){blocked=true;return;}
            next=sweep?Math.min(100,played+10):100;
        }
        synchronized boolean observeQuiet(long second,boolean valid,boolean hit){
            if(awaiting)return false;
            if(!valid||hit){quiet=0;lastQuietSecond=Long.MIN_VALUE;return false;}
            if(lastQuietSecond==Long.MIN_VALUE||second!=lastQuietSecond+1)quiet=0;
            lastQuietSecond=second;
            if(++quiet<30)return false;
            resetBout();return true;
        }
        synchronized int report(long arm,String id,boolean tooStrong){
            return adjust(arm,id,tooStrong?"gain_too_strong":"gain_hold");
        }
        synchronized int adjust(long arm,String id,String action){
            if(!matches(arm,id))return -1;
            switch(action){
                case "gain_too_strong":
                    next=manual?Math.max(1,next-10):Math.max(1,Math.min(played-1,(played+lower)/2));
                    manual=true;locked=true;rejected=true;blocked=true;break;
                case "gain_too_weak":
                    next=Math.min(100,(manual?next:played)+10);
                    manual=true;locked=true;break;
                case "gain_hold":
                    if(!manual&&!rejected)next=played;
                    locked=true;break;
                default:return -1;
            }
            return next;
        }
    }
    static int scaleGain(int max,int gain){return Math.max(1,Math.min(100,Math.round(max*gain/100f)));}
    static boolean thresholdBaseline(int valid,int hits){return valid>=10&&hits>=3;}
    static boolean confirmSnore(double snore,double breathing,double other,double threshold){
        return Double.isFinite(snore)&&Double.isFinite(breathing)&&Double.isFinite(other)
            &&snore>=Math.max(.35,threshold)&&snore>=breathing*.65&&snore>=other;
    }
    static boolean contextSnore(double snore,double breathing,double other,double threshold){
        // Breathing and Snoring are overlapping multilabel categories, not exclusive.
        return Double.isFinite(snore)&&Double.isFinite(breathing)&&Double.isFinite(other)
            &&snore>=Math.max(.30,threshold)&&snore>=breathing*.55&&snore>=other;
    }
    // A high-confidence full-context result can rescue a distant sound
    // fragmented by the envelope detector, but never a low-confidence breath.
    static boolean strongContextSnore(double snore,double breathing,double other,double threshold){
        return contextSnore(snore,breathing,other,threshold)&&snore>=Math.max(.85,threshold)
            &&snore>=.85*breathing&&snore-other>=.15;
    }
    interface PulseClassifier { boolean confirm(short[] pcm,int length); }
    static final int SNORE_WINDOW_SECONDS=300;
    // Count rises of the 50ms RMS envelope, independently of classifier windows.
    // 150ms dwell and separate on/off thresholds reject carrier cycles and brief clicks.
    static final class SnoreTrigger {
        private final java.util.ArrayDeque<Long> peaks=new java.util.ArrayDeque<>(),snore=new java.util.ArrayDeque<>();
        private long last=Long.MIN_VALUE;
        private double floor=Double.NaN,peak=Double.NaN,onsetFloor=Double.NaN;
        private int rise,fall;
        private boolean active,classified,needQuiet,pulseReviewed,pulseContext;
        private long lastConfirmed=Long.MIN_VALUE;
        private final short[] pulse=new short[15600];
        private int pulseLength;
        private boolean contextEpisodeCounted;
        private String reviewReason="waiting";
        String reviewReason(){return reviewReason;}
        void reset(){peaks.clear();snore.clear();last=Long.MIN_VALUE;floor=peak=onsetFloor=Double.NaN;rise=fall=0;active=classified=needQuiet=pulseReviewed=pulseContext=false;pulseLength=0;lastConfirmed=Long.MIN_VALUE;contextEpisodeCounted=false;reviewReason="waiting";}
        private void expire(long tick){
            while(!peaks.isEmpty()&&tick-peaks.peekFirst()>=SNORE_WINDOW_SECONDS*20L)peaks.removeFirst();
            while(!snore.isEmpty()&&tick-snore.peekFirst()>=SNORE_WINDOW_SECONDS*20L)snore.removeFirst();
        }
        // A gap is not a quiet valley. Keep older verified counts, but require
        // a new real valley before counting any new rise.
        void interrupt(long tick){last=tick;expire(tick);active=classified=false;needQuiet=true;rise=fall=0;pulseLength=0;pulseReviewed=pulseContext=false;contextEpisodeCounted=false;}
        void sample(long tick,double db,boolean ai){
            if(last!=Long.MIN_VALUE&&tick!=last+1)interrupt(tick-1);
            if(!Double.isFinite(db)){interrupt(tick);return;}
            last=tick;expire(tick);
            // Initialise against actual room noise, rather than a fixed -65dBFS
            // floor. A valley need not be silence: release on a sustained 7dB
            // fall from the local peak, even when the room noise is relatively loud.
            if(!Double.isFinite(floor))floor=Math.max(-96,db);
            double on=Math.max(-75,floor+6);
            if(needQuiet){
                double quiet=Double.isFinite(peak)?Math.max(floor+3,peak-7):floor+3;
                if(db<=quiet){if(++fall>=3){needQuiet=false;fall=0;floor=db;peak=Double.NaN;}}
                else fall=0;
                return;
            }
            if(!active){
                if(db>=on){
                    if(rise==0){onsetFloor=floor;peak=db;}
                    else peak=Math.max(peak,db);
                    if(++rise>=3){active=true;classified=false;fall=0;peaks.addLast(tick);}
                }else{
                    rise=0;
                    floor=Math.max(-96,Math.min(0,floor+(db-floor)*(db<floor?.45:.12)));
                }
            }else{
                peak=Math.max(peak,db);
                double off=Math.max(onsetFloor+3,peak-7);
                if(db<=off){
                    if(++fall>=3){active=false;classified=false;rise=fall=0;floor=Math.max(-96,db);peak=Double.NaN;}
                }else fall=0;
            }
            if(active&&!classified&&ai&&fall==0){snore.addLast(tick);classified=true;}
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
        // Production: each envelope event gets its own PCM and classifier
        // decision. No inheritance of a positive one-second label.
        void updatePcm(long second,boolean valid,short[] pcm,int rate,boolean contextSnore,PulseClassifier verifier){
            updatePcm(second,valid,pcm,rate,contextSnore,false,verifier);
        }
        void updatePcm(long second,boolean valid,short[] pcm,int rate,boolean contextSnore,boolean strongContext,PulseClassifier verifier){
            if(!valid||rate!=16000||pcm.length!=rate){interrupt(second*20+19);return;}
            if(last!=Long.MIN_VALUE&&second*20!=last+1)interrupt(second*20-1);
            if(!contextSnore)contextEpisodeCounted=false;
            boolean overlap=active&&!pulseReviewed;
            int n=rate/20;
            for(int i=0;i<20;i++){
                long tick=second*20+i;
                int start=i*n;
                double sum=0;
                for(int k=start;k<start+n;k++){double v=pcm[k]/32768.0;sum+=v*v;}
                double db=10*Math.log10(Math.max(1e-10,sum/n));
                boolean wasActive=active;
                sample(tick,db,false);
                if(!wasActive&&!active&&rise==0){pulseLength=0;pulseReviewed=pulseContext=false;continue;}
                if(active||wasActive)overlap=true;
                if(wasActive&&!active){
                    reviewPulse(tick,verifier);pulseLength=0;pulseReviewed=pulseContext=false;continue;
                }
                if(!pulseReviewed&&(active?fall==0:rise>0)){
                    int count=Math.min(n,pulse.length-pulseLength);
                    System.arraycopy(pcm,start,pulse,pulseLength,count);
                    pulseLength+=count;
                    pulseContext|=contextSnore;
                    if(active&&pulseLength==pulse.length)reviewPulse(tick,verifier);
                }
            }
            // Only one fallback per continuous contextual episode, and only
            // with an actual overlapping envelope event. Do not count a
            // later completion of the very same pulse again.
            long tick=second*20+19;
            if(strongContext&&overlap&&!contextEpisodeCounted&&
                (lastConfirmed==Long.MIN_VALUE||tick-lastConfirmed>=24)){
                snore.addLast(tick);lastConfirmed=tick;contextEpisodeCounted=true;
                if(active||rise>0)pulseReviewed=true;
                reviewReason="context_rescue";
            }
        }
        private void reviewPulse(long tick,PulseClassifier verifier){
            if(pulseReviewed)return;
            pulseReviewed=true;
            // Independent PCM confirmation AND positive contextual evidence.
            // Keep at least 1.2s between accepted events, including across consume().
            if(pulseLength<4800){reviewReason="short";return;}
            boolean isolated=verifier.confirm(pulse,pulseLength);
            if(!isolated){reviewReason="isolated";return;}
            if(!pulseContext){reviewReason="context";return;}
            if(lastConfirmed!=Long.MIN_VALUE&&tick-lastConfirmed<24){reviewReason="duplicate";return;}
            snore.addLast(tick);lastConfirmed=tick;contextEpisodeCounted=true;reviewReason="accepted";
        }
        int confirmedInSecond(long second){int n=0;for(long tick:snore)if(tick/20==second)n++;return n;}
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