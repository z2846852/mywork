#!/usr/bin/env python3
"""Build small offline IPA -> English word -> Chinese-meaning lexicon.

No word is guessed from recognized text.  This compiles TWO independently
licensed, publicly available dictionaries, pinning both upstream commits:
 * open-dict-data/ipa-dict: US IPA pronunciations (MIT, CMU-derived data)
 * skywind3000/ECDICT: English/Chinese translations and frequency (MIT)

Runs in GitHub Actions before the Android build.  The large upstream CSV and
text file are discarded, while a compressed subset of frequent, translated
words is packaged as a read-only asset.  Existing phoneme models remain a
separate optional download.
"""
import argparse
import csv
import gzip
import io
import pathlib
import re
import tempfile
import urllib.request

ECDICT_SHA="39cfb9672c0906b63569e0453c2e6abfb9ab182a"
IPA_SHA="972cd67dd5f96bc5660e28070cde26e3928abcd7"
ECDICT_URL=f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_SHA}/ecdict.csv"
IPA_URL=f"https://raw.githubusercontent.com/open-dict-data/ipa-dict/{IPA_SHA}/data/en_US.txt"
WORD=re.compile(r"^[a-z]+(?:['-][a-z]+)*$")
CORE={"think","thin","thing","sink","sing","sick","six","can't","can",
      "cat","cut","ship","sheep","sit","seat","hello","help","good",
      "bad","world","work","three","tree","thanks","thank","thanks",
      "hi","nice","night","right","light","book","food"}
MAX_ENTRIES=55000

def fetch(url,output):
    req=urllib.request.Request(url,headers={"User-Agent":"BodyTrace-Dictionary-Builder/1"})
    with urllib.request.urlopen(req,timeout=120) as r,open(output,"wb") as f:
        while True:
            chunk=r.read(1<<20)
            if not chunk:break
            f.write(chunk)

def clean_pronunciation(raw):
    raw=raw.strip().strip("/[]").replace(" ","").replace("͡","")
    raw=raw.replace("ˈ","").replace("ˌ","").replace(".","")
    # Keep consonants, vowels, their duration and diphthongs; discard
    # unrecognized editing tokens but do not mangle IPA letters.
    return raw if 1<=len(raw)<=60 and not any(c in raw for c in "\t|\\") else ""

def read_ipa(path):
    data={}
    with open(path,encoding="utf-8-sig") as fp:
        for line in fp:
            if "\t" not in line:continue
            word,_,pronunciations=line.partition("\t")
            word=word.strip().lower()
            if not WORD.fullmatch(word):continue
            values=[]
            # en_US.txt lists alternative IPA pronunciations after a comma.
            for raw in pronunciations.strip().split(", "):
                pron=clean_pronunciation(raw)
                if pron and pron not in values:values.append(pron)
                if len(values)>=3:break
            if values:data[word]=values
    return data

def rank_field(s):
    try:
        value=int(s.strip())
        return value if value>0 else 300000
    except (ValueError,AttributeError):
        return 300000

def clean_meaning(s):
    # Chinese explanations in ECDICT are long and may contain linebreaks;
    # keep at most two short lines, preserving the original Chinese characters.
    t="；".join(x.strip() for x in s.replace("\r","\n").split("\n") if x.strip())
    t=t.replace("\t"," ").replace("|","/").strip("； ")
    return t[:105] if t else ""

def build(ecdict_path,ipa_path,output,limit=MAX_ENTRIES):
    pronunciation=read_ipa(ipa_path)
    if len(pronunciation)<5:raise ValueError("Too few IPA pronunciations")
    entries={}
    with open(ecdict_path,encoding="utf-8-sig",newline="") as fp:
        for line in csv.DictReader(fp):
            w=(line.get("word") or "").strip().lower()
            if w not in pronunciation or not WORD.fullmatch(w):continue
            meaning=clean_meaning(line.get("translation") or "")
            if not meaning:continue
            bnc=rank_field(line.get("bnc") or "")
            frq=rank_field(line.get("frq") or "")
            ranks=[bnc,frq]
            rank=min(ranks)
            oxford=(line.get("oxford") or "").strip()
            collins=rank_field(line.get("collins") or "")
            is_core=w in CORE
            if rank>90000 and oxford not in ("1","2") and collins>7 and not is_core:
                continue
            # Prioritize frequency and Oxford core. Score is for lexicon
            # selection and tie-breaking, never language-model probability.
            popularity=rank if rank<300000 else (85000 if oxford else 125000)
            if oxford:popularity=min(popularity,16000)
            if is_core:popularity=min(popularity,2000)
            rec=(popularity,w,"|".join(pronunciation[w]),meaning)
            if w not in entries or rec[0]<entries[w][0]:entries[w]=rec
    selected=sorted(entries.values())[:limit]
    selected_words={x[1] for x in selected}
    for word in CORE-selected_words:
        if word in entries:
            selected.append(entries[word])
    if len(selected)<5:raise ValueError("No usable bilingual entries")
    output.parent.mkdir(parents=True,exist_ok=True)
    with open(output,"wb") as raw:
        with gzip.GzipFile(fileobj=raw,mode="wb",compresslevel=9,mtime=0) as gzip_out:
            with io.TextIOWrapper(gzip_out,encoding="utf-8",newline="\n") as wr:
                for rank,word,ipa,meaning in selected:
                    wr.write(f"{word}\t{ipa}\t{meaning}\t{rank}\n")
    if len(pronunciation)>100000 and len(selected)<10000:
        raise ValueError(f"Lexicon unexpectedly small: {len(selected)}")
    for test in ("think","can't","ship","hello"):
        if test not in {x[1] for x in selected}:
            raise ValueError(f"Required coverage missing: {test}")
    print(f"IPA entries: {len(pronunciation)}; bilingual entries: {len(selected)}")
    print(f"Compressed lexicon: {output.stat().st_size:,} bytes")
    return len(selected)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ecdict",type=pathlib.Path)
    p.add_argument("--ipa",type=pathlib.Path)
    p.add_argument("--output",type=pathlib.Path,
                   default=pathlib.Path("app/src/main/assets/en_pronunciation_zh.tsv.gz"))
    args=p.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        parent=pathlib.Path(tmp)
        ecdict=args.ecdict or parent/"ecdict.csv"
        ipa=args.ipa or parent/"en_US.txt"
        if not args.ecdict:fetch(ECDICT_URL,ecdict)
        if not args.ipa:fetch(IPA_URL,ipa)
        build(ecdict,ipa,args.output)

if __name__=="__main__":
    main()
