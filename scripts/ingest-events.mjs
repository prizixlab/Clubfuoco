#!/usr/bin/env node
// Ingest the Barcelona event calendar from the agentbox scraper into Supabase.
// See EVENTS_INGEST_BRIEF.md.
//
//   node --env-file=.env.local scripts/ingest-events.mjs            # pull over SSH
//   node --env-file=.env.local scripts/ingest-events.mjs --file x.csv
//   node --env-file=.env.local scripts/ingest-events.mjs --dry-run
//
// Upserts on ra_event_id. first_seen is never overwritten, and events that
// drop out of the rolling window are NEVER deleted — they have usually just
// aged past the 14-day horizon rather than been cancelled (brief §7).
//
// REACHABILITY: the box is a LAN address, so nothing hosted in the cloud can
// run this. It has to run from the Mac, or be inverted so the box pushes.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const HOST = process.env.EVENTS_HOST ?? 'yvinnik@10.0.0.235'
const REMOTE = '~/scraper/intel/events/upcoming.csv'
const BATCH = 100

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileArg = args.indexOf('--file')

// ── CSV (RFC 4180: quoted fields, embedded commas, doubled quotes) ───────────
// 22 of ~190 titles contain a comma, so a naive split() corrupts the data.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)   // utf-8-sig BOM
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter(r => r.length > 1)
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// ── Venue resolution (brief §5) ──────────────────────────────────────────────
// Only writes a club_id it is confident about; everything else stays null and
// keeps venue_name for a later backfill. Two rules, both requiring uniqueness:
//   exact  normalised names are identical
//   core   the venue's distinctive tokens are a SUBSET of the club's AND both
//          lead with the same token
// The subset direction and the leading-token check are what keep it honest:
// without them "Bonavista Rooftop" matches "Bodega Bonavista" and "Teatre
// Grec" matches "Bar Teatre".
const GENERIC = new Set(['club','bar','barcelona','the','disco','discoteca','sala','lounge',
  'hotel','cafe','restaurant','beach','rooftop','terrace','terraza','music','night','bcn',
  'de','la','el','los','las','and','pub','room','studio','garden','sky'])

const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const core = s => norm(s).split(' ').filter(t => t.length > 1 && !GENERIC.has(t))

function buildResolver(clubs) {
  const byNorm = new Map()
  const indexed = clubs.map(c => {
    const n = norm(c.name)
    if (!byNorm.has(n)) byNorm.set(n, [])
    byNorm.get(n).push(c)
    return { c, core: core(c.name) }
  })
  const pick = pool => {
    const active = pool.filter(c => c.is_active)
    const chosen = active.length ? active : pool
    return new Set(chosen.map(c => c.id)).size > 1 ? null : chosen[0]
  }
  return venue => {
    const n = norm(venue), k = core(venue)
    if (byNorm.has(n)) {
      const hit = pick(byNorm.get(n))
      if (hit) return { club: hit, how: 'exact' }
    }
    if (!k.length) return { club: null, how: null }
    const ks = new Set(k)
    const hits = indexed
      .filter(({ core: ck }) => ck.length && ck[0] === k[0] && [...ks].every(t => ck.includes(t)))
      .map(({ c }) => c)
    if (!hits.length) return { club: null, how: null }
    const hit = pick(hits)
    return hit ? { club: hit, how: 'core' } : { club: null, how: null }
  }
}

// ── Supabase REST (service role) ─────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
  console.error('Run with: node --env-file=.env.local scripts/ingest-events.mjs')
  process.exit(1)
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function fetchAll(path) {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${URL}/rest/v1/${path}&offset=${offset}&limit=1000`, { headers })
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
    const batch = await res.json()
    out.push(...batch)
    if (batch.length < 1000) return out
  }
}

const splitList = s => (s ? s.split('|').map(v => v.trim()).filter(Boolean) : [])
const intOr0 = s => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0 }

async function main() {
  const csv = fileArg !== -1
    ? readFileSync(args[fileArg + 1], 'utf8')
    : execFileSync('ssh', ['-o', 'ConnectTimeout=10', HOST, `cat ${REMOTE}`],
                   { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

  const rows = parseCSV(csv).filter(r => r.ra_event_id)
  console.log(`source: ${rows.length} events, ${new Set(rows.map(r => r.venue)).size} venues`)

  const clubs = await fetchAll('clubs?select=id,name,is_active&order=id')
  const resolve = buildResolver(clubs)
  console.log(`clubs: ${clubs.length} (${clubs.filter(c => c.is_active).length} active)`)

  // first_seen must never be overwritten by a later run (brief §6).
  let existing = new Map()
  try {
    existing = new Map(
      (await fetchAll('events?select=ra_event_id,first_seen&order=ra_event_id'))
        .map(e => [e.ra_event_id, e.first_seen]))
  } catch (e) {
    if (!/PGRST205|Could not find the table/.test(e.message)) throw e
    if (!dryRun) {
      console.error('\npublic.events does not exist yet.')
      console.error('Apply supabase/migrations/20260719_events_ingest.sql in the Supabase')
      console.error('SQL editor first (schema changes are hand-applied here), then re-run.')
      process.exit(1)
    }
    console.log('note: public.events not created yet — treating every event as new.')
  }

  const stats = { exact: 0, core: 0, unresolved: 0 }
  const payload = rows.map(r => {
    const { club, how } = resolve(r.venue)
    if (how) stats[how]++; else stats.unresolved++
    return {
      ra_event_id: r.ra_event_id,
      title:       r.title,
      date:        r.date,
      start_time:  r.start_time || null,
      venue_name:  r.venue,
      club_id:     club?.id ?? null,
      club_match:  how,
      promoters:   splitList(r.promoters),
      artists:     splitList(r.artists),
      interested:  intOr0(r.interested),
      attending:   intOr0(r.attending),
      cost:        r.cost || null,
      ra_url:      r.ra_url || null,
      first_seen:  existing.get(r.ra_event_id) ?? (r.first_seen || null),
      last_seen:   r.last_seen || null,
    }
  })

  const withClub = payload.filter(e => e.club_id).length
  console.log(`resolved: ${stats.exact} exact + ${stats.core} core = ${withClub}/${payload.length} events`
            + ` (${stats.unresolved} venues unresolved, kept as venue_name)`)

  if (dryRun) {
    console.log('\n--dry-run: nothing written. Sample row:')
    console.log(JSON.stringify(payload[0], null, 2))
    return
  }

  let written = 0
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH)
    const res = await fetch(`${URL}/rest/v1/events?on_conflict=ra_event_id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`)
    written += chunk.length
    process.stdout.write(`\rupserted ${written}/${payload.length}`)
  }
  console.log(`\ndone — ${written} events upserted, ${existing.size} already present.`)
}

main().catch(e => { console.error('\n' + e.message); process.exit(1) })
