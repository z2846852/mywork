#!/usr/bin/env bash
# Run once on your own computer. Requires keytool, openssl and authenticated gh CLI.
# Never commit private signing files to the public repository.
set -euo pipefail
umask 077
repo="z2846852/mywork"
dir="${HOME}/.local/share/bodytrace-signing"
keyfile="$dir/bodytrace-release.jks"
passfile="$dir/bodytrace-credentials.txt"
mkdir -p "$dir"
chmod 700 "$dir"
command -v keytool >/dev/null || { echo "Missing keytool (install JDK)"; exit 1; }
command -v gh >/dev/null || { echo "Missing gh CLI"; exit 1; }
command -v openssl >/dev/null || { echo "Missing openssl"; exit 1; }
gh auth status >/dev/null
if [[ -e "$keyfile" || -e "$passfile" ]]; then
  echo "Existing signing files in $dir. Never regenerate without checking your backup."; exit 2
fi
password="$(openssl rand -base64 36 | tr -d '\n')"
alias_name="bodytrace"
keytool -genkeypair -v -storetype PKCS12 \
  -keystore "$keyfile" -storepass "$password" \
  -alias "$alias_name" -keypass "$password" \
  -keyalg RSA -keysize 3072 -validity 15000 \
  -dname "CN=BodyTrace, OU=Personal, O=BodyTrace, C=CN"
printf 'Keystore: %s\nAlias: %s\nPassword: %s\n' \
  "$keyfile" "$alias_name" "$password" > "$passfile"
chmod 600 "$keyfile" "$passfile"
printf "%s" "$password" | gh secret set BODYTRACE_STORE_PASSWORD --repo "$repo"
printf "%s" "$password" | gh secret set BODYTRACE_KEY_PASSWORD --repo "$repo"
printf "%s" "$alias_name" | gh secret set BODYTRACE_KEY_ALIAS --repo "$repo"
base64 < "$keyfile" | tr -d '\n' | gh secret set BODYTRACE_KEYSTORE_B64 --repo "$repo"
echo "Four signing secrets configured in $repo."
echo "Back up BOTH files from $dir to a safe location. Never commit them."
echo "Then trigger the mywork Android workflow for a stable Release APK."
echo "Existing APKs signed by a different debug key cannot upgrade in-place."
