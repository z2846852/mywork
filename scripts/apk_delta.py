#!/usr/bin/env python3
"""Build APK-to-APK rolling-block deltas; no APK modifications or re-signing.

Target is the *exact signed* release APK. The client copies ranges from the
installed base.apk, inflates literal bytes, validates the complete new SHA256,
and asks Android to install the reconstructed signed APK. Missing old versions
fall back to a complete download.

Format: BTDPAT01 + old_size:u64 + new_size:u64 + old_sha:32 + new_sha:32;
records C(offset:u64,length:u32), L(raw_len:u32,zip_len:u32,zlib bytes), E.
All integers are network byte order. No mutable or executable patches.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib

MAGIC=b"BTDPAT01"
BLOCK=4096
MOD=65521
MAX_LITERAL=1<<20
MAX_COPY=(1<<31)-1
MAX_PATCH_RATIO=0.85
PREFIX="BodyTrace-from-v0.2."

def sha(data):
    return hashlib.sha256(data).hexdigest()

def patch_bytes(old,new):
    """Find aligned old 4KiB blocks at arbitrary new offsets (rsync style).
    A rolling checksum discovers shifts; exact byte comparison rejects hash
    collisions. Unmatched data gets separately zlib-compressed.
    """
    lookup={}
    for off in range(0,len(old)-BLOCK+1,BLOCK):
        key=zlib.adler32(old[off:off+BLOCK])
        offsets=lookup.setdefault(key,[])
        if len(offsets)<8:offsets.append(off)
    result=bytearray(MAGIC+struct.pack(">QQ",len(old),len(new))+
                     bytes.fromhex(sha(old))+bytes.fromhex(sha(new)))
    literal=bytearray()
    def flush():
        if not literal:return
        zipped=zlib.compress(bytes(literal),level=9)
        result.extend(b"L"+struct.pack(">II",len(literal),len(zipped))+zipped)
        literal.clear()
    pos=0
    if len(new)>=BLOCK:
        checksum=zlib.adler32(new[:BLOCK])
    while pos<len(new):
        found=-1
        if pos+BLOCK<=len(new):
            for off in lookup.get(checksum,()):
                if old[off:off+BLOCK]==new[pos:pos+BLOCK]:
                    found=off
                    break
        if found>=0:
            flush()
            count=BLOCK
            max_length=min(len(old)-found,len(new)-pos,MAX_COPY)
            # Avoid a potentially quadratic byte-by-byte growth operation.
            while count<max_length:
                step=min(32768,max_length-count)
                if old[found+count:found+count+step]!=new[pos+count:pos+count+step]:
                    break
                count+=step
            # Extend partial last block efficiently when the first blocks align.
            if count<max_length:
                chunk=min(32768,max_length-count)
                a=old[found+count:found+count+chunk]
                b=new[pos+count:pos+count+chunk]
                for i,(x,y) in enumerate(zip(a,b)):
                    if x!=y:break
                else:i=chunk
                count+=i
            result.extend(b"C"+struct.pack(">QI",found,count))
            pos+=count
            if pos+BLOCK<=len(new):checksum=zlib.adler32(new[pos:pos+BLOCK])
        else:
            literal.append(new[pos])
            pos+=1
            if len(literal)>=MAX_LITERAL:flush()
            if pos+BLOCK<=len(new):
                # Initial Adler checksum seed=1; rolling Adler uses A' - 1.
                a=checksum&0xffff;b=(checksum>>16)&0xffff
                old_byte=new[pos-1];new_byte=new[pos+BLOCK-1]
                a=(a-old_byte+new_byte)%MOD
                b=(b+a-1-BLOCK*old_byte)%MOD
                checksum=(b<<16)|a
    flush()
    result.extend(b"E")
    return bytes(result)

def apply_patch(old,patch):
    """Reference decoder for CI. Production Android decoder is Java."""
    assert patch.startswith(MAGIC)
    old_size,new_size=struct.unpack_from(">QQ",patch,8)
    assert len(old)==old_size and sha(old)==patch[24:56].hex()
    wanted=patch[56:88].hex()
    result=bytearray();p=88
    while p<len(patch):
        code=patch[p:p+1];p+=1
        if code==b"E":break
        if code==b"C":
            off,count=struct.unpack_from(">QI",patch,p);p+=12
            assert off+count<=len(old) and count>0
            result.extend(old[off:off+count])
        elif code==b"L":
            raw,zipped=struct.unpack_from(">II",patch,p);p+=8
            assert 0<raw<=MAX_LITERAL and 0<zipped<=MAX_LITERAL+4096
            payload=zlib.decompress(patch[p:p+zipped]);p+=zipped
            assert len(payload)==raw
            result.extend(payload)
        else:raise AssertionError(f"invalid instruction: {code!r}")
        assert len(result)<=new_size
    assert p==len(patch) and len(result)==new_size and sha(result)==wanted
    return bytes(result)

def gh(*args,check=True):
    return subprocess.run(["gh",*args],check=check,capture_output=True,text=True)

def previous_releases(new_version,limit):
    raw=gh("release","list","--limit","80","--json","tagName,isDraft,isPrerelease")
    found=[]
    for entry in json.loads(raw.stdout):
        name=entry.get("tagName","")
        if entry.get("isDraft") or entry.get("isPrerelease") or not name.startswith("v0.2."):
            continue
        try:old_version=int(name[5:])
        except ValueError:continue
        if 0<old_version<new_version:found.append((old_version,name))
    return sorted(found,reverse=True)[:limit]

def build_all(target,new_version,output,max_versions=10):
    output.mkdir(parents=True,exist_ok=True)
    target_bytes=target.read_bytes()
    target_digest=sha(target_bytes)
    manifest={
        "schema":1,"target_version_code":new_version,
        "target_size":len(target_bytes),"target_sha256":target_digest,
        "apk_asset":"BodyTrace-release.apk","patches":[]
    }
    previous=previous_releases(new_version,max_versions)
    def one(entry):
        old_version,tag=entry
        with tempfile.TemporaryDirectory(prefix=f"btold-{old_version}-") as tmp:
            proc=gh("release","download",tag,"--pattern","BodyTrace-release.apk",
                    "--dir",tmp,check=False)
            if proc.returncode!=0:
                print(f"Skip {tag}: full APK asset unavailable: {proc.stderr[:150]}",flush=True)
                return None
            old_file=Path(tmp)/"BodyTrace-release.apk"
            if not old_file.is_file():return None
            old=old_file.read_bytes()
            patch=patch_bytes(old,target_bytes)
            if len(patch)>=int(len(target_bytes)*MAX_PATCH_RATIO):
                print(f"Skip {tag}: delta {len(patch)} not worthwhile",flush=True)
                return None
            # Every produced patch is round-trip-checked against the signed APK.
            if apply_patch(old,patch)!=target_bytes:
                raise RuntimeError("Delta roundtrip failed for "+tag)
            name=f"{PREFIX}{old_version}.btpatch"
            (output/name).write_bytes(patch)
            print(f"Delta {tag}->{new_version}: {len(patch):,} B "
                  f"(full {len(target_bytes):,} B)",flush=True)
            return dict(from_version_code=old_version,from_sha256=sha(old),
                        asset=name,patch_sha256=sha(patch),bytes=len(patch))
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures=[pool.submit(one,item) for item in previous]
        for f in as_completed(futures):
            value=f.result()
            if value is not None:manifest["patches"].append(value)
    manifest["patches"].sort(key=lambda e:e["from_version_code"])
    (output/"BodyTrace-updates.json").write_text(
        json.dumps(manifest,separators=(",",":"),sort_keys=True),encoding="utf-8")
    print(f"APK delta manifest: {len(manifest['patches'])} direct upgrades, "
          f"target {target_digest[:16]}...",flush=True)
    return manifest

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--target",type=Path,required=True)
    parser.add_argument("--version",type=int,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--max-versions",type=int,default=10)
    a=parser.parse_args()
    build_all(a.target,a.version,a.output,a.max_versions)

if __name__=="__main__":main()
