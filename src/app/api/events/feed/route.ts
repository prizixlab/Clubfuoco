import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/events/feed — the consumer Events tab.
//
// Note the path. `/api/events` is already taken by something unrelated: a
// venue-scoped aggregator that queries RA, Eventbrite, Dice, Xceed and
// Songkick live for one club's ticket listings. This route is the opposite —
// OUR events (promoter nights and house nights) across the whole city, out of
// our own database. They must not share a path.
//
// Public, like /api/partner: guests browse before signing in, so this answers
// without a session. Read with the service client because the guest gate lives
// in the `v_events_feed` view rather than in an RLS policy — opening a
// permissive SELECT on promoter_nights would expose private and unapproved
// nights to every anon key holder.
//
// The view owns BOTH the gate (published, approved, public, not past) and the
// order (our editorial pin, then a promoter's paid feature, then soonest), so
// this route restates neither. If the ordering is ever wrong, it is wrong in
// one place.

export interface FeedEvent {
  id: string
  title: string | null
  night_date: string
  open_time: string | null
  close_time: string | null
  description: string | null
  /** Venue name: the club's if it is one of ours, else the free-text location. */
  venue_name: string | null
  club_id: string | null
  address: string | null
  lat: number | null
  lng: number | null
  /** Event flyer if the row has one, else the venue's cover photo. */
  image: string | null
  photo_urls: string[]
  /** Billed DJs in order: RA artist id + name. Same shape as events.lineup. */
  lineup: { id: string | null; name: string }[]
  total_capacity: number
  price_cents: number
  currency: string
  is_pinned: boolean
  featured: boolean
  is_house: boolean
}

/// A club cover we can actually render.
///
/// Most `clubs.cover_image_url` values are Google Places photo references
/// behind our proxy, and those do NOT render in the app — the venue feed drops
/// them for exactly this reason (see the photo filter in getNearbyClubs and its
/// native mirror `NearbyClubRow.toPlace`). Falling back to one here would put a
/// broken image on an event card, which is worse than the placeholder.
function usableCover(url: string | null): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) return null
  if (url.includes('/api/places/photo')) return null
  return url
}

export async function GET() {
  const sb = await createServiceClient()

  const { data: rows, error } = await sb
    .from('v_events_feed')
    .select(
      'id, title, night_date, open_time, close_time, description, club_id, ' +
      'location_name, address, lat, lng, photo_urls, total_capacity, ' +
      'price_cents, currency, is_pinned, featured, is_house, lineup',
    )
    .limit(100)

  if (error) return err(error.message, 500)

  const list = (rows ?? []) as unknown as Record<string, unknown>[]

  // Clubs are fetched in ONE batched query rather than embedded. PostgREST
  // embedding needs a foreign key to follow and a view carries none, so
  // `club:clubs(name)` on v_events_feed does not resolve. Batching also keeps
  // this off the N+1 path a per-row lookup would create.
  const clubIds = [...new Set(list.map(r => r.club_id).filter((v): v is string => typeof v === 'string'))]

  const clubs = new Map<string, { name: string; cover: string | null }>()
  if (clubIds.length > 0) {
    const { data: clubRows } = await sb
      .from('clubs')
      .select('id, name, cover_image_url')
      .in('id', clubIds)
    for (const c of clubRows ?? []) {
      clubs.set(c.id as string, {
        name: c.name as string,
        cover: usableCover(c.cover_image_url as string | null),
      })
    }
  }

  const events: FeedEvent[] = list.map(r => {
    const club = typeof r.club_id === 'string' ? clubs.get(r.club_id) : undefined
    const photos = (r.photo_urls as string[]) ?? []
    return {
      id: r.id as string,
      title: (r.title as string) ?? null,
      night_date: r.night_date as string,
      open_time: (r.open_time as string) ?? null,
      close_time: (r.close_time as string) ?? null,
      description: (r.description as string) ?? null,
      // The club's real name wins over the promoter's free-text location: the
      // same venue is written a dozen ways across rows, and only the club row
      // is canonical.
      venue_name: club?.name ?? (r.location_name as string) ?? null,
      club_id: (r.club_id as string) ?? null,
      address: (r.address as string) ?? null,
      lat: (r.lat as number) ?? null,
      lng: (r.lng as number) ?? null,
      // The event's own flyer is the truthful image; the venue cover is a
      // fallback so a card is never blank.
      image: photos[0] ?? club?.cover ?? null,
      photo_urls: photos,
      // Defensive: the column is constrained to an array, but a row written
      // before the constraint existed could still hold something else, and a
      // non-array here would break decoding on the client.
      lineup: Array.isArray(r.lineup)
        ? (r.lineup as { id?: string; name?: string }[])
            .filter(c => c && typeof c.name === 'string' && c.name.trim() !== '')
            .map(c => ({ id: c.id ?? null, name: c.name as string }))
        : [],
      total_capacity: r.total_capacity as number,
      price_cents: r.price_cents as number,
      currency: r.currency as string,
      is_pinned: r.is_pinned as boolean,
      featured: r.featured as boolean,
      is_house: r.is_house as boolean,
    }
  })

  // Uncached, matching /api/partner: a pin taken down has to disappear on the
  // next load, not when a CDN entry lapses. Clients cache locally instead.
  return ok({ events })
}
