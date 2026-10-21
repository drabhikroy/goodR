#!/usr/bin/env bash
# Builds the signed, notarized Mac disk image on this Mac, the same way the
# Release macOS workflow does, for when a release is made by hand.
#
# Needs Xcode's command line tools, Node 22, Rust with both Mac targets,
# R, and the Developer ID Application certificate in the login keychain.
# Notarization uses an App Store Connect API key, named by three settings:
#
#   APPLE_API_KEY_PATH  where the key's .p8 file is
#   APPLE_API_KEY       the key's ten character ID
#   APPLE_API_ISSUER    the issuer ID shown above the keys in App Store Connect
#
# APPLE_SIGNING_IDENTITY may name the certificate. Without it, the first
# Developer ID Application certificate in the keychain is used.
#
# The disk image, and its checksum, are left in the project folder.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "This builds the Mac disk image, so it runs on a Mac only." >&2
  exit 1
fi

for name in APPLE_API_KEY_PATH APPLE_API_KEY APPLE_API_ISSUER; do
  if [ -z "${!name:-}" ]; then
    echo "Set $name first. The comments at the top of this script say what each one is." >&2
    exit 1
  fi
done
if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "No key file is at $APPLE_API_KEY_PATH." >&2
  exit 1
fi

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -n 1)"
  if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
    echo "No Developer ID Application certificate is in the keychain." >&2
    exit 1
  fi
fi
export APPLE_SIGNING_IDENTITY
echo "Signing as $APPLE_SIGNING_IDENTITY"

rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
node scripts/fetch-ark.mjs universal-apple-darwin
node scripts/fetch-ark.mjs

npm run standards
npm run audit:contrast
npm test

# Tauri signs ark and the app with the hardened runtime and
# entitlements.plist, then notarizes and staples the app.
npx tauri build --target universal-apple-darwin --bundles app,dmg

app="target/universal-apple-darwin/release/bundle/macos/Good For.app"

# Without this entitlement on ark, R fails to start in the signed app.
codesign -d --entitlements - "$app/Contents/MacOS/ark" 2>&1 | grep -q "disable-library-validation"
GOODFOR_ARK="$app/Contents/MacOS/ark" cargo test -p rsession --test integration

# The disk image gets its own ticket, so it opens without a warning even
# before the app inside it is checked.
cp "$(ls target/universal-apple-darwin/release/bundle/dmg/*.dmg | head -n 1)" Good-For.dmg
xcrun notarytool submit Good-For.dmg --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple Good-For.dmg
xcrun stapler validate Good-For.dmg
codesign --verify --deep --strict --verbose=2 "$app"
spctl --assess --type execute --verbose=4 "$app"
spctl --assess --type open --context context:primary-signature --verbose=4 Good-For.dmg
shasum -a 256 Good-For.dmg | tee Good-For.dmg.sha256

echo "Good-For.dmg is signed, notarized, and ready to share."
