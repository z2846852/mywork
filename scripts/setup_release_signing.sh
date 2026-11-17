#!/usr/bin/env bash
# BodyTrace now uses a permanent, intentionally PUBLIC signing key committed
# to signing/bodytrace-release.p12.b64. No GitHub Secrets or key generation.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
keyfile="$repo_root/signing/bodytrace-release.p12.b64"
if [[ ! -s "$keyfile" ]]; then
  echo "Missing permanent signing identity: $keyfile" >&2
  exit 1
fi
echo "Nothing to configure: Android Actions automatically decodes the checked-in signing key."
echo "Keep this file unchanged; replacing it invalidates upgrades to installed Release APKs."
if command -v keytool >/dev/null && command -v base64 >/dev/null; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  base64 --decode "$keyfile" > "$tmp"
  keytool -list -v -storetype PKCS12 -keystore "$tmp" \
    -storepass 'bodytrace-public-signing-v1' -alias bodytrace | \
    grep -E 'Alias name:|SHA256:'
fi
