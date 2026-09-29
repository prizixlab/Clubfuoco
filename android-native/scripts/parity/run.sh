#!/usr/bin/env bash
# Regenerate the golden parity vectors from the REAL iOS Swift source.
#
# Each generator compiles a small main.swift TOGETHER with the actual shipping
# implementation file, runs it over a corpus, and writes JSON into the Android
# test resources. The Kotlin parity tests then assert identical behaviour.
#
# Run this whenever the corresponding Swift file changes. A failing test after a
# regeneration is the signal: either the Kotlin port needs updating to match, or
# the iOS change was unintended.
#
#   ./scripts/parity/run.sh
#   ./gradlew :app:testDebugUnitTest

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS="$HERE/../../../ios-native/ClubFuoco"
OUT="$HERE/../../app/src/test/resources/parity"
mkdir -p "$OUT" "$HERE/build"

command -v swiftc >/dev/null || { echo "swiftc not found — needs Xcode"; exit 1; }

# <generator dir> <output json> <swift sources it needs…>
generate() {
  local name="$1"; shift
  local out="$1"; shift
  echo "  $out"
  swiftc -O "$HERE/$name/main.swift" "$@" -o "$HERE/build/gen-$name"
  "$HERE/build/gen-$name" > "$OUT/$out"
}

echo "Generating parity vectors from ios-native…"
generate validdays  valid_days.json  "$IOS/Core/Utils/ValidDays.swift"
generate venuematch venue_match.json "$IOS/Models/ExternalEvent.swift"

echo "Done."
