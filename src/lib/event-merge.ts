// What a scraper is allowed to change on an event row.
//
// `events` is now one dataset written by several hands: the agentbox RA
// programme scrape, the sync-events ticket scrape, and (through the portal)
// promoters and staff. Origin is a column, which means the nightly jobs run
// over rows they did not create — so "upsert everything" is no longer a safe
// write, and until now it was the write we did. sync-events upserts at 06:00
// daily, so a promoter correcting a door time or a lineup lost it overnight
// with no error and no trace.
//
// Two rules, both enforced here rather than remembered at each call site:
//
//   1. A scraper NEVER touches a column listed in `locked_fields`. That array
//      is set when a human edits a field, and it is the whole mechanism — the
//      same contract club_dj_sets already uses (source='manual' is left alone,
//      source='auto' is rewritten), generalised from rows to fields.
//
//   2. A scraper never DOWNGRADES a row's origin. A night first seen on RA and
//      since claimed by its promoter stays 'promoter': the promoter is the
//      better authority on their own night, and the scrape is then only topping
//      up fields nobody has asserted.
//
// Pure, so it is tested without a database. The caller applies the patch.

/** Origins, most authoritative last. A scrape may never move a row leftward
 *  past where it already is. 'inferred' is lowest: it is our own derived data
 *  (the Fuoco Score, the DJ effects) and must never outrank an observation. */
export const ORIGIN_RANK = [
  'inferred',
  'scrape:ra',
  'scrape:eventbrite',
  'scrape:fourvenues',
  'staff',
  'venue',
  'promoter',
] as const

export type Origin = (typeof ORIGIN_RANK)[number]

export function originRank(origin: string | null | undefined): number {
  const i = ORIGIN_RANK.indexOf((origin ?? '') as Origin)
  // An unknown origin is treated as the least authoritative thing there is,
  // so a typo in a scraper can never win a field from a promoter.
  return i === -1 ? -1 : i
}

/** The row as it exists, as far as merging is concerned. */
export interface ExistingEvent {
  origin?: string | null
  locked_fields?: string[] | null
  [column: string]: unknown
}

/** What a scrape wants to write. Keys are column names. */
export type ScrapedEvent = Record<string, unknown>

export interface MergeResult {
  /** Columns to write. Empty means the scrape had nothing new to say. */
  patch: Record<string, unknown>
  /** Columns the scrape wanted but was not allowed to set, and why. */
  skipped: { column: string; reason: 'locked' | 'origin' | 'unchanged' | 'empty' }[]
}

/** Columns a scraper may never set on an existing row, whatever its origin:
 *  they are ours, not the source's. */
const NEVER_FROM_SCRAPE = new Set([
  'id', 'ra_event_id', 'origin', 'locked_fields', 'created_at',
  'club_id', 'club_match',   // venue matching is our own resolution step
])

/** True for values a scrape should not overwrite a real value with. A scraper
 *  reporting null usually means "this page didn't say", not "it is empty". */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isEmpty(a) && isEmpty(b)) return true
  // Arrays and JSON columns (lineup, artists, promoters) compare structurally,
  // or every run would rewrite every row and bump updated_at forever.
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

/**
 * The columns a scrape of `origin` may write onto `existing`.
 *
 * `existing` being undefined means the row is new, in which case everything the
 * scrape supplies is kept — there is nothing to protect yet.
 */
export function mergeScrapedEvent(
  existing: ExistingEvent | undefined,
  incoming: ScrapedEvent,
  origin: Origin,
): MergeResult {
  const patch: Record<string, unknown> = {}
  const skipped: MergeResult['skipped'] = []

  if (!existing) {
    for (const [column, value] of Object.entries(incoming)) {
      if (isEmpty(value)) { skipped.push({ column, reason: 'empty' }); continue }
      patch[column] = value
    }
    return { patch, skipped }
  }

  const locked = new Set(existing.locked_fields ?? [])
  // A scrape may only write to a row at or below its own authority. Above it
  // (a promoter's night) it is a second opinion, not a correction — it may
  // still FILL BLANKS, but never replace an asserted value.
  const subordinate = originRank(existing.origin) > originRank(origin)

  for (const [column, value] of Object.entries(incoming)) {
    if (NEVER_FROM_SCRAPE.has(column)) {
      skipped.push({ column, reason: 'origin' })
      continue
    }
    if (locked.has(column)) {
      skipped.push({ column, reason: 'locked' })
      continue
    }
    if (isEmpty(value)) {
      skipped.push({ column, reason: 'empty' })
      continue
    }
    if (subordinate && !isEmpty(existing[column])) {
      skipped.push({ column, reason: 'origin' })
      continue
    }
    if (sameValue(existing[column], value)) {
      skipped.push({ column, reason: 'unchanged' })
      continue
    }
    patch[column] = value
  }

  return { patch, skipped }
}

/**
 * Record that a human set these columns, so no scrape overwrites them again.
 * Additive and order-stable: a second edit to the same field is not an error
 * and must not duplicate the entry.
 */
export function lockFields(
  existing: string[] | null | undefined,
  columns: string[],
): string[] {
  const out = new Set(existing ?? [])
  for (const c of columns) if (c.trim()) out.add(c.trim())
  return [...out].sort()
}

/** Release a human's claim on a column — "go back to following the source". */
export function unlockFields(
  existing: string[] | null | undefined,
  columns: string[],
): string[] {
  const drop = new Set(columns.map(c => c.trim()))
  return (existing ?? []).filter(c => !drop.has(c)).sort()
}
