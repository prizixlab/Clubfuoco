#!/usr/bin/env bash
# Standardized xcodebuild wrapper for ClubFuoco.
#
# Purpose: pin every build to ONE derivedDataPath so we never again
# accumulate duplicate DerivedData folders (each carries a ~3 GB Stripe
# SDK git pack). Always invoke builds through this script.
#
# Usage:
#   scripts/xcbuild.sh build
#   scripts/xcbuild.sh archive -destination 'generic/platform=iOS' -archivePath build/archives/ClubFuoco.xcarchive
#   scripts/xcbuild.sh test -destination 'platform=iOS Simulator,name=iPhone 16'
#
# Any extra args are passed straight through to xcodebuild. The scheme,
# project, and -derivedDataPath are fixed here and must not be overridden.
set -euo pipefail

# Resolve repo root relative to this script (works from any cwd).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT="$ROOT/ClubFuoco.xcodeproj"
SCHEME="ClubFuoco"
DERIVED_DATA="$ROOT/build/DerivedData"   # <- the one canonical path

exec xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -derivedDataPath "$DERIVED_DATA" \
  "$@"
