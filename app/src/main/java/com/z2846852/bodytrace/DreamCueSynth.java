package com.z2846852.bodytrace;

/** Original, deterministic, low-attack dream cues. No external MIDI or audio assets. */
final class DreamCueSynth {
    static final int RATE=22050;
    private DreamCueSynth(){}
    private static final class Note {
        final int start,length; final double hz,level;
        Note(int start,int length,double hz,double level){
            this.start=start;this.length=length;this.hz=hz;this.level=level;
        }
    }
    private static Note n(int start,int length,double hz,double level){
        return new Note(start,length,hz,level);
    }
    private static Note[] notes(String id){
        switch(id){
            case "dream_triplet": return new Note[]{
                n(0,430,440,.86),n(470,430,523.25,.75),n(940,650,392,.9)};
            case "dream_echo": return new Note[]{
                n(0,480,392,.95),n(570,380,392,.64),n(1080,600,392,.4)};
            case "dream_pentatonic": return new Note[]{
                n(0,510,329.63,.75),n(450,520,440,.84),n(900,800,587.33,.76)};
            case "dream_reverse": return new Note[]{
                n(0,340,440,.66),n(430,340,440,.74),n(1000,760,329.63,.9)};
            case "dream_orbit": return new Note[]{
                n(0,440,392,.75),n(440,440,466.16,.76),n(880,440,349.23,.76),
                n(1560,700,392,.68)};
            case "dream_wave": return new Note[]{
                n(0,2300,329.63,.75),n(760,1480,440,.33)};
            case "dream_chord": return new Note[]{
                n(0,1150,261.63,.56),n(320,1100,392,.45),n(650,1450,440,.34)};
            case "dream_odd": return new Note[]{
                n(0,400,349.23,.83),n(410,400,415.30,.68),n(1080,460,293.66,.8),
                n(1550,400,415.30,.65),n(2020,650,349.23,.75)};
            default: return null;
        }
    }
    static boolean supports(String id){return notes(id)!=null;}
    static int durationMs(String id){
        Note[] notes=notes(id);
        if(notes==null)throw new IllegalArgumentException("Unknown dream cue");
        int end=0;for(Note n:notes)end=Math.max(end,n.start+n.length);
        return end+100;
    }
    static short[] synthesize(String id,int volume){
        Note[] notes=notes(id);
        if(notes==null||volume<1||volume>100)throw new IllegalArgumentException("Invalid dream cue");
        int count=durationMs(id)*RATE/1000;
        double[] mix=new double[count];
        for(Note n:notes){
            int start=n.start*RATE/1000,end=Math.min(count,(n.start+n.length)*RATE/1000);
            double attack=Math.min(180,n.length*.38),release=Math.min(400,n.length*.48);
            if("dream_wave".equals(id)){attack=n.length*.46;release=n.length*.50;}
            for(int i=start;i<end;i++){
                double t=(i-start)*1000.0/RATE;
                double up=.5-.5*Math.cos(Math.PI*Math.min(1,t/attack));
                double down=.5-.5*Math.cos(Math.PI*Math.min(1,Math.max(0,(n.length-t)/release)));
                double phase=2*Math.PI*n.hz*(i-start)/RATE;
                double sample=.92*Math.sin(phase)+.08*Math.sin(2*phase);
                mix[i]+=sample*up*down*n.level;
            }
        }
        double max=1;for(double v:mix)max=Math.max(max,Math.abs(v));
        double gain=.20*volume/100.0/max;
        short[] pcm=new short[count];
        for(int i=0;i<count;i++)pcm[i]=(short)Math.round(mix[i]*gain*32767);
        return pcm;
    }
}
