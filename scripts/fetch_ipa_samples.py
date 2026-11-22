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
# Commons samples mirrored as MP3 by eeeeaaii/langkit with per-file
# attribution in audio/ipa/SOURCES.md. Immutable Git commit and blob hashes.
EXTRA_PIN="b3a08c5e6a4defa272f134503f9937b930c9d2b5"
EXTRA_BASE=f"https://raw.githubusercontent.com/eeeeaaii/langkit/{EXTRA_PIN}/audio/ipa/"
EXTRAS={
  "extra_0255.mp3": ("Voiceless_alveolo-palatal_sibilant.mp3","69f6cdf0363596c69d8f269be6c05ddcec6dd48a",44072),
  "extra_0291.mp3": ("Voiced_alveolo-palatal_sibilant.mp3","377692da07a96b5abf282ba214e1d7685d865f2a",49662),
  "retroflex_sh.ogg": ("Voiceless_retroflex_sibilant.mp3","d9b3858973ca7896efd5ea89acf55b2dcac77723",54885),
  "extra_0290.mp3": ("Voiced_retroflex_sibilant.mp3","87697cb35d5eb08d5b9916098cb6fe0831ab62c9",56814),
  "extra_027e.mp3": ("Alveolar_tap.mp3","1d9cc1fe60d6a8aed0431c45c15efabd42307bf0",42195),
  "extra_0294.mp3": ("Glottal_stop.mp3","5de0478463fd40e8b01840c6ace3e4a2a90edb29",45568),
  "extra_027d.mp3": ("Retroflex_flap.mp3","6ed2748c712c69d3bb07cbcb3305a3500de5a57a",40325),
  "extra_027b.mp3": ("Retroflex_Approximant2.mp3","8f1de2fa63d1ca81f40936b4f8b0f3e66475ce3d",55383),
  "central_i.ogg": ("Close_central_unrounded_vowel.mp3","0dc173ba50511752a2c7fe3bf3f5bc8e8603517e",11154),
  "extra_0272.mp3": ("Palatal_nasal.mp3","8e3862db15baecffb2fbd4095cbfbf5250c0a76d",43791),
  "extra_0263.mp3": ("Voiced_velar_fricative.mp3","bd6a801d95e2c3b206baa34d8fbfea5a1a7d4956",39839),
  "extra_00e7.mp3": ("Voiceless_palatal_fricative.mp3","05f8bb54460e2b9bf443137595e7a2ca3a1405b8",37717),
  "extra_0078.mp3": ("Voiceless_velar_fricative.mp3","6c2ccb53ec9ff898720f13b3fa22b95058ce40ae",39289),
  "extra_026c.mp3": ("Voiceless_alveolar_lateral_fricative.mp3","f4658fbf88b9c177f628823d7979ad5a30f91690",26714),
  "extra_028b.mp3": ("Labiodental_approximant.mp3","ab4c9278f9af37b336e176499019601dbbde0248",46840),
  "extra_028d.mp3": ("Voiceless_labio-velar_fricative.mp3","d922d58d6f2b5c33317e72805b460866fb0dd22a",40782),
  "extra_0289.mp3": ("Close_central_rounded_vowel.mp3","843b43cdfa227f8d5090ff1df8d5a5cf0c579b14",14487),
  "extra_026f.mp3": ("Close_back_unrounded_vowel.mp3","b50f65d414e55d96ef73fdc5e61d13f82c74695f",10787),
  "extra_0288.mp3": ("Voiceless_retroflex_stop.mp3","dbc4deb8a7eff2d9ae9e05cc822ba798ba35110c",33112),
  "extra_0256.mp3": ("Voiced_retroflex_stop.mp3","f0a7e008429c25b2773c25d880f8688c969aeca7",41467),
  "extra_0273.mp3": ("Retroflex_nasal.mp3","9d099febc136aec47233aa8397edf089e43964ef",46269),
  "extra_025c.mp3": ("Open-mid_central_unrounded_vowel.mp3","26f605b8a49fc143cafe9009dbe9cf7d0dc40e00",11832),
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
    for dest,(source,digest,size) in EXTRAS.items():
        path=OUT/dest
        if dest.endswith(".mp3") and path.is_file() and git_sha1(path.read_bytes())==digest:
            continue
        # The two legacy Ogg names are required by APK package validation.
        if dest.endswith(".ogg") and path.is_file() and path.read_bytes().startswith(b"OggS"):
            continue
        raw=get(EXTRA_BASE+urllib.parse.quote(source))
        if len(raw)!=size or git_sha1(raw)!=digest:
            raise RuntimeError(f"GitHub mirror checksum mismatch: {source}")
        if dest.endswith(".ogg"):
            # Genuine Vorbis content, not an MP3 mislabelled with .ogg.
            import subprocess,tempfile
            with tempfile.NamedTemporaryFile(dir=OUT,suffix=".mp3") as temp:
                temp.write(raw);temp.flush()
                subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
                    "-nostdin","-y","-i",temp.name,"-ac","1",
                    "-c:a","libvorbis","-q:a","4",str(path)],check=True)
            if not path.read_bytes().startswith(b"OggS"):
                raise RuntimeError(f"Invalid converted Ogg {dest}")
        else:
            path.write_bytes(raw)
    expected_mp3=len(FILES)+sum(x.endswith(".mp3") for x in EXTRAS)
    assert len(list(OUT.glob("*.mp3")))==expected_mp3
    assert len(list(OUT.glob("*.ogg")))==2
    print("Verified",len(FILES)+len(EXTRAS),"real IPA recordings, offline APK")

if __name__=="__main__":main()
