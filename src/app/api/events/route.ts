import { NextRequest, NextResponse } from 'next/server'
import { TICKET_MARKUP, type ExternalEvent } from '@/lib/tickets'

export type { ExternalEvent }

function markUp(cents: number) {
  return Math.ceil(cents * (1 + TICKET_MARKUP))
}

// Strip accents: Razzmatazz / Räzz, Gràcia / Gracia, etc.
function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normName(s: string) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words that appear in almost every Barcelona venue name — skip for matching
const VENUE_STOPWORDS = new Set([
  'barcelona', 'club', 'bar', 'the', 'lounge', 'hotel', 'cafe', 'cafes',
  'music', 'night', 'live', 'room', 'space', 'house', 'disco', 'dance',
  'party', 'venue', 'stage', 'place', 'sala', 'local', 'bcn', 'spain',
  'restaurante', 'restaurant', 'cocktail', 'cocteleria', 'terraza',
])

function venueMatch(a: string, b: string): boolean {
  const na = normName(a)
  const nb = normName(b)

  // Exact normalised match
  if (na === nb) return true

  // One contains the other (e.g. "Opium" matches "Opium Barcelona Restaurant")
  if (na.includes(nb) || nb.includes(na)) return true

  // Meaningful word overlap (length > 2, not a stopword)
  const meaningful = (s: string) =>
    s.split(' ').filter(w => w.length > 2 && !VENUE_STOPWORDS.has(w))
  const wordsA = meaningful(na)
  const wordsB = new Set(meaningful(nb))

  // Need at least one meaningful word match, and source must have ≥1 meaningful word
  return wordsA.length > 0 && wordsA.some(w => wordsB.has(w))
}

// Typical Barcelona club entry prices by day (in cents)
function estimateEntryPrice(title: string, date: string): number {
  const d   = new Date(date)
  const dow = d.getDay() // 0=Sun, 5=Fri, 6=Sat
  const t   = title.toLowerCase()
  if (t.includes('free') || t.includes('guest list') || t.includes('gratis')) return 0

  // Tier by event type — big headliners cost more
  const isPremium = t.includes('festival') || t.includes('closing') || t.includes('opening night')
    || t.includes('special') || t.includes('presenta') || t.includes('showcase')
  const isResidency = t.includes('residency') || t.includes('every') || t.includes('weekly')

  let base: number
  if (dow === 5 || dow === 6) {
    base = isPremium ? 2500 : isResidency ? 1200 : 1800  // Fri/Sat: €25 / €12 / €18
  } else if (dow === 0) {
    base = isPremium ? 2000 : 1500                        // Sun: €20 / €15
  } else {
    base = isPremium ? 1800 : 1000                        // Weekday: €18 / €10
  }
  return base
}

// ── Resident Advisor ─────────────────────────────────────────────────────────
// Returns all upcoming Barcelona events; marks which ones match the target venue
async function fetchRA(venueName: string): Promise<ExternalEvent[]> {
  try {
    // Use Barcelona local date (Europe/Madrid) so we never show yesterday's events
    const todayBCN = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }) // YYYY-MM-DD
    const query = `{
      eventListings(
        filters: { areas: { eq: 20 }, listingDate: { gte: "${todayBCN}" } }
        pageSize: 60
        page: 1
      ) {
        data {
          id
          event {
            id
            title
            date
            startTime
            venue { name address }
            images { filename }
            tickets { id }
          }
        }
      }
    }`

    const res  = await fetch('https://ra.co/graphql', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://ra.co/', 'User-Agent': 'Mozilla/5.0' },
      body:    JSON.stringify({ query }),
      cache:   'no-store',
    })
    if (!res.ok) return []
    const json     = await res.json()
    const listings = json?.data?.eventListings?.data ?? []

    // Hard filter: drop any event whose date is before today in Barcelona
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
    const future   = listings.filter((l: any) => (l.event?.date ?? '') >= todayStr)

    return future.map((l: any): ExternalEvent => {
      const e           = l.event
      const matched     = venueMatch(e.venue?.name ?? '', venueName)
      const hasTickets  = (e.tickets?.length ?? 0) > 0
      const baseCents   = hasTickets
        ? estimateEntryPrice(e.title, e.date)
        : estimateEntryPrice(e.title, e.date)   // always show a price — free events filtered by title
      const imgFile     = e.images?.[0]?.filename
      return {
        id:            `ra_${e.id}`,
        platform:      'ra',
        title:         e.title,
        venue_name:    e.venue?.name ?? venueName,
        date:          e.date,
        start_time:    e.startTime ?? null,
        image:         imgFile
          ? imgFile.startsWith('http') ? imgFile : `https://static.ra.co/images/events/flyers/${imgFile}`
          : null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      'EUR',
        platform_url:  `https://ra.co/events/${e.id}`,
        sold_out:      false,
        venue_matched: matched,
      }
    })
  } catch {
    return []
  }
}

// ── Eventbrite ────────────────────────────────────────────────────────────────
async function fetchEventbrite(venueName: string, organizerId?: string | null): Promise<ExternalEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) return []
  try {
    let url: string
    if (organizerId) {
      // Direct organizer lookup
      const params = new URLSearchParams({
        'start_date.range_start': new Date().toISOString(),
        sort_by:                  'date',
        expand:                   'venue,ticket_classes',
      })
      url = `https://www.eventbriteapi.com/v3/organizers/${organizerId}/events/?${params}`
    } else {
      const params = new URLSearchParams({
        q:                        venueName,
        'location.address':       'Barcelona, Spain',
        'location.within':        '2km',
        'start_date.range_start': new Date().toISOString(),
        sort_by:                  'date',
        expand:                   'venue,ticket_classes',
      })
      url = `https://www.eventbriteapi.com/v3/events/search/?${params}`
    }
    const res  = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   'no-store',
    })
    if (!res.ok) return []
    const json   = await res.json()
    const events = json?.events ?? []

    return events.flatMap((e: any): ExternalEvent[] => {
      const matched    = venueMatch(e.venue?.name ?? '', venueName)
      const paidClass  = e.ticket_classes?.find((t: any) => !t.free && t.on_sale_status === 'AVAILABLE')
      const freeClass  = e.ticket_classes?.find((t: any) => t.free)
      const tc         = paidClass ?? freeClass ?? e.ticket_classes?.[0]
      if (!tc) return []
      const baseCents  = tc.cost?.value ?? 0
      return [{
        id:            `eb_${e.id}`,
        platform:      'eventbrite',
        title:         e.name?.text ?? 'Event',
        venue_name:    e.venue?.name ?? venueName,
        date:          e.start?.local ?? '',
        start_time:    null,
        image:         e.logo?.url ?? null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      tc.cost?.currency ?? 'EUR',
        platform_url:  e.url,
        sold_out:      tc.on_sale_status === 'SOLD_OUT',
        venue_matched: matched,
      }]
    })
  } catch {
    return []
  }
}

// ── Dice.fm ───────────────────────────────────────────────────────────────────
async function fetchDice(venueName: string, venueId?: string | null): Promise<ExternalEvent[]> {
  const apiKey = process.env.DICE_API_KEY
  if (!apiKey) return []
  try {
    let url: string
    if (venueId) {
      const params = new URLSearchParams({ 'page[size]': '20' })
      params.append('filter[venues][]', venueId)
      url = `https://api.dice.fm/events?${params}`
    } else {
      const params = new URLSearchParams({
        'filter[q]':            venueName,
        'filter[country_code]': 'ES',
        'page[size]':           '5',
      })
      url = `https://api.dice.fm/events?${params}`
    }

    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey },
      cache:   'no-store',
    })
    if (!res.ok) return []
    const json   = await res.json()
    const events: any[] = json?.data ?? []

    return events.flatMap((e: any): ExternalEvent[] => {
      const matched    = venueId
        ? true
        : venueMatch(e.venue?.name ?? '', venueName)
      const startAt    = e.date ?? e.start_date ?? ''
      const dateStr    = startAt ? startAt.slice(0, 10) : ''
      const timeStr    = startAt && startAt.length > 10 ? startAt.slice(11, 16) : null
      // Dice prices are in minor units (cents) for the venue currency
      const baseCents  = e.min_price ?? e.price ?? 0
      return [{
        id:            `dice_${e.id}`,
        platform:      'dice',
        title:         e.name ?? 'Event',
        venue_name:    e.venue?.name ?? venueName,
        date:          dateStr,
        start_time:    timeStr,
        image:         e.image ?? e.artwork_url ?? null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      e.currency ?? 'EUR',
        platform_url:  e.url ?? `https://dice.fm/event/${e.id}`,
        sold_out:      e.sold_out === true,
        venue_matched: matched,
      }]
    })
  } catch {
    return []
  }
}

// ── Xceed ─────────────────────────────────────────────────────────────────────
async function fetchXceed(venueName: string, venueId?: string | null): Promise<ExternalEvent[]> {
  const apiKey = process.env.XCEED_API_KEY
  if (!apiKey) return []
  try {
    let clubId = venueId ?? null

    // If no direct ID, search for the club first
    if (!clubId) {
      const searchParams = new URLSearchParams({ q: venueName, country: 'es' })
      const searchRes    = await fetch(`https://xceed.me/api/v2/clubs?${searchParams}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache:   'no-store',
      })
      if (!searchRes.ok) return []
      const searchJson = await searchRes.json()
      const clubs: any[] = searchJson?.data ?? searchJson ?? []
      const match = clubs.find((c: any) => venueMatch(c.name ?? '', venueName))
      if (!match) return []
      clubId = String(match.id)
    }

    const todayISO = new Date().toISOString()
    const params   = new URLSearchParams({ club_id: clubId, from: todayISO })
    const res      = await fetch(`https://xceed.me/api/v2/events?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache:   'no-store',
    })
    if (!res.ok) return []
    const json   = await res.json()
    const events: any[] = json?.data ?? json ?? []

    return events.flatMap((e: any): ExternalEvent[] => {
      const dateStr   = e.start_date ? String(e.start_date).slice(0, 10) : ''
      const timeStr   = e.start_date && String(e.start_date).length > 10
        ? String(e.start_date).slice(11, 16)
        : null
      const baseCents = e.min_price != null ? Math.round(e.min_price * 100) : 0
      return [{
        id:            `xceed_${e.id}`,
        platform:      'xceed',
        title:         e.name ?? 'Event',
        venue_name:    e.club?.name ?? venueName,
        date:          dateStr,
        start_time:    timeStr,
        image:         e.image ?? e.cover ?? null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      'EUR',
        platform_url:  e.url ?? `https://xceed.me/event/${e.id}`,
        sold_out:      e.sold_out === true,
        venue_matched: true,  // we only fetch events for the matched club
      }]
    })
  } catch {
    return []
  }
}

// ── Songkick ──────────────────────────────────────────────────────────────────
async function fetchSongkick(venueName: string, venueId?: string | null): Promise<ExternalEvent[]> {
  const apiKey = process.env.SONGKICK_API_KEY
  if (!apiKey) return []
  try {
    let skVenueId = venueId ?? null

    // If no direct ID, search for the venue
    if (!skVenueId) {
      const searchParams = new URLSearchParams({ query: venueName, apikey: apiKey })
      const searchRes    = await fetch(
        `https://api.songkick.com/api/3.0/search/venues.json?${searchParams}`,
        { cache: 'no-store' }
      )
      if (!searchRes.ok) return []
      const searchJson   = await searchRes.json()
      const results: any[] = searchJson?.resultsPage?.results?.venue ?? []
      const match = results.find((v: any) => venueMatch(v.displayName ?? '', venueName))
      if (!match) return []
      skVenueId = String(match.id)
    }

    const params = new URLSearchParams({ apikey: apiKey })
    const res    = await fetch(
      `https://api.songkick.com/api/3.0/venues/${skVenueId}/calendar.json?${params}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return []
    const json   = await res.json()
    const events: any[] = json?.resultsPage?.results?.event ?? []

    return events.flatMap((e: any): ExternalEvent[] => {
      const start     = e.start ?? {}
      const dateStr   = start.date ?? ''
      const timeStr   = start.time ? String(start.time).slice(0, 5) : null
      // Songkick doesn't expose ticket prices — use estimate
      const baseCents = estimateEntryPrice(e.displayName ?? '', dateStr)
      return [{
        id:            `sk_${e.id}`,
        platform:      'songkick',
        title:         e.displayName ?? 'Event',
        venue_name:    e.venue?.displayName ?? venueName,
        date:          dateStr,
        start_time:    timeStr,
        image:         null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      'EUR',
        platform_url:  e.uri ?? `https://www.songkick.com/concerts/${e.id}`,
        sold_out:      false,
        venue_matched: true,
      }]
    })
  } catch {
    return []
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const venue              = searchParams.get('venue')               ?? ''
  const all                = searchParams.get('all')                 === 'true'
  const diceVenueId        = searchParams.get('dice_venue_id')       ?? null
  const xceedVenueId       = searchParams.get('xceed_venue_id')      ?? null
  const songkickVenueId    = searchParams.get('songkick_venue_id')   ?? null
  const eventbriteOrgId    = searchParams.get('eventbrite_organizer_id') ?? null

  // ?all=true — return every upcoming Barcelona RA event for the explore page shelf
  if (all) {
    const events = await fetchRA('__none__')  // no venue = no matches flagged
    const seen   = new Set<string>()
    const deduped = events.filter(e => {
      const key = `${e.title.toLowerCase().slice(0, 20)}_${e.date.slice(0, 10)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    deduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    return NextResponse.json({ data: deduped }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    })
  }

  if (!venue) return NextResponse.json({ data: [] }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  })

  const [raEvents, ebEvents, diceEvents, xceedEvents, skEvents] = await Promise.all([
    fetchRA(venue),
    fetchEventbrite(venue, eventbriteOrgId),
    fetchDice(venue, diceVenueId),
    fetchXceed(venue, xceedVenueId),
    fetchSongkick(venue, songkickVenueId),
  ])

  // Deduplicate across all platforms
  const seen   = new Set<string>()
  const merged = [...raEvents, ...ebEvents, ...diceEvents, ...xceedEvents, ...skEvents].filter(e => {
    const key = `${e.title.toLowerCase().slice(0, 20)}_${e.date.slice(0, 10)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort: venue-matched first, then by date
  merged.sort((a, b) => {
    if (a.venue_matched !== b.venue_matched) return a.venue_matched ? -1 : 1
    return new Date(a.date).getTime() - new Date(b.date).getTime()
  })

  // Only return venue-matched events — nearby Barcelona fallback handled on explore page
  const matched = merged.filter(e => e.venue_matched).slice(0, 8)
  return NextResponse.json({ data: matched }, {
    // 5min edge cache + 30min SWR. External event sources move slowly and
    // are expensive to fan out to (5 parallel HTTPS calls per miss).
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  })
}
