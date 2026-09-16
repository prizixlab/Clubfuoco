import type { createServiceClient } from '@/lib/supabase/server'
import { chunked } from '@/lib/utils'

type SB = Awaited<ReturnType<typeof createServiceClient>>

/**
 * Ticket releases — a paid night sells in waves.
 *
 * The release on sale is the lowest-position one that has neither passed its
 * cut-off nor sold out, so a wave ends on whichever comes first: its date or
 * its last ticket.
 *
 * ── Why this is computed here and not read off a column ──────────────────────
 * `promoter_nights.price_cents` is kept roughly in step by a trigger, but a
 * trigger only fires when a ROW changes — and the two ways a release actually
 * ends are a sale landing elsewhere and time simply passing. Neither touches
 * night_releases, so the column goes stale exactly when it matters, and the
 * card would advertise €10 while the till charges €15.
 *
 * Every price a guest is SHOWN, and the price they are CHARGED, therefore comes
 * from here. The column stays as the flat price for nights with no releases,
 * and as the fallback if this read fails.
 */
export interface Release {
  id: string
  position: number
  name: string | null
  price_cents: number
  /** ISO timestamp, or null when it runs until the night itself. */
  ends_at: string | null
  /** Tickets this wave may sell, in heads. Null = no limit. */
  quantity: number | null
  /** Heads already taken: paid spots plus holds that are still alive. */
  sold: number
  /** True for the wave currently on sale. Exactly one, or none. */
  active: boolean
  /** Why it is not on sale — for the ladder a guest sees. */
  state: 'live' | 'upcoming' | 'sold_out' | 'ended'
}

interface Row {
  id: string; position: number; name: string | null; price_cents: number
  ends_at: string | null; quantity: number | null; night_id: string
}

/**
 * Every release on a night, in sale order, each with its live sold count and
 * state. Empty for a flat-priced night.
 *
 * Sold counts come from one grouped read of promoter_guests rather than a
 * per-release query, and count HEADS — a guest plus their plus-ones — because
 * that is how capacity is counted everywhere else.
 */
export async function ladder(sb: SB, nightId: string): Promise<Release[]> {
  const { data, error } = await sb
    .from('night_releases')
    .select('id, position, name, price_cents, ends_at, quantity, night_id')
    .eq('night_id', nightId)
    .order('position', { ascending: true })

  // A missing table (migration not applied) or a failed read is not an error
  // here — it means "this night has no releases", and the flat price stands.
  if (error || !data || data.length === 0) return []

  const rows = data as unknown as Row[]
  const sold = await soldByRelease(sb, rows.map(r => r.id))

  const now = Date.now()
  let liveFound = false
  return rows.map(r => {
    const taken = sold.get(r.id) ?? 0
    const ended = r.ends_at != null && new Date(r.ends_at).getTime() <= now
    const soldOut = r.quantity != null && taken >= r.quantity
    // The first release that is neither ended nor sold out is the one on sale;
    // everything before it is spent, everything after is still to come.
    const isLive = !ended && !soldOut && !liveFound
    if (isLive) liveFound = true
    return {
      id: r.id, position: r.position, name: r.name,
      price_cents: r.price_cents, ends_at: r.ends_at, quantity: r.quantity,
      sold: taken,
      active: isLive,
      state: isLive ? 'live' : soldOut ? 'sold_out' : ended ? 'ended' : 'upcoming',
    }
  })
}

/**
 * Ladders for many nights in a handful of queries, not two per night. The
 * events feed carries every upcoming night — hundreds of them — and calling
 * `ladder` per row would be an N+1 on the hot path that renders the app's
 * home screen.
 */
export async function laddersFor(sb: SB, nightIds: string[]): Promise<Map<string, Release[]>> {
  const out = new Map<string, Release[]>()
  if (nightIds.length === 0) return out

  // Chunked because the feed now carries EVERY upcoming night, not the soonest
  // 100 — `.in()` spells each id out in the URL, and a few hundred UUIDs there
  // is a 414 that would read as "this night has no releases" and quietly sell
  // at the stale flat price.
  // In parallel, not in sequence. The chunks are independent, and this runs on
  // the request that renders the app's home screen — four serial round trips
  // to Postgres is four times the latency for no reason.
  const pages = await Promise.all(chunked(nightIds).map(ids => sb
    .from('night_releases')
    .select('id, position, name, price_cents, ends_at, quantity, night_id')
    .in('night_id', ids)
    .order('position', { ascending: true })))

  const rows: Row[] = []
  for (const { data, error } of pages) {
    // A failed read is not an error here — it means "no releases", and the
    // flat price stands. Bailing out would price every night on a hiccup.
    if (error) return out
    if (data) rows.push(...(data as unknown as Row[]))
  }
  if (rows.length === 0) return out
  const sold = await soldByRelease(sb, rows.map(r => r.id))
  const now = Date.now()

  for (const nightId of new Set(rows.map(r => r.night_id))) {
    let liveFound = false
    out.set(nightId, rows.filter(r => r.night_id === nightId).map(r => {
      const taken = sold.get(r.id) ?? 0
      const ended = r.ends_at != null && new Date(r.ends_at).getTime() <= now
      const soldOut = r.quantity != null && taken >= r.quantity
      const isLive = !ended && !soldOut && !liveFound
      if (isLive) liveFound = true
      return {
        id: r.id, position: r.position, name: r.name,
        price_cents: r.price_cents, ends_at: r.ends_at, quantity: r.quantity,
        sold: taken, active: isLive,
        state: (isLive ? 'live' : soldOut ? 'sold_out' : ended ? 'ended' : 'upcoming') as Release['state'],
      }
    }))
  }
  return out
}

/** The wave on sale, or null for a flat-priced night (or one fully spent). */
export async function activeRelease(sb: SB, nightId: string): Promise<Release | null> {
  return (await ladder(sb, nightId)).find(r => r.active) ?? null
}

/**
 * What one more head costs on this night right now: the live release's price,
 * falling back to the night's flat price when there are no releases.
 */
export function livePrice(releases: Release[], flatPriceCents: number): number {
  return releases.find(r => r.active)?.price_cents ?? flatPriceCents
}

/**
 * Heads sold per release. A spot counts once it is paid, or while its Stripe
 * hold is still alive — an abandoned checkout page must not keep a release
 * sold out, which is the rule the night's own capacity check already uses.
 */
async function soldByRelease(sb: SB, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out

  const now = Date.now()
  // Same reason as the ladder read: one id per release per night, unbounded
  // once the feed stopped capping at 100. A truncated read here undercounts
  // what a wave has sold, which is how a sold-out release goes back on sale.
  const pages = await Promise.all(chunked(ids).map(batch => sb
    .from('promoter_guests')
    .select('release_id, plus_ones, payment_status, hold_expires_at')
    .in('release_id', batch)))

  for (const { data } of pages) {
    for (const g of (data ?? []) as {
      release_id: string | null; plus_ones: number | null
      payment_status: string | null; hold_expires_at: string | null
    }[]) {
      if (!g.release_id) continue
      const holdLive = g.payment_status !== 'pending'
        || (g.hold_expires_at ? new Date(g.hold_expires_at).getTime() > now : false)
      if (!holdLive) continue
      out.set(g.release_id, (out.get(g.release_id) ?? 0) + 1 + (g.plus_ones ?? 0))
    }
  }
  return out
}
