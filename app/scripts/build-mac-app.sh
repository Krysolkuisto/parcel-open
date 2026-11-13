#!/bin/bash
# Builds a double-clickable macOS app (build/ParcelOpen.app) with the Swift Package Manager only,
# no Xcode needed. The widget needs Xcode: see ../README.md.
set -euo pipefail

cd "$(dirname "$0")/.."
BUNDLE_ID="com.krysolkuisto.parcelopen"
APP="build/ParcelOpen.app"

swift build -c release --product ParcelOpen
BIN_DIR="$(swift build -c release --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/ParcelOpen" "$APP/Contents/MacOS/ParcelOpen"
cp -R "$BIN_DIR/ParcelOpen_ParcelKit.bundle" "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ParcelOpen</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>Parcel Open</string>
  <key>CFBundleDisplayName</key><string>Parcel Open</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array><string>en</string><string>fr</string></array>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# Ad-hoc signature: enough to run on this Mac. Distribute properly signed builds from Xcode.
codesign --force --deep --sign - "$APP"
echo "Built $APP"
