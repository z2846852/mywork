#!/usr/bin/env bash
# Pinned, SHA256-verified YAMNet/classification TF-Lite model.
# Original model: Google YAMNet, Apache-2.0.
set -euo pipefail
cd "$(dirname "$0")/.."
model="app/src/main/assets/yamnet.tflite"
tmp="${model}.tmp"
trap 'rm -f "$tmp"' EXIT
mkdir -p "$(dirname "$model")"
url="https://huggingface.co/thelou1s/yamnet/resolve/e90ce378296ec8c5130f2bbceed762a2b0d383c5/lite-model_yamnet_classification_tflite_1.tflite"
curl --fail --location --retry 3 --retry-all-errors --connect-timeout 20 --max-time 240 \
  "$url" -o "$tmp"
echo "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de  $tmp" | sha256sum --check --status
mv "$tmp" "$model"
echo "Verified bundled offline YAMNet model: $model"
