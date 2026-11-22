package com.z2846852.bodytrace;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/** Offline phone-to-lexeme regression, with real Chinese meanings and stress-free IPA. */
public final class PhoneticLexiconTest {
    private static void require(boolean yes,String message){
        if(!yes)throw new AssertionError(message);
    }
    private static PhoneticLexicon fixture()throws Exception{
        String rows=String.join("\n",
            "think\tθɪŋk\t认为；思考\t100",
            "thinking\tθɪŋkɪŋ\t思考中\t101",
            "thin\tθɪn\t薄的；瘦的\t700",
            "thing\tθɪŋ\t东西；事情\t500",
            "sink\tsɪŋk\t下沉；水槽\t1400",
            "sing\tsɪŋ\t唱歌\t1200",
            "can\tkæn\t能够；罐头\t90",
            "can't\tkænt\t不能\t100",
            "cat\tkæt\t猫\t700",
            "ship\tʃɪp\t船\t1500",
            "sheep\tʃip\t羊\t1300",
            "sit\tsɪt\t坐\t800",
            "seat\tsit\t座位\t1000",
            "hello\thəloʊ\t你好；喂\t500",
            "hello\tduplicate\tshould not load\t1"
        )+"\n";
        return PhoneticLexicon.load(new ByteArrayInputStream(
            rows.getBytes(StandardCharsets.UTF_8)));
    }
    public static void main(String[] args)throws Exception{
        PhoneticLexicon db=fixture();
        require(db.size()==14,"Duplicate entries should not load");
        require(db.lookup(" THINK ")!=null&&db.lookup(" THINK ").ipa.equals("θɪŋk"),
            "Exact word lookup must work offline and be case-insensitive");
        require(db.lookup("thinking")!=null&&db.lookup("thinking").ipa.equals("θɪŋkɪŋ"),"Thinking must have six standard IPA phones");
        require(db.lookup("nonexistentword")==null,"Unknown word must not invent IPA");
        List<PhoneticLexicon.Match> think=db.find(Arrays.asList("θ","ɪ","ŋ","k"),5);
        require(think.size()>=3,"Similar English words expected");
        require("think".equals(think.get(0).word),"Full IPA must rank think first");
        require(think.get(0).exact&&think.get(0).phoneSimilarityPercent==100,
            "The word's complete phones must match exactly");
        require(think.get(0).zh.contains("思考"),"Include published Chinese meaning");
        for(PhoneticLexicon.Match m:think){
            require(!m.word.equals("can't")||!m.exact,
                "Unrelated single-phone example must not be promoted to an exact match");
        }
        List<PhoneticLexicon.Match> cant=db.find(Arrays.asList("k","æ","n","t"),4);
        require("can't".equals(cant.get(0).word),
            "Apostrophe words must survive dictionary matching");
        require(cant.get(0).zh.contains("不能"),
            "Mandarin translation should remain attached to exact English candidate");
        List<PhoneticLexicon.Match> near=db.find(Arrays.asList("θ","ɪ","n","k"),5);
        require(near.stream().anyMatch(m->m.word.equals("think")),
            "One substituted phone must still suggest think");
        require(db.find(Arrays.asList("θ"),5).isEmpty(),
            "One isolated phone must not pretend it identifies a full English word");
        require(db.find(Arrays.asList("n","i","x","ɑ","ʊ"),5).stream()
            .noneMatch(m->m.exact),
            "Mandarin IPA must not fabricate an exact English word");
        require(PhoneticLexicon.editDistance(
            PhoneticLexicon.phones("θɪŋk"),
            PhoneticLexicon.fromZipa(Arrays.asList("θ","ɪ","ŋ","k")))==0,
            "ZIPA phone tokens must align with IPA dictionary without ASR or spelling");
        List<PhoneticLexicon.Match> boundary=db.find(
            Arrays.asList("▁θ","ɪ","ŋ","k"),3);
        require(!boundary.isEmpty()&&"think".equals(boundary.get(0).word)&&
                boundary.get(0).exact,
            "CTC word-boundary marker must not corrupt phoneme-to-dictionary lookup");
        System.out.println("PhoneticLexiconTest passed: full sequence, bilingual meanings,"
            +" missing/substitute phones, apostrophe, no fake word from isolated sound");
    }
}
