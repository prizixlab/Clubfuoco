import { createServiceClient } from '@/lib/supabase/server'
import { getPartnerOffersByClub, type PartnerOffer } from '@/lib/partner'
import { offerLiveOn } from '@/lib/valid-days'
import { chunked } from '@/lib/utils'

// Live availability for the marketing home page: the hero's count of offers
// bookable tonight, and the phone mockup's list of every club bookable in the
// app over the next two weeks. Both come from the same two sources the app
// sells from, loaded once:
//   - the HypeList/Fourvenues feed agentbox publishes hourly
//     (fourvenues_push.py) — the same file the native app reads (FVCatalog);
//   - live partner_offers, via the app's own loader and liveness predicate.

const WINDOW_DAYS = 14

/** yyyy-MM-dd in Barcelona, `offset` days from today — same rule as the events feed. */
function madridDate(offset = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offset * 86_400_000))
}

// Only the feed fields we read.
interface FVSpace { off?: boolean; taken?: boolean }
interface FVProduct {
  settle:    'free' | 'door' | 'online' | 'table'
  sold_out?: boolean
  map?:      { spaces?: FVSpace[] } | null
}
interface FVEvent { night: string; club_id?: string | null; products: FVProduct[] }

/** Offers on one Fourvenues night: every list and ticket once, every bookable
 *  VIP table on its own. A table zone with no floor plan counts as one. */
function fvEventOffers(e: FVEvent): number {
  let n = 0
  for (const p of e.products ?? []) {
    if (p.sold_out) continue
    if (p.settle !== 'table') { n += 1; continue }
    const spaces = p.map?.spaces ?? []
    n += spaces.length ? spaces.filter(s => !s.off && !s.taken).length : 1
  }
  return n
}

async function fourvenuesEvents(): Promise<FVEvent[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fourvenues/offers.json`,
    // ~2 MB is over the data cache's limit, so this response itself isn't
    // cached — but `no-store` would make the whole page render per request.
    // A revalidate keeps it on the page's 5-minute ISR cycle.
    { next: { revalidate: 300 } },
  )
  if (!res.ok) throw new Error(`fourvenues feed ${res.status}`)
  return ((await res.json()) as { events?: FVEvent[] }).events ?? []
}

export type WayIn = 'guestlist' | 'tickets' | 'vip'
const WAY_ORDER: WayIn[] = ['guestlist', 'tickets', 'vip']

export interface BookableClub {
  id:    string
  name:  string
  cover: string | null
  /** First night in the window it can be booked, yyyy-MM-dd. */
  next:  string
  /** Ways in across the window. */
  ways:  WayIn[]
}

export interface LiveAvailability {
  /** Every offer bookable tonight. */
  tonight: number
  /** Every club bookable in the next two weeks, soonest first. */
  clubs:   BookableClub[]
}

/** Google Places proxies don't render off-app; same filter as the events feed. */
function usableCover(url: string | null): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) return null
  if (url.includes('/api/places/photo')) return null
  return url
}

// Null on any failure — the page falls back to its static copy rather than
// showing a wrong or empty figure.
export async function getLiveAvailability(): Promise<LiveAvailability | null> {
  try {
    const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => madridDate(i))
    const today = dates[0]
    const last  = dates[dates.length - 1]
    const sb = await createServiceClient()
    const [events, byClub] = await Promise.all([
      fourvenuesEvents(),
      getPartnerOffersByClub(sb),
    ])

    const found = new Map<string, { next: string; ways: Set<WayIn> }>()
    const mark = (clubId: string, date: string, way: WayIn) => {
      const c = found.get(clubId) ?? { next: date, ways: new Set<WayIn>() }
      if (date < c.next) c.next = date
      c.ways.add(way)
      found.set(clubId, c)
    }

    // HypeList nights. Tonight's count takes every offer on them; where a club
    // has one, the app's guestlist that night IS that night's list, so the
    // club's partner_offers aren't counted again for tonight.
    let tonight = 0
    const fvTonight = new Set<string>()
    for (const e of events) {
      if (e.night < today || e.night > last) continue
      const club = e.club_id?.toLowerCase()
      if (e.night === today) {
        tonight += fvEventOffers(e)
        if (club) fvTonight.add(club)
      }
      if (!club) continue
      for (const p of e.products ?? []) {
        if (p.sold_out) continue
        mark(club, e.night, p.settle === 'free' ? 'guestlist' : p.settle === 'table' ? 'vip' : 'tickets')
      }
    }

    for (const [rawId, list] of Object.entries(byClub)) {
      const club = rawId.toLowerCase()
      for (const date of dates) {
        const live = list.filter((o: PartnerOffer) => offerLiveOn(o, date))
        if (date === today && !fvTonight.has(club)) tonight += live.length
        for (const o of live) mark(club, date, o.kind === 'vip_table' ? 'vip' : 'guestlist')
      }
    }

    const meta = new Map<string, { name: string; cover: string | null }>()
    const pages = await Promise.all(chunked([...found.keys()]).map(ids => sb
      .from('clubs')
      .select('id, name, cover_image_url, is_active')
      .in('id', ids)))
    for (const { data } of pages) {
      for (const c of data ?? []) {
        if (c.is_active === false) continue
        meta.set((c.id as string).toLowerCase(), {
          name:  c.name as string,
          cover: usableCover(c.cover_image_url as string | null),
        })
      }
    }

    const clubs = [...found.entries()]
      .filter(([id]) => meta.has(id))
      .map(([id, c]) => ({
        id,
        ...meta.get(id)!,
        next: c.next,
        ways: WAY_ORDER.filter(w => c.ways.has(w)),
      }))
      .sort((a, b) => a.next.localeCompare(b.next) || a.name.localeCompare(b.name))

    return { tonight, clubs }
  } catch {
    return null
  }
}
