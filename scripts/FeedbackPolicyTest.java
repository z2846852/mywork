package com.z2846852.bodytrace;
public final class FeedbackPolicyTest {
    private static void check(boolean b,String msg){if(!b)throw new AssertionError(msg);}
    public static void main(String[] args){
        check(FeedbackPolicy.lowerLimit(100,50)==49,"reject 50 excludes 50+");
        check(FeedbackPolicy.lowerLimit(40,50)==40,"rejection cannot relax constraints");
        check(FeedbackPolicy.lowerLimit(100,1)==0,"zero channel limit");
        check(FeedbackPolicy.cap(80,70,49)==49,"learned cap");
        check(FeedbackPolicy.cap(80,0,49)==0,"disabled channel");
        check(!FeedbackPolicy.canStart(false,false,0,12,60000,0,60000,0),"no channel");
        check(!FeedbackPolicy.canStart(true,true,12,12,60000,0,60000,0),"session cap");
        check(!FeedbackPolicy.canStart(true,false,0,12,59999,0,60000,0),"cooldown");
        check(!FeedbackPolicy.canStart(true,false,0,12,60000,0,1000,60000),"sleep protection");
        check(FeedbackPolicy.canStart(false,true,0,12,60000,0,60000,0),"vibration only");
        check(FeedbackPolicy.coarse(40,0)==13&&FeedbackPolicy.coarse(40,2)==40,"coarse sweep");
        check(!FeedbackPolicy.reduced(29,0)&&!FeedbackPolicy.reduced(30,4)&&FeedbackPolicy.reduced(30,3),"observation validity");
        check(FeedbackPolicy.coarseRange(10,40,0)==10&&FeedbackPolicy.coarseRange(10,40,1)==25&&FeedbackPolicy.coarseRange(10,40,2)==40,"range sweep");
        check(FeedbackPolicy.coarseRange(30,20,1)==20&&FeedbackPolicy.coarseRange(1,0,1)==0,"range after exclusion");
        check(!FeedbackPolicy.nightBudget(12,12,0,60000)&&!FeedbackPolicy.nightBudget(1,12,1000,60999)&&FeedbackPolicy.nightBudget(1,12,1000,61000),"persistent night budget");
        check(FeedbackPolicy.rank(3,4,0)>FeedbackPolicy.rank(1,4,0),"rank by evidence");
        check(!FeedbackPolicy.rhythmFits("triplet",1800,5000),"three full clips exceed limit");
        check(FeedbackPolicy.rhythmFits("single",1800,2000),"single fits independently");
        check(!FeedbackPolicy.rhythmFits("single",1800,1000),"too-long clip excluded");
        check(!FeedbackPolicy.rhythmFits("triplet",0,170)&&FeedbackPolicy.rhythmFits("triplet",0,180),"pulse minimum");
        int[][] ladder=FeedbackPolicy.vibrationLadder(40,100,1500);
        check(ladder.length==7&&ladder[0][0]==40&&ladder[0][1]==500&&ladder[6][0]==100&&ladder[6][1]==1500,"bounded threshold ladder");
        for(int i=1;i<ladder.length;i++)check((ladder[i][0]==ladder[i-1][0])!=(ladder[i][1]==ladder[i-1][1]),"one coordinate per level");
        check(FeedbackPolicy.nextVibrationLevel(3,7,"stopped")==2&&FeedbackPolicy.nextVibrationLevel(2,7,"continued")==3,"down after response up after persistence");
        check(FeedbackPolicy.nextVibrationLevel(0,7,"stopped")==0&&FeedbackPolicy.nextVibrationLevel(6,7,"continued")==6&&FeedbackPolicy.nextVibrationLevel(2,7,"incomplete")==2,"bounds and invalid observations");
        check(FeedbackPolicy.vibrationLadder(40,20,350)[0][0]==20&&FeedbackPolicy.vibrationLadder(40,20,350)[0][1]==350,"learned caps");
        check(FeedbackPolicy.vibrationLadder(1,0,500).length==0&&FeedbackPolicy.vibrationLadder(1,100,90).length==0,"excluded channel");
        check(!FeedbackPolicy.thresholdBaseline(9,9)&&!FeedbackPolicy.thresholdBaseline(10,2)&&FeedbackPolicy.thresholdBaseline(10,3),"baseline validity");
        check(!FeedbackPolicy.thresholdBudget(8,40,0,500000,500000)&&!FeedbackPolicy.thresholdBudget(1,8,1000,300999,500000)&&!FeedbackPolicy.thresholdBudget(1,8,0,500000,299999)&&FeedbackPolicy.thresholdBudget(1,8,1000,301000,300000),"night budget and cooldown");
        check(FeedbackPolicy.reportLink("session","session",120000)&&!FeedbackPolicy.reportLink("session","session",120001)&&!FeedbackPolicy.reportLink("session","other",100)&&!FeedbackPolicy.reportLink("","",0),"self-report temporal/session link");
        FeedbackPolicy.SnoreTrigger gate=new FeedbackPolicy.SnoreTrigger();
        long tick=0;
        for(int i=0;i<20;i++)gate.sample(tick++,-75,false);
        for(int i=0;i<60;i++)gate.sample(tick++,-25,true);
        check(gate.peaks()==1&&gate.count()==1&&!gate.ready(3),"continuous loud sound is one");
        for(int i=0;i<1200;i++)gate.sample(tick++,-75,false);
        for(int i=0;i<10;i++)gate.sample(tick++,-25,true);
        check(gate.count()==2&&!gate.ready(3),"second sound after a minute");
        for(int i=0;i<1200;i++)gate.sample(tick++,-75,false);
        for(int i=0;i<10;i++)gate.sample(tick++,-25,true);
        check(gate.count()==3&&gate.ready(3)&&!gate.ready(4),"third sound after two minutes");
        gate.consume();for(int i=0;i<10;i++)gate.sample(tick++,-25,true);
        check(gate.count()==0&&!gate.ready(3),"consumed pulse not counted twice");
        for(int i=0;i<5;i++)gate.sample(tick++,-75,false);
        for(int i=0;i<10;i++)gate.sample(tick++,-25,false);
        check(gate.peaks()==1&&gate.count()==0,"non-snore peak separate from confirmed count");
        gate.reset();tick=0;
        for(int i=0;i<10;i++)gate.sample(tick++,-75,false);
        for(int k=0;k<3;k++){
            for(int i=0;i<5;i++)gate.sample(tick++,-25,true);
            for(int i=0;i<5;i++)gate.sample(tick++,-75,false);
        }
        check(gate.count()==3&&gate.ready(3),"three sub-second pulses within two seconds");
        gate.interrupt(tick+10);tick+=11;
        for(int i=0;i<10;i++)gate.sample(tick++,-25,true);
        check(gate.count()==3,"missing data cannot create a new peak");
        for(int i=0;i<6100;i++)gate.sample(tick++,-75,false);
        check(gate.count()==0&&!gate.ready(3),"five minute expiry");
        gate.reset();for(int i=0;i<10;i++)gate.sample(i,-75,false);
        for(int i=10;i<12;i++)gate.sample(i,-25,true);
        gate.sample(12,-75,false);check(gate.count()==0,"short click rejected");
        short[] pcm=new short[16000];
        for(int i=0;i<pcm.length;i++)if((i>=800&&i<4000)||(i>=7200&&i<10400)||(i>=12800&&i<16000))pcm[i]=(short)(Math.sin(i*.2)*12000);
        gate.reset();gate.updatePcm(0,true,pcm,16000,true);check(gate.count()==3&&gate.ready(3),"three RMS pulses in one classifier window");
        // Real room valleys do not fall to -65dBFS. Reproduce the old
        // one-and-done latch with a -39dBFS background and repeated loud peaks.
        gate.reset();tick=0;
        for(int i=0;i<20;i++)gate.sample(tick++,-39,false);
        for(int k=0;k<8;k++){
            for(int i=0;i<12;i++)gate.sample(tick++,-20,true);
            for(int i=0;i<10;i++)gate.sample(tick++,-39,false);
            check(gate.peaks()==k+1&&gate.count()==k+1,"noisy room pulse "+k);
        }
        check(gate.ready(4),"noisy room triggers on fourth or later");
        gate.reset();tick=0;
        for(int i=0;i<20;i++)gate.sample(tick++,-55,false);
        for(int k=0;k<5;k++){
            for(int i=0;i<10;i++)gate.sample(tick++,-24,true);
            for(int i=0;i<10;i++)gate.sample(tick++,-34,false);
        }
        check(gate.count()==5,"relative valleys above initial noise floor");
        gate.reset();tick=0;
        for(int i=0;i<20;i++)gate.sample(tick++,-40,false);
        for(int i=0;i<200;i++)gate.sample(tick++,-20+(i%2==0?0:1),true);
        check(gate.peaks()==1&&gate.count()==1,"sustained sound cannot retrigger");
        gate.reset();tick=0;
        for(int i=0;i<20;i++)gate.sample(tick++,-40,false);
        for(int k=0;k<4;k++){
            for(int i=0;i<12;i++)gate.sample(tick++,-20,k%2==0);
            for(int i=0;i<10;i++)gate.sample(tick++,-40,false);
        }
        check(gate.peaks()==4&&gate.count()==2&&!gate.ready(4),"AI and raw envelope stay distinct");
        System.out.println("FeedbackPolicy checks passed");
    }
}