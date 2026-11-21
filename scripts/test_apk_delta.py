#!/usr/bin/env python3
"""Offline exhaustive-ish APK delta fixture suite, independent of GitHub."""
from pathlib import Path
import hashlib
import os
import random
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from apk_delta import patch_bytes,apply_patch,sha

rng=random.Random(20261122)
def noise(n):
    return rng.randbytes(n)

cases=[
    (b"",b"abc"),
    (b"abc",b""),
    (b"abc"*1400,b"abc"*1400),
    (noise(25000),noise(25000)),
    (bytes(range(256))*200,
     b"INSERT"+bytes(range(256))*200+b"END"),
    (b"A"*13000+b"B"*60000+b"C"*20000,
     b"A"*13000+b"X"*118+b"B"*60000+b"C"*20000),
]
large=noise(1_200_000)
cases.append((large,large[:23333]+b"NEW"*1400+large[23333:]+b"EXTRA"))
cases.append((large,large[:45455]+large[56999:]))
base=Path("build/delta_test")
base.mkdir(parents=True,exist_ok=True)
for index,(old,new) in enumerate(cases):
    data=patch_bytes(old,new)
    assert apply_patch(old,data)==new, f"Roundtrip case {index}"
    if index==len(cases)-2:
        (base/"old.apk").write_bytes(old)
        (base/"new.apk").write_bytes(new)
        (base/"update.btpatch").write_bytes(data)
        patch=bytearray(data)
        patch[len(patch)//2]^=0xff
        (base/"bad.btpatch").write_bytes(patch)
    print(f"Delta test {index}: old={len(old)} new={len(new)} "
          f"patch={len(data)}",flush=True)
print("Python APK delta fixtures: all passed")
