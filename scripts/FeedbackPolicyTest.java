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
        check(!FeedbackPolicy.thresholdBaseline(9,9)&&!FeedbackPolicy.thresholdBaseline(10,3)&&FeedbackPolicy.thresholdBaseline(10,4),"baseline validity");
        check(!FeedbackPolicy.thresholdBudget(8,40,0,500000,500000)&&!FeedbackPolicy.thresholdBudget(1,8,1000,300999,500000)&&!FeedbackPolicy.thresholdBudget(1,8,0,500000,299999)&&FeedbackPolicy.thresholdBudget(1,8,1000,301000,300000),"night budget and cooldown");
        check(FeedbackPolicy.reportLink("session","session",120000)&&!FeedbackPolicy.reportLink("session","session",120001)&&!FeedbackPolicy.reportLink("session","other",100)&&!FeedbackPolicy.reportLink("","",0),"self-report temporal/session link");
        System.out.println("FeedbackPolicy checks passed");
    }
}