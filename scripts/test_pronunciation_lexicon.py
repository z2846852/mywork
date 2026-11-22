#!/usr/bin/env python3
"""Offline fixture for the reproducible ECDICT + US IPA dictionary compiler."""
import csv
import gzip
import importlib.util
import pathlib
import tempfile

spec=importlib.util.spec_from_file_location("lex_builder",
    pathlib.Path(__file__).with_name("build_pronunciation_lexicon.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def test():
    with tempfile.TemporaryDirectory() as temp:
        p=pathlib.Path(temp)
        e=p/"ecdict.csv"
        i=p/"en_US.txt"
        out=p/"en_pronunciation_zh.tsv.gzdata"
        words={
            "think":("θɪŋk","认为；思考"),
            "can't":("kænt","不能"),
            "ship":("ʃɪp","船"),
            "hello":("həloʊ","你好；喂"),
            "thin":("θɪn","薄的"),
            "sing":("sɪŋ","唱歌"),
            "cat":("kæt","猫"),
        }
        with e.open("w",encoding="utf-8",newline="") as f:
            wr=csv.DictWriter(f,fieldnames=["word","translation","bnc","frq","oxford"])
            wr.writeheader()
            for n,(w,(ipa,zh)) in enumerate(words.items(),1):
                wr.writerow({"word":w,"translation":zh,"bnc":str(100*n),
                             "frq":str(120*n),"oxford":str(n%2)})
        i.write_text("".join(f"{w}\t/{ipa}/\n" for w,(ipa,zh) in words.items()),
            encoding="utf-8")
        size=module.build(e,i,out)
        with gzip.open(out,"rt",encoding="utf-8") as fd:
            t=fd.read()
        assert size==7 and "think\tθɪŋk\t认为；思考" in t
        assert "can't\tkænt\t不能" in t
        assert "ship\tʃɪp\t船" in t
        assert len(t.splitlines())==7
        print("Dictionary generator fixture passed: pinned parser + IPA + Chinese meanings")

if __name__=="__main__":
    test()
