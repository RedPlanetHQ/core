#!/usr/bin/env bash
#
# Codesign the Swift voice helper so it satisfies Apple's notarization
# requirements (hardened runtime, secure timestamp, Developer ID).
#
# Tauri's bundler signs the .app and its Contents/MacOS/ executable but
# does NOT recurse into Contents/Resources/. The helper sits in
# Resources/ and Apple notarization rejects unsigned binaries inside the
# bundle, so we sign it explicitly here — invoked from tauri.macos.conf.json's
# `beforeBundleCommand` so the signature is in place before Tauri copies
# the helper into the bundle.
#
# No-op outside macOS / when no signing identity is configured.

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "[sign-voice-helper] APPLE_SIGNING_IDENTITY not set — skipping (dev build?)"
  exit 0
fi

# Resolve paths relative to this script — robust to CWD differences
# between `tauri build` invocations and direct calls.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HELPER="$SCRIPT_DIR/../src-tauri/binaries/core-voice"
ENTITLEMENTS="$SCRIPT_DIR/../src-tauri/entitlements.mac.plist"

if [ ! -f "$HELPER" ]; then
  echo "[sign-voice-helper] $HELPER not found — was the swift-voice build skipped?" >&2
  exit 1
fi

echo "[sign-voice-helper] signing $HELPER"
codesign --force --options runtime --timestamp \
  --entitlements "$ENTITLEMENTS" \
  --sign "$APPLE_SIGNING_IDENTITY" \
  "$HELPER"

codesign --verify --strict --verbose=2 "$HELPER"
echo "[sign-voice-helper] ok"
