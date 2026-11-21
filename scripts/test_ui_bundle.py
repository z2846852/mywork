#!/usr/bin/env python3
"""CI regression: validate generated UI-only archive and embedded native hash."""
import hashlib
import json
from pathlib import Path
import zipfile
from build_ui_bundle import ROOT, UI_FILES, OUTPUT, BASE, native_fingerprint

def digest(data):
    return hashlib.sha256(data).hexdigest()

assert OUTPUT.is_file(), "Run scripts/build_ui_bundle.py before this test"
assert BASE.is_file(), "Missing embedded native version metadata"
assert OUTPUT.stat().st_size < 2*1024*1024, "Incremental UI zip larger than 2 MiB"
base=json.loads(BASE.read_text(encoding="utf-8"))
with zipfile.ZipFile(OUTPUT) as z:
    assert len(z.namelist()) == len(UI_FILES)+1
    assert set(z.namelist()) == {*UI_FILES, "manifest.json"}
    manifest=json.loads(z.read("manifest.json"))
    assert manifest["schema"] == base["schema"] == 1
    assert manifest["native_sha256"] == base["native_sha256"] == native_fingerprint()
    assert manifest["release_number"] == base["release_number"]
    assert set(manifest["files"]) == set(UI_FILES)
    for name in UI_FILES:
        source=(ROOT/"app/src/main/assets"/name).read_bytes()
        assert z.read(name) == source, f"Packed UI source mismatch: {name}"
        assert digest(source) == manifest["files"][name], f"Hash mismatch: {name}"
        assert len(source) < 1024*1024
print("UI incremental bundle verified: SHA256, native compatibility and 8 assets; "
      f"ZIP {OUTPUT.stat().st_size} bytes")
