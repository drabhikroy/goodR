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
#   xcrun notarytool store-credentials "goodR" \
#     --key ~/private/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer ISSUER-ID
#
# NOTARY_PROFILE names a different profile. APPLE_SIGNING_IDENTITY may name
# the certificate; without it, the first Developer ID Application
# certificate in the keychain is used.
#
# The disk image, and its checksum, are left in the project folder.

set -euo pipefail

cd "$(dirname "$0")/.."

profile="${NOTARY_PROFILE:-goodR}"

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

# A full path, since the R tests below run from inside their own crate.
app="$PWD/target/universal-apple-darwin/release/bundle/macos/goodR.app"

# Without this entitlement on ark, R fails to start in the signed app.
codesign -d --entitlements - "$app/Contents/MacOS/ark" 2>&1 | grep -q "disable-library-validation"
GOODFOR_ARK="$app/Contents/MacOS/ark" cargo test -p rsession --test integration

# The app is notarized and stapled first, so it opens without a warning
# even when it is copied off the disk image with no internet connection.
work="$(mktemp -d)"
trap 'hdiutil detach "$work/mount" > /dev/null 2>&1; rm -rf "$work"' EXIT
ditto -c -k --keepParent "$app" "$work/app.zip"
xcrun notarytool submit "$work/app.zip" --keychain-profile "$profile" --wait --timeout 20m
xcrun stapler staple "$app"

# Then the disk image: the app beside a link to Applications, to drag
# across, signed and notarized in its own right.
mkdir "$work/stage"
# Copied without extended attributes: a synced folder can add Finder ones,
# which strict signature checks refuse. The signature and the stapled
# ticket are files inside the app, so they come across.
ditto --norsrc --noextattr "$app" "$work/stage/goodR.app"
ln -s /Applications "$work/stage/Applications"
rm -f goodR.dmg
hdiutil create -volname "goodR" -srcfolder "$work/stage" -format UDZO goodR.dmg
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp goodR.dmg
xcrun notarytool submit goodR.dmg --keychain-profile "$profile" --wait --timeout 20m
xcrun stapler staple goodR.dmg

xcrun stapler validate goodR.dmg

# The checks run on the app inside the disk image, the copy people get.
mkdir "$work/mount"
hdiutil attach -nobrowse -readonly -mountpoint "$work/mount" goodR.dmg > /dev/null
codesign --verify --deep --strict --verbose=2 "$work/mount/goodR.app"
spctl --assess --type execute --verbose=4 "$work/mount/goodR.app"
hdiutil detach "$work/mount" > /dev/null
spctl --assess --type open --context context:primary-signature --verbose=4 goodR.dmg
shasum -a 256 goodR.dmg | tee goodR.dmg.sha256

echo "goodR.dmg is signed, notarized, and ready to share."
