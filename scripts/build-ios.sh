#!/bin/bash
# Build script for Capacitor iOS static export.
#
# Next.js "output: export" cannot process API routes — they run on the server.
# We temporarily move src/app/api out of the way, build the static bundle,
# then restore it. The iOS app always calls API routes on Vercel via apiFetch().
#
# Dynamic route pages have permanent server wrappers (page.tsx) that:
#   - export generateStaticParams() returning one placeholder entry
#   - render the real client component from the _client/ subdirectory
# The placeholder keeps Next.js happy; Capacitor navigates entirely client-side.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
API_DIR="$ROOT/src/app/api"
API_BACKUP="$ROOT/.api_backup"

cleanup() {
  if [ -d "$API_BACKUP" ]; then
    echo "→ Restoring src/app/api …"
    mv "$API_BACKUP" "$API_DIR"
  fi
}
trap cleanup EXIT

# 1. Hide API routes from the static export
if [ -d "$API_DIR" ]; then
  echo "→ Temporarily moving src/app/api out of the way …"
  mv "$API_DIR" "$API_BACKUP"
fi

# 2. Build the static export (BROWSERSLIST_ENV=ios targets WebKit-only polyfills)
echo "→ Running Next.js static export build …"
cd "$ROOT"
BUILD_TARGET=ios BROWSERSLIST_ENV=ios npx next build

# 3. Sync the /out directory to the iOS Capacitor project
echo "→ Syncing to Capacitor iOS …"
npx cap sync ios

echo "✓ iOS build complete."
