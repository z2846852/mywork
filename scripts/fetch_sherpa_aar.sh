#!/usr/bin/env bash
set -euo pipefail
# Pin the official sherpa-onnx 2.0.1 Android binary by upstream Release SHA256.
# Only this native inference runtime is bundled; no IPA model weights in APK.
url="https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-2.0.1.aar"
sha="a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7"
target="app/libs/sherpa-onnx-2.0.1.aar"
mkdir -p app/libs
if [[ -f "$target" ]] && echo "$sha  $target" | sha256sum -c --status; then
  echo "Pinned sherpa-onnx AAR already present."
  exit 0
fi
curl --fail --location --retry 4 --retry-delay 3 --connect-timeout 30 \
  --max-time 300 "$url" -o "$target.part"
echo "$sha  $target.part" | sha256sum -c -
mv "$target.part" "$target"
# Validate that both JNI and Kotlin API classes are present.
python3 - "$target" <<'PY'
import sys,zipfile,io
with zipfile.ZipFile(sys.argv[1]) as z:
    names=set(z.namelist())
    assert "classes.jar" in names, "Missing Kotlin API classes"
    assert any(n.endswith("arm64-v8a/libsherpa-onnx-jni.so") for n in names), "Missing arm64 JNI"
    with zipfile.ZipFile(io.BytesIO(z.read("classes.jar"))) as jar:
        assert "com/k2fsa/sherpa/onnx/OfflineRecognizer.class" in jar.namelist()
print("Verified Android AAR API and arm64 JNI")
PY
