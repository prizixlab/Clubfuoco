#!/usr/bin/env node
/**
 * Regenerates CORPUS_GENERIC in src/lib/venue-match.ts.
 *
 * Counts, across every active club name, how many distinct clubs each word
 * appears in (document frequency) and prints those at or above the threshold.
 * A word carried by many unrelated clubs identifies none of them, so it must
 * not be allowed to make two venue names match.
 *
 * Run after a material change to the club set, and paste the output into
 * CORPUS_GENERIC (then update the Swift copy in ExternalEvent.swift to match):
 *
 *   node scripts/venue-stopwords.mjs            # default threshold, df >= 3
 *   node scripts/venue-stopwords.mjs 4          # stricter: fewer stopwords
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from 'node:fs'
import path from 'node:path'

const THRESHOLD = Number(process.argv[2] ?? 3)

const envPath = path.join(process.cwd(), '.env.local')
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

/** Page through PostgREST, which caps a single response at 1000 rows. */
async function allActiveClubs() {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/clubs?select=name&is_active=eq.true&order=id&offset=${offset}&limit=1000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    if (!res.ok) throw new Error(`clubs fetch failed: ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// Mirrors normName() in src/lib/venue-match.ts.
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()

const clubs = await allActiveClubs()
const df = new Map()
for (const c of clubs) {
  for (const w of new Set(norm(c.name).split(' ').filter(w => w.length > 3))) {
    df.set(w, (df.get(w) ?? 0) + 1)
  }
}

const generic = [...df.entries()]
  .filter(([, n]) => n >= THRESHOLD)
  .sort(([a], [b]) => a.localeCompare(b))

console.log(`# ${clubs.length} active clubs, ${df.size} distinct words, df >= ${THRESHOLD}`)
console.log(`# ${generic.length} generic words\n`)
for (let i = 0; i < generic.length; i += 6) {
  console.log('  ' + generic.slice(i, i + 6).map(([w]) => `'${w}',`).join(' '))
}
console.log('\n# df detail:', generic.map(([w, n]) => `${w}:${n}`).join(' '))
