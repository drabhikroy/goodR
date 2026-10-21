#!/usr/bin/env bash
# Builds the signed, notarized Mac disk image on this Mac, for when a
# release is made by hand.
#
# Needs Xcode's command line tools, Node 22, Rust with both Mac targets,
# R, and the Developer ID Application certificate in the login keychain.
#
# Notarization uses a profile saved in the keychain once, with the App
# Store Connect API key:
#
#   xcrun notarytool store-credentials "GoodFor" \
#     --key ~/private/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer ISSUER-ID
#
# NOTARY_PROFILE names a different profile. APPLE_SIGNING_IDENTITY may name
# the certificate; without it, the first Developer ID Application
# certificate in the keychain is used.
#
# The disk image, and its checksum, are left in the project folder.

set -euo pipefail

cd "$(dirname "$0")/.."

profile="${NOTARY_PROFILE:-GoodFor}"

if [ "$(uname)" != "Darwin" ]; then
  echo "This builds the Mac disk image, so it runs on a Mac only." >&2
  exit 1
fi

if ! xcrun notarytool history --keychain-profile "$profile" > /dev/null 2>&1; then
  echo "No notarization profile named $profile was found. The comments at the top of this script show how to save one." >&2
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

# Tauri notarizes on its own when these are set. Here notarytool does it
# with the saved profile instead, so they are cleared.
unset APPLE_ID APPLE_PASSWORD APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH

rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
node scripts/fetch-ark.mjs universal-apple-darwin

npm run standards
npm run audit:contrast
npm test

# Tauri signs ark and the app with the hardened runtime and
# entitlements.plist.
npx tauri build --target universal-apple-darwin --bundles app

app="target/universal-apple-darwin/release/bundle/macos/Good For.app"

# Without this entitlement on ark, R fails to start in the signed app.
codesign -d --entitlements - "$app/Contents/MacOS/ark" 2>&1 | grep -q "disable-library-validation"
GOODFOR_ARK="$app/Contents/MacOS/ark" cargo test -p rsession --test integration

# The app is notarized and stapled first, so it opens without a warning
# even when it is copied off the disk image with no internet connection.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ditto -c -k --keepParent "$app" "$work/app.zip"
xcrun notarytool submit "$work/app.zip" --keychain-profile "$profile" --wait
xcrun stapler staple "$app"

# Then the disk image: the app beside a link to Applications, to drag
# across, signed and notarized in its own right.
mkdir "$work/stage"
ditto "$app" "$work/stage/Good For.app"
ln -s /Applications "$work/stage/Applications"
rm -f Good-For.dmg
hdiutil create -volname "Good For" -srcfolder "$work/stage" -format UDZO Good-For.dmg
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp Good-For.dmg
xcrun notarytool submit Good-For.dmg --keychain-profile "$profile" --wait
xcrun stapler staple Good-For.dmg

xcrun stapler validate Good-For.dmg
codesign --verify --deep --strict --verbose=2 "$app"
spctl --assess --type execute --verbose=4 "$app"
spctl --assess --type open --context context:primary-signature --verbose=4 Good-For.dmg
shasum -a 256 Good-For.dmg | tee Good-For.dmg.sha256

echo "Good-For.dmg is signed, notarized, and ready to share."
