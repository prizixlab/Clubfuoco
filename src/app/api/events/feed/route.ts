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

/** One leg of a night that moves — "22:00 Bastión Beach Club, then 00:00 Opium".
 *  `club_id` is set when the stop is one of our venues, which is what lets the
 *  card link through to that club's page; free-text stops just render. */
export interface EventStop {
  club_id: string | null
  name: string
  /** Bare clocks, "HH:MM", same convention as open_time. An `end` earlier than
   *  its `start` is the next morning. */
  start: string | null
  end: string | null
  note: string | null
}

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
  /** Who RUNS the night — partner_brands id where we have one, else free text.
   *  Distinct from `lineup`, which is who plays it. */
  hosts: { id: string | null; name: string }[]
  /** An ordered route across venues, when the night moves. Empty for the
   *  ordinary single-venue case, which is most of them. */
  stops: EventStop[]
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

/// Normalise a jsonb [{id, name}] column. Shared by `lineup` and `hosts`
/// because they carry the same shape — and defensive because a row written
/// before the array constraint existed could still hold something else, which
/// would break decoding on the client rather than just rendering nothing.
function credits(raw: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(raw)) return []
  return (raw as { id?: string; name?: string }[])
    .filter(c => c && typeof c.name === 'string' && c.name.trim() !== '')
    .map(c => ({ id: c.id ?? null, name: c.name as string }))
}

/// Normalise the `stops` jsonb into a route. A stop with no name is dropped
/// rather than rendered blank, and a route that ends up with fewer than two
/// legs collapses to none — a one-stop "route" is just an ordinary night, and
/// the timeline on the client would be a single pointless dot.
function route(raw: unknown): EventStop[] {
  if (!Array.isArray(raw)) return []
  const clean = (raw as Record<string, unknown>[])
    .filter(s => s && typeof s.name === 'string' && s.name.trim() !== '')
    .map(s => ({
      club_id: typeof s.club_id === 'string' ? s.club_id : null,
      name: (s.name as string).trim(),
      start: clock(s.start),
      end: clock(s.end),
      note: typeof s.note === 'string' && s.note.trim() !== '' ? s.note.trim() : null,
    }))
  return clean.length >= 2 ? clean : []
}

/// "23:30:00" and "23:30" both arrive here — the column stores bare clocks but
/// the portal's <input type="time"> submits the short form. Trimmed rather than
/// parsed: there is no date, so there is no instant to convert.
function clock(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : null
}

export async function GET() {
  const sb = await createServiceClient()

  const { data: rows, error } = await sb
    .from('v_events_feed')
    .select(
      'id, title, night_date, open_time, close_time, description, club_id, ' +
      'location_name, address, lat, lng, photo_urls, total_capacity, ' +
      'price_cents, currency, is_pinned, featured, is_house, lineup, hosts, stops',
    )
    .limit(100)

  if (error) return err(error.message, 500)

  const list = (rows ?? []) as unknown as Record<string, unknown>[]

  // Clubs are fetched in ONE batched query rather than embedded. PostgREST
  // embedding needs a foreign key to follow and a view carries none, so
  // `club:clubs(name)` on v_events_feed does not resolve. Batching also keeps
  // this off the N+1 path a per-row lookup would create.
  // Stop venues go into the SAME batch as the event venues. A route's legs are
  // clubs too, and their names deserve the same canonical treatment — the
  // free-text name written on a stop is whatever the operator typed.
  const routes = new Map<string, EventStop[]>()
  for (const r of list) routes.set(r.id as string, route(r.stops))

  const clubIds = [...new Set([
    ...list.map(r => r.club_id),
    ...[...routes.values()].flat().map(s => s.club_id),
  ].filter((v): v is string => typeof v === 'string'))]

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
    // Prefer the club's canonical name over what was typed on the stop, for
    // the same reason venue_name does below.
    const stops = (routes.get(r.id as string) ?? []).map(s => ({
      ...s,
      name: (s.club_id ? clubs.get(s.club_id)?.name : null) ?? s.name,
    }))
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
      lineup: credits(r.lineup),
      hosts: credits(r.hosts),
      stops,
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
