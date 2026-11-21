#!/usr/bin/env python3
"""Create a reproducible, native-compatible UI-only update bundle.

The APK always contains a complete offline fallback. This builder also emits
ui_base.json for the installed native fingerprint, and a small ZIP attached to
the matching GitHub Release for user-initiated, UI-only updates.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
UI_FILES = (
    "index.html", "features.css", "wheel.js", "features.js",
    "exercise_catalog.js", "git_log.js", "sleep.js", "sleep_visualization.js",
)
UI_ROOT = ROOT / "app/src/main/assets"
NATIVE_ROOT = ROOT / "app/src/main"
EXTRA_NATIVE = ("app/build.gradle", "gradle.properties",
                "settings.gradle", "scripts/fetch_yamnet.sh")
OUTPUT = ROOT / "build/ui_bundle.zip"
BASE = UI_ROOT / "ui_base.json"
MAX_PACKAGE_BYTES = 2 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def native_fingerprint():
    """All APK-managed assets, resources and Java code except OTA UI files.

    The generated ui_base.json is excluded so the fingerprint is stable across
    release numbers; the downloaded YAMNet model is INCLUDED in this hash.
    """
    files = {}
    for path in sorted(NATIVE_ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path == BASE or (path.parent == UI_ROOT and path.name in UI_FILES):
            continue
        if any(part in {"build", ".gradle"} for part in path.relative_to(ROOT).parts):
            continue
        files[path.relative_to(ROOT).as_posix()] = digest(path.read_bytes())
    for name in EXTRA_NATIVE:
        path = ROOT / name
        if path.exists():
            files[name] = digest(path.read_bytes())
    if not (UI_ROOT / "yamnet.tflite").is_file():
        raise SystemExit("Missing pinned YAMNet model: run scripts/fetch_yamnet.sh first")
    serial = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return digest(serial)


def generate(version, commit):
    if version < 1 or not all(c in "0123456789abcdef" for c in commit.lower()) or len(commit) != 40:
        raise ValueError("version must be positive and commit must be a 40-char SHA")
    fingerprint = native_fingerprint()
    manifest = {
        "schema": 1,
        "release_number": version,
        "revision": commit.lower(),
        "native_sha256": fingerprint,
        "files": {name: digest((UI_ROOT / name).read_bytes()) for name in UI_FILES},
    }
    base = {"schema": 1, "release_number": version, "native_sha256": fingerprint}
    BASE.write_text(json.dumps(base, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=8) as z:
        for name in UI_FILES:
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            z.writestr(info, (UI_ROOT / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED,
                       compresslevel=8)
        info = zipfile.ZipInfo("manifest.json", date_time=(2020, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, json.dumps(manifest, sort_keys=True,
                     separators=(",", ":")).encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
    size = OUTPUT.stat().st_size
    if size > MAX_PACKAGE_BYTES:
        raise SystemExit(f"UI update archive too large: {size} bytes")
    print(f"UI bundle: {size} bytes; native fingerprint {fingerprint}; release {version}")
    print(f"Bundle: {OUTPUT.relative_to(ROOT)}; built-in: {BASE.relative_to(ROOT)}")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, type=int)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    generate(args.version, args.commit)
