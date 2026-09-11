import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// Portal events desk. Two jobs the schema now supports and nothing else drives:
//
//   1. Pin an event — OUR editorial choice of what heads the consumer Events
//      tab, deliberately distinct from `featured`, which is promotion a
//      promoter pays for.
//   2. Publish a house event — one we run ourselves, stored as an ordinary
//      promoter_nights row with `is_house` so it inherits capacity, guest
//      lists, QR passes, the door pack and saved-events for free.
//
// Every read here is the OPERATOR's view, not the guest's: it deliberately
// includes unapproved, unpublished, private and past rows, because deciding
// what to pin means seeing what exists. The guest-facing gate lives in
// `v_events_feed` and is applied by /api/events, not here.

export interface PortalEvent {
  /** `promoter_nights.id` for ours; `ra:<ra_event_id>` for a scraped row, so
   *  the two id spaces can never collide and a write aimed at a scraped id
   *  misses promoter_nights instead of hitting the wrong night. */
  id: string
  /** Where the row came from. Scraped rows are READ-ONLY here: they have no
   *  pin, review or publish columns behind them. */
  source: 'ours' | 'scraped'
  /** Scraped only — the Resident Advisor listing, so a row can be opened. */
  ra_url: string | null
  /** Scraped only — RA's own flyer. */
  image: string | null
  /** Scraped only — RA's interest counter, the one signal of size we get. */
  attending: number | null
  /** Scraped only — how confidently the scrape matched one of our clubs. */
  club_match: string | null
  /** Scraped only — free-text door price as RA prints it. */
  cost_label: string | null
  title: string | null
  night_date: string
  club_id: string | null
  club_name: string | null
  location_name: string | null
  is_published: boolean
  visibility: string
  review_status: string
  featured: boolean
  is_house: boolean
  pinned_at: string | null
  pin_rank: number | null
  pin_note: string | null
  total_capacity: number
  price_cents: number
  photo_urls: string[]
  lineup: { id: string | null; name: string }[]
  hosts: { id: string | null; name: string }[]
  /** An ordered route across venues. Empty = an ordinary single-venue night. */
  stops: EventStop[]
  /** Guest-visible right now — the same predicate v_events_feed applies. */
  live: boolean
}

/** Today in Barcelona. The venues are here, so "past" is decided in their day,
 *  not in the server's UTC one — otherwise an event still running at 01:00
 *  local reads as yesterday. */
function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** One leg of a night that moves. See supabase/migrations/20260908_event_stops.sql. */
export interface EventStop {
  club_id: string | null
  name: string
  start: string | null
  end: string | null
  note: string | null
}

/// "23:30:00" or "23:30" → "23:30". <input type="time"> submits the short form,
/// the column stores the long one. Trimmed, not parsed: a bare clock has no
/// date, so there is no instant to convert.
function clock(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : null
}

/// Normalise the route. Nameless stops are dropped, and anything shorter than
/// two legs collapses to none — matching the DB constraint, so a bad payload is
/// refused legibly here instead of arriving as a check violation.
function route(raw: unknown): EventStop[] {
  if (!Array.isArray(raw)) return []
  const clean = (raw as Record<string, unknown>[])
    .filter(s => s && typeof s.name === 'string' && s.name.trim() !== '')
    .map(s => ({
      club_id: typeof s.club_id === 'string' && s.club_id ? s.club_id : null,
      name: (s.name as string).trim().slice(0, 120),
      start: clock(s.start),
      end: clock(s.end),
      note: typeof s.note === 'string' && s.note.trim() !== '' ? s.note.trim().slice(0, 140) : null,
    }))
    .slice(0, 6)
  return clean.length >= 2 ? clean : []
}

/// Normalise a jsonb [{id, name}] column — used by both `lineup` and `hosts`.
function credits(raw: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(raw)) return []
  return (raw as { id?: string; name?: string }[])
    .filter(c => c && typeof c.name === 'string' && c.name.trim() !== '')
    .map(c => ({ id: c.id ?? null, name: c.name as string }))
}

function clubName(row: unknown): string | null {
  const c = (row as { club?: { name?: string } | { name?: string }[] }).club
  const name = Array.isArray(c) ? c[0]?.name : c?.name
  return name ?? null
}

const SELECT =
  'id, title, night_date, club_id, location_name, is_published, visibility, ' +
  'review_status, featured, is_house, pinned_at, pin_rank, pin_note, ' +
  'total_capacity, price_cents, photo_urls, lineup, hosts, stops, club:clubs(name)'

// GET /api/portal/events?scope=upcoming|past
export async function GET(req: Request) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const scope = new URL(req.url).searchParams.get('scope') === 'past' ? 'past' : 'upcoming'
  const today = todayMadrid()

  let q = sb.from('promoter_nights').select(SELECT)
  q = scope === 'past'
    ? q.lt('night_date', today).order('night_date', { ascending: false }).limit(60)
    : q.gte('night_date', today).order('night_date', { ascending: true }).limit(200)

  const { data, error } = await q
  if (error) return err(error.message, 500)

  const rows: PortalEvent[] = (data ?? []).map(r => {
    const row = r as unknown as Record<string, unknown>
    return {
      id: row.id as string,
      source: 'ours' as const,
      ra_url: null,
      image: null,
      attending: null,
      club_match: null,
      cost_label: null,
      title: (row.title as string) ?? null,
      night_date: row.night_date as string,
      club_id: (row.club_id as string) ?? null,
      club_name: clubName(r),
      location_name: (row.location_name as string) ?? null,
      is_published: row.is_published as boolean,
      visibility: row.visibility as string,
      review_status: row.review_status as string,
      featured: row.featured as boolean,
      is_house: row.is_house as boolean,
      pinned_at: (row.pinned_at as string) ?? null,
      pin_rank: (row.pin_rank as number) ?? null,
      pin_note: (row.pin_note as string) ?? null,
      total_capacity: row.total_capacity as number,
      price_cents: row.price_cents as number,
      photo_urls: (row.photo_urls as string[]) ?? [],
      lineup: credits(row.lineup),
      hosts: credits(row.hosts),
      stops: route(row.stops),
      live:
        (row.is_published as boolean) &&
        row.review_status === 'approved' &&
        row.visibility === 'public' &&
        (row.night_date as string) >= today,
    }
  })

  // ── Scraped listings ──────────────────────────────────────────────────────
  // `public.events` is the RA scrape: ~1,400 rows, a few hundred of them still
  // upcoming, none of which the promoter_nights query above can see. They are
  // the bulk of what is actually happening in the city, so the desk shows them
  // beside our own — read-only, because there is no pin, review or publish
  // column behind a scraped row.
  //
  // A failure here degrades to "just our nights" rather than taking the page
  // down: the scrape is a feed we don't control, and the desk still has a job
  // without it.
  const scraped = await listScraped(sb, scope, today)

  const events = [...rows, ...scraped].sort((a, b) =>
    scope === 'past'
      ? b.night_date.localeCompare(a.night_date)
      : a.night_date.localeCompare(b.night_date))

  return ok({ today, scope, events })
}

/** RA rows carry a free-text capacity ("150", "", null). Anything unparseable
 *  is 0, which the desk renders as "no capacity" rather than a wrong number. */
function capacity(raw: unknown): number {
  const n = Number(String(raw ?? '').replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** RA's door price is free text and often junk — a bare "€" with no number is
 *  common. Anything without a digit is dropped rather than rendered as a price
 *  that says nothing; "Free" is the one wordy value worth keeping. */
function cost(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === '') return null
  if (/free/i.test(s)) return 'Free'
  return /\d/.test(s) ? s : null
}

/** The scrape's own `lineup` jsonb where it has one, else the flat `artists`
 *  string array, so a row that predates the lineup column still shows a bill. */
function scrapedLineup(row: Record<string, unknown>): { id: string | null; name: string }[] {
  const lineup = credits(row.lineup)
  if (lineup.length > 0) return lineup
  const artists = Array.isArray(row.artists) ? (row.artists as unknown[]) : []
  return artists
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .map(name => ({ id: null, name }))
}

async function listScraped(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  scope: 'upcoming' | 'past',
  today: string,
): Promise<PortalEvent[]> {
  let q = sb.from('events').select(
    'ra_event_id, title, date, start_time, end_time, venue_name, club_id, club_match, ' +
    'promoters, artists, lineup, attending, cost, ra_url, image, description, venue_capacity',
  )
  q = scope === 'past'
    ? q.lt('date', today).order('date', { ascending: false }).limit(120)
    // Every upcoming one. "All the events" is the point of the page, and the
    // scrape holds a few hundred — a 200-row cap would silently hide the tail.
    : q.gte('date', today).order('date', { ascending: true }).limit(1000)

  const { data, error } = await q
  if (error) return []

  const list = (data ?? []) as unknown as Record<string, unknown>[]

  // Club names in one batched query. `events.club_id` carries no foreign key to
  // clubs, so PostgREST cannot embed `club:clubs(name)` here the way the
  // promoter_nights select does.
  const clubIds = [...new Set(list.map(r => r.club_id).filter((v): v is string => typeof v === 'string'))]
  const names = new Map<string, string>()
  if (clubIds.length > 0) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of clubs ?? []) names.set(c.id as string, c.name as string)
  }

  return list.map(row => {
    const clubId = typeof row.club_id === 'string' ? row.club_id : null
    const image = typeof row.image === 'string' && row.image ? row.image : null
    const promoters = Array.isArray(row.promoters) ? (row.promoters as unknown[]) : []
    return {
      id: `ra:${row.ra_event_id as string}`,
      source: 'scraped' as const,
      ra_url: (row.ra_url as string) ?? null,
      image,
      attending: typeof row.attending === 'number' ? row.attending : null,
      club_match: (row.club_match as string) ?? null,
      cost_label: cost(row.cost),
      title: (row.title as string) ?? null,
      night_date: row.date as string,
      club_id: clubId,
      // The matched club's canonical name wins over RA's spelling of it.
      club_name: clubId ? names.get(clubId) ?? null : null,
      location_name: (row.venue_name as string) ?? null,
      // A scraped listing is public by definition and has nothing to review or
      // publish — these read as "already out there", which is what it is.
      is_published: true,
      visibility: 'public',
      review_status: 'approved',
      featured: false,
      is_house: false,
      pinned_at: null,
      pin_rank: null,
      pin_note: null,
      total_capacity: capacity(row.venue_capacity),
      price_cents: 0,
      photo_urls: image ? [image] : [],
      lineup: scrapedLineup(row),
      // RA's promoters are who runs the night — the same role as `hosts`, but
      // free text: these names are not partner_brands, so they carry no id.
      hosts: promoters
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .map(name => ({ id: null, name })),
      stops: [],
      live: (row.date as string) >= today,
    }
  })
}

// POST /api/portal/events — publish a house event.
//
// House rows go in APPROVED and PUBLISHED: review exists to check promoters'
// submissions, and we are not reviewing ourselves. They are also forced free —
// a house event has no Stripe Connect account behind it, so a price would fail
// at the guest's checkout. The DB constraint enforces that too; this is the
// early, legible half of the same rule.
export async function POST(req: Request) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err('Invalid JSON', 400) }

  const title = String(body.title ?? '').trim()
  const nightDate = String(body.night_date ?? '').trim()

  if (!title) return err('A title is required', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightDate)) return err('night_date must be YYYY-MM-DD', 400)
  if (nightDate < todayMadrid()) return err('That date is already past', 400)

  const capacity = Number(body.total_capacity ?? 100)
  if (!Number.isInteger(capacity) || capacity < 1) return err('Capacity must be a positive whole number', 400)

  // A route: 22:00 at the beach club, then 00:00 to 05:00 at the club proper.
  // Empty for the ordinary single-venue night, which is most of them.
  const stops = route(body.stops)
  if (Array.isArray(body.stops) && (body.stops as unknown[]).length > 0 && stops.length === 0) {
    return err('A route needs at least two stops, each with a name', 400)
  }

  // A house event is placed EITHER at one of our venues or at a free-text
  // address. Requiring one of the two stops an event that nobody can find.
  //
  // On a route these three are DERIVED, never taken from the form: the night
  // belongs to where it starts. bookings.club_id is singular and NOT NULL, and
  // the pass, the Wallet styling, the arrival geofence and the survey all hang
  // off it — pointing it at the first stop, where the guest actually turns up
  // and gets scanned, is what lets the whole reservation path stay untouched.
  // The span (first start → last end) then reads as the true length of the
  // night everywhere open_time/close_time are already shown.
  const first = stops[0]
  const last = stops[stops.length - 1]

  const clubId = stops.length > 0
    ? first.club_id
    : (body.club_id ? String(body.club_id) : null)
  const locationName = stops.length > 0
    ? (first.club_id ? null : first.name)
    : (String(body.location_name ?? '').trim() || null)

  if (!clubId && !locationName) return err('Pick a venue, or give the location a name', 400)

  const openTime = stops.length > 0 ? first.start : (body.open_time ? String(body.open_time) : null)
  const closeTime = stops.length > 0 ? last.end : (body.close_time ? String(body.close_time) : null)

  const photos = Array.isArray(body.photo_urls)
    ? (body.photo_urls as unknown[]).map(String).filter(Boolean)
    : []

  // Billed DJs in order. Stored as [{id, name}] where id is an RA artist id,
  // matching public.events.lineup so the client's existing credit type works
  // unchanged. A name is required; the id may be null for someone not in the
  // catalogue, which still renders — it just cannot link to a DJ page.
  const lineup = credits(body.lineup).slice(0, 20)
  // Who runs the night. Defaults to the house brand when nothing is given on a
  // house event, so "Hosted by" is never blank on an event that is ours.
  const hosts = credits(body.hosts).slice(0, 10)

  const { data, error } = await sb
    .from('promoter_nights')
    .insert({
      title,
      night_date: nightDate,
      club_id: clubId,
      location_name: locationName,
      address: String(body.address ?? '').trim() || null,
      description: String(body.description ?? '').trim() || null,
      open_time: openTime,
      close_time: closeTime,
      stops,
      total_capacity: capacity,
      max_plus_ones: body.max_plus_ones == null ? null : Number(body.max_plus_ones),
      photo_urls: photos,
      lineup,
      hosts: hosts.length > 0 ? hosts : [{ id: null, name: 'Club Fuoco' }],
      is_house: true,
      // Ours, so it skips the promoter review queue.
      review_status: 'approved',
      is_published: true,
      visibility: 'public',
      // Never priced — see the note above and the house-free check constraint.
      price_cents: 0,
      currency: 'eur',
      // No promoter account created this. `created_by` defaults to auth.uid(),
      // which is null for the service client; set explicitly so the intent is
      // recorded rather than inferred from an absent value.
      created_by: null,
      // `featured` is the PAID flag and is never set from here — a house event
      // cannot buy promotion from itself. Pin it instead.
      featured: false,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 500)
  return ok({ id: data.id })
}
