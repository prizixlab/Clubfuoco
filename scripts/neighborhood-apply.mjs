// ─────────────────────────────────────────────────────────────────────────────
// neighborhood-apply.mjs — Applies the reviewed neighborhood fills to the DB.
// Reads scripts/neighborhood-fill-report.json and updates clubs.neighborhood
// ONLY where it is still empty (never overwrites). Requires the service-role key.
//
// Run:  node --env-file=.env.local scripts/neighborhood-apply.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const report = JSON.parse(readFileSync(new URL('./neighborhood-fill-report.json', import.meta.url)))
const proposals = report.proposals || []
console.log(`Applying ${proposals.length} neighborhood fills (only where currently empty)…`)

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

let updated = 0, skipped = 0, failed = 0
for (const p of proposals) {
  const { data, error } = await supabase
    .from('clubs')
    .update({ neighborhood: p.neighborhood })
    .eq('id', p.club_id)
    .or('neighborhood.is.null,neighborhood.eq.')
    .select('id')
  if (error) { failed++; console.error(`  ✗ ${p.club_name}: ${error.message}`); continue }
  if (data && data.length) updated++; else skipped++
}

console.log(`\nDone. Updated ${updated} · skipped ${skipped} (already had a value) · failed ${failed}`)
