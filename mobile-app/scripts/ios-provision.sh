#!/usr/bin/env bash
# ios-provision.sh — runs on any Linux server with fastlane + openssl.
# Generates an Apple Distribution certificate + App Store provisioning profile
# entirely via the App Store Connect API. No Mac, no Keychain Access needed.
#
# Usage:
#   export ASC_KEY_ID="XXXXXXXXXX"
#   export ASC_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#   export ASC_PRIVATE_KEY_PATH="/path/to/AuthKey_KEYID.p8"
#   export APPLE_TEAM_ID="AB12CD34EF"
#   bash scripts/ios-provision.sh

set -euo pipefail

BUNDLE_ID="no.setalink.realink"
CERT_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
OUT_DIR="$(pwd)/.ios-creds"
mkdir -p "$OUT_DIR"

echo ""
echo "▶ Checking prerequisites"
[[ -z "${ASC_KEY_ID:-}"            ]] && { echo "ERROR: Set ASC_KEY_ID";            exit 1; }
[[ -z "${ASC_ISSUER_ID:-}"         ]] && { echo "ERROR: Set ASC_ISSUER_ID";         exit 1; }
[[ -z "${ASC_PRIVATE_KEY_PATH:-}"  ]] && { echo "ERROR: Set ASC_PRIVATE_KEY_PATH";  exit 1; }
[[ -z "${APPLE_TEAM_ID:-}"         ]] && { echo "ERROR: Set APPLE_TEAM_ID";         exit 1; }
[[ ! -f "$ASC_PRIVATE_KEY_PATH"    ]] && { echo "ERROR: .p8 key file not found";    exit 1; }

echo "▶ Writing App Store Connect API key JSON for fastlane"
# fastlane expects the key content inlined with literal \n
KEY_CONTENT=$(cat "$ASC_PRIVATE_KEY_PATH")
cat > "$OUT_DIR/api_key.json" <<JSON
{
  "key_id": "${ASC_KEY_ID}",
  "issuer_id": "${ASC_ISSUER_ID}",
  "key": $(python3 -c "import json,sys; print(json.dumps(open('${ASC_PRIVATE_KEY_PATH}').read()))"),
  "duration": 1200,
  "in_house": false
}
JSON

echo "▶ Step 1/4 — Generating RSA private key (stays on this server only)"
openssl genrsa -out "$OUT_DIR/distribution.key" 2048
chmod 600 "$OUT_DIR/distribution.key"

echo "▶ Step 2/4 — Creating Apple Distribution Certificate via ASC API"
# fastlane cert: creates certificate, saves .cer + .p12 to OUT_DIR
fastlane cert \
  --api_key_path "$OUT_DIR/api_key.json" \
  --output_path  "$OUT_DIR" \
  --platform      "ios" \
  2>&1 | grep -v "^$"

# Find the downloaded .p12 (fastlane names it <cert_id>.p12)
P12_FILE=$(find "$OUT_DIR" -name "*.p12" | head -1)
if [[ -z "$P12_FILE" ]]; then
  echo "ERROR: fastlane cert did not produce a .p12 file"
  exit 1
fi
echo "Certificate: $P12_FILE"

# Get the password fastlane used (it echoes it; capture from its output file or prompt)
# fastlane cert with --output_path uses an empty password for .p12 by default
# We re-export with our password for security
CER_FILE=$(find "$OUT_DIR" -name "*.cer" | head -1)
if [[ -n "$CER_FILE" ]]; then
  openssl x509 -in "$CER_FILE" -inform DER -out "$OUT_DIR/distribution.pem"
  openssl pkcs12 -export \
    -out "$OUT_DIR/Realink-distribution.p12" \
    -inkey "$OUT_DIR/distribution.key" \
    -in    "$OUT_DIR/distribution.pem" \
    -passout "pass:${CERT_PASSWORD}" \
    -legacy 2>/dev/null || \
  openssl pkcs12 -export \
    -out "$OUT_DIR/Realink-distribution.p12" \
    -inkey "$OUT_DIR/distribution.key" \
    -in    "$OUT_DIR/distribution.pem" \
    -passout "pass:${CERT_PASSWORD}"
else
  cp "$P12_FILE" "$OUT_DIR/Realink-distribution.p12"
fi

echo "▶ Step 3/4 — Creating App Store provisioning profile via ASC API"
fastlane sigh \
  --api_key_path        "$OUT_DIR/api_key.json" \
  --app_identifier      "$BUNDLE_ID" \
  --output_path         "$OUT_DIR" \
  --provisioning_name   "Realink AppStore" \
  --force               \
  --platform            "ios" \
  2>&1 | grep -v "^$"

PROFILE_FILE=$(find "$OUT_DIR" -name "*.mobileprovision" | head -1)
if [[ -z "$PROFILE_FILE" ]]; then
  echo "ERROR: fastlane sigh did not produce a .mobileprovision file"
  exit 1
fi
echo "Profile: $PROFILE_FILE"
cp "$PROFILE_FILE" "$OUT_DIR/Realink_AppStore.mobileprovision"

echo "▶ Step 4/4 — Encoding credentials for GitHub Secrets"
CERT_B64=$(base64 -w0 "$OUT_DIR/Realink-distribution.p12")
PROFILE_B64=$(base64 -w0 "$OUT_DIR/Realink_AppStore.mobileprovision")
KEY_CONTENT_ESCAPED=$(cat "$ASC_PRIVATE_KEY_PATH")

# Write a secrets summary file (do NOT commit this)
cat > "$OUT_DIR/github-secrets.txt" <<SECRETS
=================================================================
GitHub Actions Secrets — add these at:
github.com → your-repo → Settings → Secrets and variables → Actions

IOS_CERTIFICATE_BASE64
${CERT_B64}

IOS_CERTIFICATE_PASSWORD
${CERT_PASSWORD}

IOS_PROVISIONING_PROFILE_BASE64
${PROFILE_B64}

IOS_PROVISIONING_PROFILE_NAME
Realink AppStore

APPLE_TEAM_ID
${APPLE_TEAM_ID}

ASC_KEY_ID
${ASC_KEY_ID}

ASC_ISSUER_ID
${ASC_ISSUER_ID}

ASC_PRIVATE_KEY
${KEY_CONTENT_ESCAPED}
=================================================================
SECRETS

chmod 600 "$OUT_DIR/github-secrets.txt"

echo ""
echo "✓ Credentials generated:"
echo "  Certificate:        $OUT_DIR/Realink-distribution.p12"
echo "  Provisioning profile: $OUT_DIR/Realink_AppStore.mobileprovision"
echo "  GitHub secrets:     $OUT_DIR/github-secrets.txt"
echo ""
echo "Next: add the 8 secrets from $OUT_DIR/github-secrets.txt to GitHub,"
echo "then: git tag v0.9.47-ios && git push origin v0.9.47-ios"
echo ""
echo "SECURITY: run this when done:"
echo "  rm -rf $OUT_DIR"
