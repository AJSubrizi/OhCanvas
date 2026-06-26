#!/usr/bin/env bash
# Build + ad-hoc sign the Apple Speech stt-helper for OhCanvas as a .app bundle.
# macOS only. Produces stt/OhCanvasSTT.app.
#
# A proper .app bundle (with Info.plist at Contents/Info.plist and an ad-hoc
# signature) is what lets macOS present the microphone / speech TCC prompt when
# the sidecar spawns this helper. A bare Mach-O binary will not get the prompt.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> repo root
DIR="stt"
APP="$DIR/OhCanvasSTT.app"

echo "Compiling stt-helper binary..."
swiftc -O \
  -o "$DIR/stt-helper-bin" \
  "$DIR/main.swift"

echo "Assembling .app bundle..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$DIR/stt-helper-bin" "$APP/Contents/MacOS/stt-helper"
rm -f "$DIR/stt-helper-bin"
cp "$DIR/Info.plist" "$APP/Contents/Info.plist"

echo "Ad-hoc signing bundle..."
codesign --force --deep --sign - "$APP"

echo "Verifying..."
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Format|Signature" || true
echo "Done: $APP"
