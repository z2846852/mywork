package com.z2846852.bodytrace;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.PriorityQueue;

/**
 * Offline reverse pronunciation dictionary.
 *
 * ZIPA produces a sequence of phones from AUDIO.  This class independently
 * compares the WHOLE sequence with canonical American-English IPA words,
 * returning English spellings, published pronunciations and Chinese meanings.
 * It never alters ZIPA's observed phones and never claims a pronunciation
 * accuracy/confidence score.  Similarity is only lexical phone edit distance.
 *
 * Generated dictionary: IPA-dict (CMU-derived en_US) + ECDICT (Chinese/word
 * frequency), MIT. See scripts/build_pronunciation_lexicon.py for provenance.
 */
final class PhoneticLexicon {
    static final class Entry {
        final String word,ipa,zh;
        final int rank;
        final String[][] variants;
        Entry(String word,String ipa,String zh,int rank){
            this.word=word;this.ipa=ipa;this.zh=zh;this.rank=rank;
            String[] options=ipa.split("\\|",4);
            variants=new String[options.length][];
            for(int i=0;i<options.length;i++)variants[i]=phones(options[i]);
        }
    }
    static final class Match {
        final String word,ipa,zh;
        final int frequencyRank,phoneSimilarityPercent;
        final boolean exact;
        final double phoneEditDistance;
        final double priority;
        Match(Entry entry,double distance,double relative){
            word=entry.word;
            ipa=entry.ipa.replace('|','、');
            zh=entry.zh;
            frequencyRank=entry.rank;
            phoneEditDistance=distance;
            exact=distance<0.0001;
            phoneSimilarityPercent=Math.max(0,Math.min(100,(int)Math.round(100*(1-relative))));
            priority=relative + Math.log1p(Math.min(entry.rank,300000))*0.0012;
        }
    }

    private final List<Entry> entries;
    private PhoneticLexicon(List<Entry> entries){this.entries=entries;}
    int size(){return entries.size();}

    static PhoneticLexicon load(InputStream input)throws IOException {
        List<Entry> items=new ArrayList<>();
        HashSet<String> words=new HashSet<>();
        try(BufferedReader in=new BufferedReader(new InputStreamReader(
                input,StandardCharsets.UTF_8),65536)){
            String line;
            while((line=in.readLine())!=null){
                String[] p=line.split("\t",4);
                if(p.length!=4)continue;
                String word=p[0].trim().toLowerCase(java.util.Locale.ROOT);
                if(!word.matches("[a-z]+(?:['-][a-z]+)*")||!words.add(word))continue;
                int rank;
                try{rank=Integer.parseInt(p[3]);}
                catch(NumberFormatException e){rank=300000;}
                Entry e=new Entry(word,p[1],p[2],Math.max(1,rank));
                if(e.variants.length>0&&e.variants[0].length>0)items.add(e);
                if(items.size()>100000)throw new IOException("Unexpected dictionary length");
            }
        }
        return new PhoneticLexicon(Collections.unmodifiableList(items));
    }

    private static String canonical(String s){
        if(s==null)return "";
        // Common American and ZIPA glyph variations; DO NOT infer the
        // intended WORD or substitute a phoneme from an expected spelling.
        return s.replace("ˈ","").replace("ˌ","").replace("ː","")
          .replace("͡","").replace(".","").replace("/","")
          .replace("ɹ","r").replace("ɡ","g")
          .replace("ɝ","ɜr").replace("ɚ","ər")
          .replace("ɐ","ə").replace("ˑ","")
          .replace(" ","").replace("[","").replace("]","")
          .replace("\u0329","");
    }
    static String[] phones(String ipa){
        String text=canonical(ipa);
        if(text.isEmpty())return new String[0];
        List<String> phones=new ArrayList<>();
        // IPA-dict represents a few diphthongs as pairs. Treat them as ONE
        // phone so an inserted/dropped diphthong is one lexical edit.
        final String[] joined={"aɪ","aʊ","eɪ","oʊ","ɔɪ","əʊ","ɪə","ʊə"};
        for(int i=0;i<text.length();){
            boolean pair=false;
            for(String d:joined){
                if(text.startsWith(d,i)){
                    phones.add(d);i+=d.length();pair=true;break;
                }
            }
            if(pair)continue;
            int cp=text.codePointAt(i);
            String item=new String(Character.toChars(cp));
            i+=Character.charCount(cp);
            // combining accent marks are ignored, not counted as phonemes
            if(Character.getType(cp)==Character.NON_SPACING_MARK)continue;
            phones.add(item);
        }
        return phones.toArray(new String[0]);
    }
    static String[] fromZipa(List<String> raw){
        if(raw==null)return new String[0];
        StringBuilder combined=new StringBuilder();
        for(String label:raw){
            if(label==null)continue;
            if(combined.length()>100)break;
            if(label.matches("(?i)(<blk>|<eps>|<unk>|▁|\\s*)"))continue;
            combined.append(label);
        }
        return phones(combined.toString());
    }
    private static double substitute(String a,String b){
        if(a.equals(b))return 0;
        if((a.equals("ɪ")&&b.equals("i"))||(a.equals("i")&&b.equals("ɪ"))
         ||(a.equals("ɑ")&&b.equals("a"))||(a.equals("a")&&b.equals("ɑ"))
         ||(a.equals("ɔ")&&b.equals("ɒ"))||(a.equals("ɒ")&&b.equals("ɔ"))
         ||(a.equals("ɛ")&&b.equals("e"))||(a.equals("e")&&b.equals("ɛ"))
         ||(a.equals("ʌ")&&b.equals("ə"))||(a.equals("ə")&&b.equals("ʌ"))
         ||(a.equals("ʊ")&&b.equals("u"))||(a.equals("u")&&b.equals("ʊ")))
            return 0.48;
        if((a.equals("θ")&&b.equals("ð"))||(a.equals("ð")&&b.equals("θ"))
         ||(a.equals("s")&&b.equals("z"))||(a.equals("z")&&b.equals("s"))
         ||(a.equals("ʃ")&&b.equals("ʒ"))||(a.equals("ʒ")&&b.equals("ʃ"))
         ||(a.equals("k")&&b.equals("g"))||(a.equals("g")&&b.equals("k")))
            return 0.69;
        return 1.0;
    }
    static double editDistance(String[] a,String[] b){
        if(a.length==0)return b.length;
        if(b.length==0)return a.length;
        double[] prev=new double[b.length+1],curr=new double[b.length+1];
        for(int j=0;j<=b.length;j++)prev[j]=j;
        for(int i=1;i<=a.length;i++){
            curr[0]=i;
            for(int j=1;j<=b.length;j++)
                curr[j]=Math.min(
                    Math.min(prev[j]+1.0,curr[j-1]+1.0),
                    prev[j-1]+substitute(a[i-1],b[j-1]));
            double[] tmp=prev;prev=curr;curr=tmp;
        }
        return prev[b.length];
    }
    List<Match> find(List<String> observed,int count){
        String[] raw=fromZipa(observed);
        if(raw.length<2||raw.length>32||count<1)return Collections.emptyList();
        Comparator<Match> best=Comparator
            .comparingDouble((Match m)->m.priority)
            .thenComparingInt(m->m.frequencyRank)
            .thenComparing(m->m.word);
        PriorityQueue<Match> heap=new PriorityQueue<>(best.reversed());
        for(Entry word:entries){
            double smallest=Double.POSITIVE_INFINITY;
            int size=1;
            for(String[] variant:word.variants){
                int delta=Math.abs(variant.length-raw.length);
                if(delta>6)continue;
                double d=editDistance(raw,variant);
                if(d<smallest){smallest=d;size=Math.max(raw.length,variant.length);}
            }
            if(!Double.isFinite(smallest))continue;
            double relative=smallest/size;
            if(relative>0.55)continue;
            Match m=new Match(word,smallest,relative);
            if(heap.size()<count)heap.add(m);
            else if(best.compare(m,heap.peek())<0){
                heap.poll();heap.add(m);
            }
        }
        ArrayList<Match> result=new ArrayList<>(heap);
        result.sort(best);
        return result;
    }
}
