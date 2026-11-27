package com.z2846852.bodytrace;
public final class CuePcmTest {
    static void check(boolean b){if(!b)throw new AssertionError("PCM invariant");}
    public static void main(String[] args){
        short[] a=new short[2205];java.util.Arrays.fill(a,(short)10000);
        short[] b=CuePcm.normalize(a);check(b.length==a.length);check(b[0]<b[1000]);check(Math.abs(b[1000])<=6553);
        short[] c=CuePcm.render(b,0,"single",true,50);check(c.length==b.length&&c[1000]<=b[1000]/2);
        short[] d=CuePcm.render(b,0,"triplet",true,100);check(d.length==b.length*3+2*(CuePcm.RATE/12));
        boolean rejected=false;try{CuePcm.render(new short[44100],500,"single",true,30);}catch(IllegalArgumentException e){rejected=true;}check(rejected);
        short[] e=CuePcm.render(b,500,"single",false,100);check(e.length==CuePcm.RATE/2);
        System.out.println("CuePcm checks passed");
    }
}