#!/usr/bin/env bash
# Run a migration against a throwaway local Postgres before pasting it into the
# Supabase SQL editor.
#
# Production drifts from supabase/migrations (everything is applied by hand), so
# this does NOT prove a migration will succeed against production — it proves
# the SQL parses, the types line up, the views build, and a second run does not
# blow up. That is the class of mistake worth catching before a paste.
#
# Needs: brew install postgresql@17   (Supabase's own CLI needs Docker for
# `supabase start`, which this machine does not have, so a plain Postgres is
# what we use.)
#
#   scripts/validate-migration.sh 20260922_events_one_dataset [more...]
#
# The fixture in scripts/sql-fixtures/ stands in for the live schema, as far as
# the migrations under test touch it. `events` is verbatim from
# 20260719_events_ingest.sql; the rest is reconstructed from live column lists
# with types verified in the repo's own migrations. EXTEND IT when a migration
# touches a table it does not yet cover, or you are validating against a
# fiction.
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="cf_validate_$$"
FIXTURE="${FIXTURE:-$ROOT/scripts/sql-fixtures/events-dj-scores.sql}"

if ! pg_isready -q 2>/dev/null; then
  echo "Postgres is not running. Start it with:"
  echo "  LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@17 -l /tmp/pg17.log start"
  echo "(LC_ALL matters — without it the server dies with 'became multithreaded during startup')"
  exit 1
fi

cleanup() { dropdb --if-exists "$DB" 2>/dev/null || true; }
trap cleanup EXIT

createdb "$DB"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$FIXTURE"
echo "fixture loaded into $DB"

fail=0
for pass in 1 2; do
  echo "── pass $pass ────────────────────────────────"
  for name in "$@"; do
    file="$ROOT/supabase/migrations/${name%.sql}.sql"
    if psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$file" >/dev/null 2>/tmp/"$DB".err; then
      echo "  ok    ${name%.sql}"
    else
      echo "  FAIL  ${name%.sql}"
      sed -n '1,20p' /tmp/"$DB".err | sed 's/^/        /'
      fail=1
    fi
  done
done

# Pass 2 exists on purpose: these get pasted by hand, sometimes twice.
[ "$fail" -eq 0 ] && echo "all migrations apply cleanly, and are safe to re-run"
exit "$fail"
