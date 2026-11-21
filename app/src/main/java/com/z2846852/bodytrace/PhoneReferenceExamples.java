package com.z2846852.bodytrace;

import java.util.HashMap;
import java.util.Map;

/**
 * Standalone SAMPLE references for an acoustically decoded phone, never
 * inferred spoken words nor Mandarin syllable or tone recognition.
 */
final class PhoneReferenceExamples {
    private static final Map<String,String> EN=new HashMap<>();
    private static final Map<String,String> ZH=new HashMap<>();
    static {
        put("θ","think, thin","—");
        put("ð","this, they","—");
        put("ɪ","sit, ship","—");
        put("i","see, sheep","yī（衣），仅元音参考");
        put("iː","see, sheep","yī（衣），仅元音参考");
        put("æ","cat, can't (AmE)","—");
        put("ɑ","father, hot","mā（妈），仅音色参考");
        put("a","father, cat (varies)","mā（妈），仅韵母参考");
        put("e","day (part of /eɪ/)","—");
        put("ɛ","bed, red","—");
        put("ə","about, sofa","—");
        put("ʌ","cup, cut","—");
        put("ɔ","saw, thought","—");
        put("ʊ","book, good","—");
        put("u","food, moon","wū（乌），仅韵母参考");
        put("uː","food, moon","wū（乌），仅韵母参考");
        put("y","—","yú（鱼），仅韵母参考");
        put("s","see, sit","sī（思）声母参考");
        put("ʃ","she, ship","—（不同于普通话 sh）");
        put("ɕ","—","xī（西）声母参考");
        put("ʂ","—","shī（诗）声母参考");
        put("tɕ","—","jī（鸡）声母参考");
        put("ʈʂ","—","zhī（知）声母参考");
        put("p","pen, cap","—");
        put("b","bat, cab","—");
        put("t","top, cat","—");
        put("d","dog, bed","—");
        put("k","cat, can't","kē（科）声母参考");
        put("ɡ","go, bag","—");
        put("g","go, bag","—");
        put("n","no, can","nǐ（你）声母参考");
        put("ŋ","sing, think","ang 韵尾 /ŋ/，非整个拼音");
        put("m","man, time","mā（妈）声母参考");
        put("l","light, lake","lái（来）声母参考");
        put("ɹ","red, rice","—");
        put("r","red (varies)","rì（日）声母不等同英语 /ɹ/");
        put("f","fan, leaf","fēi（飞）声母参考");
        put("v","van, have","—");
        put("h","hat, home","hē（喝）声母参考");
        put("w","we, win","wǒ（我）起始滑音参考");
        put("j","yes, yellow","yī（衣）起始滑音参考");
    }
    private static void put(String phone,String english,String mandarin){
        EN.put(phone,english);ZH.put(phone,mandarin);
    }
    private static String key(String raw){
        if(raw==null)return "";
        String key=raw.trim().replace("/","");
        return key;
    }
    static String english(String phone){return EN.getOrDefault(key(phone),"—");}
    static String mandarin(String phone){return ZH.getOrDefault(key(phone),"—");}
}
