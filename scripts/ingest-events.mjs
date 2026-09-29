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
//
// PROVENANCE (added 2026-09-29). `events` became one dataset shared with the
// ticket scrape and, later, promoters — origin is a column now
// (20260922_events_one_dataset.sql). This script is one writer among several,
// so it has two new obligations:
//
//   1. STAMP WHAT IT WROTE. Every row gets origin / source_ref / source_at.
//      PostgREST's merge-duplicates upsert only touches the columns in the
//      payload, so including them here also REPAIRS rows that lost their
//      provenance — 1676 of 1812 were missing source_ref when this was
//      written, because the old sync-events cron had been deleting past rows
//      through the ra_events view and this script kept re-creating them bare.
//
//   2. NOT OVERWRITE A HUMAN. `locked_fields` lists columns somebody set by
//      hand; a scrape must leave those alone, and must not flatten a row a
//      promoter owns. Rows needing that care are patched individually; the
//      rest still go through the fast bulk upsert, so the common path is as
//      quick as it was.
//
// The equivalent rules for the TICKET scrape live in src/lib/event-merge.ts.
// The two deliberately differ on one column: club_id/club_match are forbidden
// there and owned here, because THIS script is the venue resolver.

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
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

/** Checked inside main(), not at import: the pure helpers below are imported
 *  by the tests, and a module that exits the process on import cannot be. */
function requireCredentials() {
  if (URL && KEY) return
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
  console.error('Run with: node --env-file=.env.local scripts/ingest-events.mjs')
  process.exit(1)
}

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

// ── Provenance policy ────────────────────────────────────────────────────────

/** What this scrape claims to be. Matches events_origin_ck. */
export const ORIGIN = 'scrape:ra'

/** Origins this scrape must not overwrite. A promoter describing their own
 *  night beats RA's listing of it; staff and venue edits likewise. */
export const AUTHORITATIVE_ORIGINS = new Set(['promoter', 'venue', 'staff'])

/** The columns this script owns and may write on an UPDATE.
 *
 *  Note what is absent: `ra_event_id` (the key), `first_seen` (never
 *  overwritten — brief §6), `origin` / `source_ref` / `source_at` (set
 *  separately, and never changed on a row we do not own), `locked_fields`
 *  (a human's, never a scraper's), and the ticketing columns base_price /
 *  display_price / currency / sold_out, which belong to the ticket scrape. */
export const SCRAPE_OWNED = [
  'title', 'date', 'start_time', 'venue_name',
  // club_id/club_match are ours because this script IS the venue resolver.
  // They are forbidden to the ticket scrape, which has no resolver.
  'club_id', 'club_match',
  'promoters', 'artists', 'interested', 'attending',
  'cost', 'ra_url', 'image', 'description', 'last_seen',
]

/**
 * Split the payload into rows that can go through the fast bulk upsert and
 * rows that need an individual, reduced PATCH.
 *
 * Pure, so it can be tested without a network — see ingest-events.test.mjs.
 *
 * `existing` maps ra_event_id → { first_seen, locked_fields, origin }.
 */
export function planWrites(payload, existing) {
  const bulk = []
  const patches = []
  let protectedFields = 0

  for (const row of payload) {
    const prior = existing.get(row.ra_event_id)

    // New row, or a plain scrape row nobody has touched: nothing to protect.
    const locked = new Set(prior?.locked_fields ?? [])
    const foreign = prior ? AUTHORITATIVE_ORIGINS.has(prior.origin) : false
    if (!prior || (locked.size === 0 && !foreign)) {
      bulk.push(row)
      continue
    }

    // Somebody owns part of this row. Send only the columns we may still set.
    const patch = {}
    for (const col of SCRAPE_OWNED) {
      if (!(col in row)) continue
      if (locked.has(col)) { protectedFields++; continue }
      // On a row owned by a promoter we assert nothing except that RA still
      // lists it. Filling their blanks would need their current values; that
      // is a bigger read, and silence is the safe default until it is worth it.
      if (foreign && col !== 'last_seen') { protectedFields++; continue }
      patch[col] = row[col]
    }
    // Stamp freshness, never the origin of a row we do not own.
    patch.source_at = row.source_at
    if (!foreign) patch.source_ref = row.source_ref

    patches.push({ ra_event_id: row.ra_event_id, patch })
  }

  return { bulk, patches, protectedFields }
}

// RA reports start times as NAIVE LOCAL Barcelona wall-clock ("...T23:00:00.000").
// Handing that to a timestamptz column makes Postgres read it as UTC, which
// stores a 23:00 door as 01:00 the next morning — every event 2h late in
// summer, 1h in winter. Stamp the real Europe/Madrid offset instead so the
// stored instant is correct year-round (the zone handles its own DST).
//
// The offset is resolved AT that date, so it follows CET/CEST automatically.
// Within the one ambiguous hour of a DST fall-back this can pick the wrong
// side; that is a twice-a-year, one-hour edge case on nightlife listings.
function toMadridISO(naive) {
  if (!naive) return null
  const base = naive.replace(/\.\d+$/, '').replace(/[Zz]$|[+-]\d{2}:?\d{2}$/, '')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${base}Z`))
  const tz = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz)
  return `${base}${m ? `${m[1]}${m[2]}:${m[3]}` : 'Z'}`
}

async function main() {
  requireCredentials()
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
  // locked_fields and origin decide what else this run may touch.
  let existing = new Map()
  try {
    existing = new Map(
      (await fetchAll('events?select=ra_event_id,first_seen,locked_fields,origin&order=ra_event_id'))
        .map(e => [e.ra_event_id, e]))
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

  const runAt = new Date().toISOString()
  const stats = { exact: 0, core: 0, unresolved: 0 }
  const payload = rows.map(r => {
    const { club, how } = resolve(r.venue)
    if (how) stats[how]++; else stats.unresolved++
    return {
      ra_event_id: r.ra_event_id,
      title:       r.title,
      date:        r.date,
      start_time:  toMadridISO(r.start_time),
      venue_name:  r.venue,
      club_id:     club?.id ?? null,
      club_match:  how,
      promoters:   splitList(r.promoters),
      artists:     splitList(r.artists),
      interested:  intOr0(r.interested),
      attending:   intOr0(r.attending),
      cost:        r.cost || null,
      ra_url:      r.ra_url || null,
      // Artwork + copy, where RA exposes them. Absent from older upcoming.csv
      // exports (the column just isn't there) → undefined → null, so this stays
      // compatible until the scraper adds them (EVENTS_INGEST_BRIEF.md, 2026-08-12).
      image:       r.image || null,
      description: r.description || null,
      first_seen:  existing.get(r.ra_event_id)?.first_seen ?? (r.first_seen || null),
      last_seen:   r.last_seen || null,
      // Provenance. source_ref carries the platform prefix, matching what the
      // ra_events compatibility view exposes as `id`.
      origin:      ORIGIN,
      source_ref:  `ra_${r.ra_event_id}`,
      source_at:   runAt,
    }
  })

  const withClub = payload.filter(e => e.club_id).length
  console.log(`resolved: ${stats.exact} exact + ${stats.core} core = ${withClub}/${payload.length} events`
            + ` (${stats.unresolved} venues unresolved, kept as venue_name)`)

  const { bulk, patches, protectedFields } = planWrites(payload, existing)
  if (patches.length) {
    console.log(`protected: ${patches.length} row(s) carry locked fields or a`
              + ` non-scrape origin — ${protectedFields} field(s) left alone`)
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.')
    console.log(`would bulk-upsert ${bulk.length}, patch ${patches.length}`)
    console.log('sample row:', JSON.stringify(payload[0], null, 2))
    if (patches.length) console.log('sample patch:', JSON.stringify(patches[0], null, 2))
    return
  }

  let written = 0
  for (let i = 0; i < bulk.length; i += BATCH) {
    const chunk = bulk.slice(i, i + BATCH)
    const res = await fetch(`${URL}/rest/v1/events?on_conflict=ra_event_id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`)
    written += chunk.length
    process.stdout.write(`\rupserted ${written}/${bulk.length}`)
  }

  // The careful path, one row at a time. Rare by construction — only rows a
  // human or a promoter has a claim on — so the extra round-trips are cheap.
  let patched = 0
  for (const { ra_event_id, patch } of patches) {
    const res = await fetch(
      `${URL}/rest/v1/events?ra_event_id=eq.${encodeURIComponent(ra_event_id)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
    if (!res.ok) throw new Error(`patch ${ra_event_id} failed: ${res.status} ${await res.text()}`)
    patched++
  }

  console.log(`\ndone — ${written} upserted, ${patched} patched, ${existing.size} already present.`)
}

// Guarded so the pure helpers above can be imported by the tests without the
// script trying to SSH to the scraper box.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('\n' + e.message); process.exit(1) })
}
