#!/bin/sh
set -eu
[ "$#" -le 1 ] || { printf '%s\n' "Usage: sh native/build-app.sh [APP_PATH]" >&2; exit 1; }
cd "$(dirname "$0")/.."
swift build -c release --package-path native/NervMenuBar
app="${1:-dist/NERV.app}"
mkdir -p "$app/Contents/MacOS"
cp native/NervMenuBar/.build/release/NervMenuBar "$app/Contents/MacOS/NervMenuBar"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.nerv.companion</string><key>CFBundleName</key><string>NERV Agency</string><key>CFBundleDisplayName</key><string>NERV Agency</string><key>CFBundleExecutable</key><string>NervMenuBar</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/></dict></plist>
PLIST
codesign --force --sign - "$app"
printf '%s\n' "Built $app (local ad-hoc signature; no distribution notarization)."
