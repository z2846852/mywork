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
        System.out.println("FeedbackPolicy checks passed");
    }
}