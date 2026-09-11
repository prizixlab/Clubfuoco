import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'

// GET /api/featured — the editorial featured shelf, as chosen in /portal/featured.
//
//   tier1  candidates for the big hero card, best first
//   tier2  the line of smaller cards under it, in order
//
// This answers with REFERENCES, not copies. The client already holds every
// venue (the nearby-clubs feed) and every event (/api/events/feed), and a
// featured card must look exactly like the same thing unfeatured — returning
// the objects again would mean two decoders, two shapes, and drift between
// them the first time a card gains a field.
//
// The bridge for venues is that `clubs.id` lowercased IS the native
// `Place.placeId` (see NearbyClubRow.toPlace), so a ref resolves locally with
// no extra round trip.
//
// Public and unauthenticated, like /api/events/feed: guests browse before
// signing in. Read with the service client because featured_slots has RLS on
// with no public policy.

export interface FeaturedRef {
  kind: 'event' | 'venue'
  /** A promoter_nights id, or a club id lowercased to match Place.placeId. */
  id: string
}

/** Today in Barcelona — the venues are here, so a night still running at 01:00
 *  local is today's, not yesterday's. Same rule as the events feed. */
function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function GET() {
  const sb = await createServiceClient()

  const { data, error } = await sb
    .from('featured_slots')
    .select('tier, rank, night_id, club_id, ra_event_id, created_at')
    .order('tier', { ascending: true })
    .order('rank', { ascending: true })
    .order('created_at', { ascending: true })

  // Nothing featured, a missing table, or a broken read all mean the same
  // thing to the client: fall back to the automatic shelf. This route must
  // never be the reason the feed fails to render.
  if (error || !data) return ok({ tier1: [], tier2: [] })

  const rows = data as {
    tier: number; night_id: string | null; club_id: string | null; ra_event_id: string | null
  }[]

  // A featured night still has to pass the guest gate. Featuring something
  // does not publish it, and a night that has passed or been unpublished must
  // drop out of the shelf on its own rather than needing to be un-featured by
  // hand every morning.
  const nightIds = rows.map(r => r.night_id).filter((v): v is string => !!v)
  const showable = new Set<string>()
  if (nightIds.length > 0) {
    const today = todayMadrid()
    const { data: nights } = await sb
      .from('promoter_nights')
      .select('id, is_published, review_status, visibility, night_date')
      .in('id', nightIds)
    for (const n of nights ?? []) {
      if (n.is_published && n.review_status === 'approved'
          && n.visibility === 'public' && (n.night_date as string) >= today) {
        showable.add(n.id as string)
      }
    }
  }

  const refs = (tier: number): FeaturedRef[] =>
    rows
      .filter(r => r.tier === tier)
      .map(r => {
        if (r.night_id) {
          return showable.has(r.night_id)
            ? { kind: 'event' as const, id: r.night_id }
            : null
        }
        if (r.club_id) return { kind: 'venue' as const, id: r.club_id.toLowerCase() }
        // A featured scraped listing is served through /api/events/feed under
        // this same `ra:` id, so the client resolves it like any other event.
        if (r.ra_event_id) return { kind: 'event' as const, id: `ra:${r.ra_event_id}` }
        return null
      })
      .filter((v): v is FeaturedRef => v !== null)

  return ok({ tier1: refs(1), tier2: refs(2) })
}
