#!/usr/bin/env python3
"""Fetch CC BY-SA real IPA samples into APK assets at build time.
Upstream source is pinned by immutable commit + exact git blob SHA-1.
No network is needed for listening after installing the APK.
"""
import hashlib
import pathlib
import time
import urllib.parse
import urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/"app/src/main/assets/ipa_audio"
PIN="720907443ddd1811756dc4a73b686c774fc277d7"
BASE=f"https://raw.githubusercontent.com/Nico-Sanchez/schwa/{PIN}/site/audio/"
FILES={
    "aa.mp3": ("66580d86ba994589d756fcc070c8edacd46ffa3a", 6103),
    "ae.mp3": ("867b6cd43096ebcc9c43bc480b75e939420185fc", 7148),
    "b.mp3": ("fe2e31a675e0172b1cb014408985ee70262689e8", 17597),
    "ch.mp3": ("90f2cec68975508236640d6a4c20544ac6e20a5e", 14462),
    "d.mp3": ("70db0def07a2b976685a05d2283b3ffb5243b6e1", 14253),
    "dh.mp3": ("198349316cc5ecc6276939bc6b28286d05690bd9", 18224),
    "dj.mp3": ("8e0ff0fff0d8274df3fb82232b1456ec467e8b3c", 11745),
    "e.mp3": ("4caa002ff3167296496f60cc0a96121770ebcebd", 11745),
    "er.mp3": ("00c73dfe9241de6fd18bccac1f1086e2f1b6be1f", 6103),
    "f.mp3": ("0582dd871f86cb7f106e75e5449df259a20f43dd", 6730),
    "g.mp3": ("50f1f098a64898d13496499dc27cf1e0267fa39f", 6939),
    "h.mp3": ("3fa0ea0e6955782ba25fbd3120af5ad0820b06e6", 16970),
    "i.mp3": ("39a776a09c11355bdf7082704e2246c90dec14f5", 6103),
    "ii.mp3": ("eef27e37e41e81eab2340900635ae2f40dedb33d", 6312),
    "k.mp3": ("ea42e40b3cc70f5546bf210495adb1c4faf59434", 15089),
    "l.mp3": ("ae79e1e83bae0ed4adc54000d6335b31dbb5318d", 16761),
    "m.mp3": ("5b4b11d23e4d24b61b12a67d829c86cded3de673", 15925),
    "n.mp3": ("bfd4101c9fbcd2960ba79d4d4577dcaccd3d533a", 17388),
    "ng.mp3": ("555471c1ed3c63f40ef6167aa1e93ca3d35c0975", 15089),
    "o.mp3": ("a10c9cb9da04de53dfa34c09476a4795c8728659", 6939),
    "oo.mp3": ("1fd15b5d9fcb1560befb5a6911c09281f10082ae", 6103),
    "p.mp3": ("1f065f84ff26e250878c570c8fbc40f71e01572c", 13208),
    "r.mp3": ("c86f71c222577782e51b0d1577adcc4884769037", 17179),
    "s.mp3": ("67e40b6a1f5395afcb81414175610b03bfb90f1e", 18642),
    "schwa.mp3": ("0d574cb868cf8c2a26288f829f4769f7117d354b", 5476),
    "sh.mp3": ("d9fd0c35277f79584531ad4b6c91b5f2ee8f292b", 18224),
    "t.mp3": ("cd586880c52b8026d47cc5659d8581488324fb79", 14671),
    "th.mp3": ("4574ace69a569eae468662250be644e62eef312a", 18433),
    "u.mp3": ("1560117b3772e4204de4cb806706369452a54431", 6312),
    "uh.mp3": ("e82b32e089ec152c11a2042e73b0fdb080f2856f", 5894),
    "uu.mp3": ("1360a680cb56ec3034cdfa9fee4d421cf8a3df5c", 6939),
    "v.mp3": ("d533fe9ff63d7e289e5cb977d6fb835b05118d1a", 6730),
    "w.mp3": ("2b8bd219cceb9af79f9aeaa528d65586ada30dec", 15298),
    "y.mp3": ("279d8a55aff9afdce344f51bcd47dee93a78a227", 15716),
    "z.mp3": ("39377ec8568484c71cfc03d7270e284313fdc1c9", 16552),
    "zh.mp3": ("4a7286a6666ef3f56f282f0939bd2f7f94df1236", 18015),
}
# Wikimedia Commons links are checked as genuine Ogg audio. These files are
# individually attributed; unlike the Schwa Git blobs, Commons bytes may be
# updated upstream, so we do NOT pretend that they have a known pinned SHA.
EXTRAS={
  "retroflex_sh.ogg":"Voiceless_retroflex_sibilant.ogg",
  "central_i.ogg":"Close_central_unrounded_vowel.ogg",
}

def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"BodyTrace-IpaEducation/1.0 (Github-Actions)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req,timeout=25) as r:
                raw=r.read(250001)
            if len(raw)>250000:raise RuntimeError("Oversized sample")
            return raw
        except Exception:
            if attempt==3:raise
            time.sleep(2**attempt)

def git_sha1(content):
    return hashlib.sha1(b"blob "+str(len(content)).encode()+b"\0"+content).hexdigest()

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for name,(digest,size) in FILES.items():
        path=OUT/name
        if path.is_file() and git_sha1(path.read_bytes())==digest:continue
        raw=get(BASE+urllib.parse.quote(name))
        if len(raw)!=size or git_sha1(raw)!=digest:raise RuntimeError(f"Pin mismatch {name}")
        path.write_bytes(raw)
    for dest,source in EXTRAS.items():
        path=OUT/dest
        if path.is_file() and 4000<path.stat().st_size<250000 and path.read_bytes().startswith(b"OggS"):
            continue
        md5=hashlib.md5(source.encode("utf-8")).hexdigest()
        url=("https://upload.wikimedia.org/wikipedia/commons/"
             +md5[0]+"/"+md5[:2]+"/"+urllib.parse.quote(source))
        raw=get(url)
        if not 4000<len(raw)<250000 or not raw.startswith(b"OggS"):
            raise RuntimeError(f"Invalid Commons recording: {source}")
        path.write_bytes(raw)
    assert len(list(OUT.glob("*.mp3")))==len(FILES)
    assert len(list(OUT.glob("*.ogg")))==len(EXTRAS)
    print("Verified",len(FILES)+len(EXTRAS),"human IPA recordings, ready for offline APK")

if __name__=="__main__":main()
