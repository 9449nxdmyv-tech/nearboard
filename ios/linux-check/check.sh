#!/usr/bin/env bash
#
# Typecheck the iOS plugin on a machine with no Xcode.
#
# CoreBluetooth and Capacitor do not exist outside Apple platforms, so the real
# SDK cannot be used here. AppleStubs.swift declares the exact API surface the
# plugin touches, which is enough for the compiler to catch a misspelled method,
# a wrong argument label, a bad delegate signature or a type mismatch — the
# errors that otherwise wait until someone opens Xcode.
#
# WHAT THIS DOES NOT DO
# ---------------------
# The stubs are transcribed from Apple's published API by hand. If a signature
# is wrong, this checks against a fiction. A clean run means "no obvious
# errors", not "will compile". Runtime behaviour — advertising, GATT, iOS
# background limits — is untouched by this and still needs a device.
#
# The negative control below exists so a pass is meaningful: if a deliberately
# broken copy also passes, the harness is not actually checking anything.
#
# Usage: ios/linux-check/check.sh

set -uo pipefail
cd "$(dirname "$0")"

SWIFT_BIN="${SWIFT_BIN:-$HOME/.local/toolchains/swift-6.0.3-RELEASE-ubuntu24.04/usr/bin}"
if [ ! -x "$SWIFT_BIN/swiftc" ]; then
  echo "No Swift toolchain at $SWIFT_BIN"
  echo "Download from https://swift.org/download/ and extract, or set SWIFT_BIN."
  exit 127
fi
export PATH="$SWIFT_BIN:$PATH"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Strip the imports and Capacitor's @objc attributes: the stubs stand in for
# those modules, and @objc requires an Objective-C runtime Linux lacks.
prepare() {
  perl -0pe 's/^import Capacitor\n//m; s/^import CoreBluetooth\n//m; s/\@objc\([A-Za-z]+\)\n//m; s/\@objc func/func/g' "$1"
}

prepare ../App/App/MeshPeripheralPlugin.swift > "$WORK/Plugin.swift"

echo "1. syntax"
swiftc -parse "$WORK/Plugin.swift" || { echo "   FAILED"; exit 1; }
echo "   ok"

echo "2. negative control (a deliberately broken copy must fail)"
sed 's/peripheral\.respond(/peripheral.respondd(/' "$WORK/Plugin.swift" > "$WORK/Broken.swift"
if swiftc -typecheck AppleStubs.swift "$WORK/Broken.swift" >/dev/null 2>&1; then
  echo "   FAILED — broken code passed, so this harness proves nothing"
  exit 1
fi
echo "   ok (broken code correctly rejected)"

echo "3. typecheck against stubs"
if ! swiftc -typecheck AppleStubs.swift "$WORK/Plugin.swift"; then
  echo "   FAILED"
  exit 1
fi
echo "   ok"

echo
echo "No obvious errors. Still needs Xcode and a device to confirm it builds and runs."
