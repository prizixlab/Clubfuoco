import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { TICKET_MARKUP } from '@/lib/tickets'

// ── Config ────────────────────────────────────────────────────────────────────

// Italian RA area IDs (verified via ra.co GraphQL). Each city has 2 IDs because
// RA migrated to new IDs but kept the old ones live for backwards compatibility.
const RA_ITALIAN_AREAS: { id: number; city: string }[] = [
  { id: 171, city: 'Milan'    },
  { id: 347, city: 'Milan'    },
  { id: 351, city: 'Rome'     },
  { id:  52, city: 'Florence' },
  { id: 352, city: 'Florence' },
  { id: 348, city: 'Turin'    },
  { id: 349, city: 'Venice'   },
  { id: 350, city: 'Bologna'  },
  { id: 172, city: 'Naples'   },
  { id: 406, city: 'Naples'   },
  { id: 302, city: 'Sicily'   },
]

const RA_GRAPHQL = 'https://ra.co/graphql'

function markUp(cents: number) {
  return Math.ceil(cents * (1 + TICKET_MARKUP))
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

// ── Common event shape ────────────────────────────────────────────────────────

interface SyncedEvent {
  id:            string
  platform:      string
  title:         string
  venue_name:    string
  event_date:    string
  date:          string
  start_time:    string | null
  image:         string | null
  base_price:    number
  display_price: number
  currency:      string
  platform_url:  string
  sold_out:      boolean
  venue_matched: boolean
}

// ── Resident Advisor (no auth required, public GraphQL) ───────────────────────

async function fetchRAForArea(areaId: number): Promise<SyncedEvent[]> {
  const today    = new Date()
  const horizon  = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  const query    = `query GetEvents($area:Int!,$gte:String!,$lte:String!){
    eventListings(filters:{areas:{eq:$area},listingDate:{gte:$gte,lte:$lte}},pageSize:100,page:1){
      data{event{id title date startTime contentUrl flyerFront images{filename} venue{name}}}
    }
  }`

  try {
    const res = await fetch(RA_GRAPHQL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      cache:   'no-store',
      body:    JSON.stringify({
        query,
        variables: { area: areaId, gte: isoDay(today), lte: isoDay(horizon) },
      }),
    })
    if (!res.ok) return []

    const json     = await res.json()
    const listings = json?.data?.eventListings?.data ?? []

    return listings.map((row: any): SyncedEvent | null => {
      const e = row?.event
      if (!e?.id || !e?.venue?.name) return null
      const titleLower = (e.title ?? '').toLowerCase()
      return {
        id:            `ra_${e.id}`,
        platform:      'ra',
        title:         e.title ?? 'Event',
        venue_name:    e.venue.name,
        event_date:    e.startTime ?? e.date ?? new Date().toISOString(),
        date:          e.date ?? e.startTime ?? new Date().toISOString(),
        start_time:    e.startTime ?? null,
        image:         e.flyerFront ?? e.images?.[0]?.filename ?? null,
        base_price:    0,                         // RA listing query doesn't expose price
        display_price: 0,
        currency:      'EUR',
        platform_url:  `https://ra.co${e.contentUrl ?? `/events/${e.id}`}`,
        sold_out:      titleLower.includes('sold out'),
        venue_matched: false,                     // matched later against clubs table
      }
    }).filter(Boolean) as SyncedEvent[]
  } catch {
    return []
  }
}

// ── Eventbrite Organizer API (per-club, requires `eventbrite_organizer_id`) ──

async function fetchEventbriteForOrganizer(orgId: string, fallbackVenue: string): Promise<SyncedEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) return []

  try {
    const params = new URLSearchParams({
      'start_date.range_start': new Date().toISOString(),
      expand:                   'venue,ticket_classes',
      page_size:                '50',
      status:                   'live',
    })
    const res = await fetch(
      `https://www.eventbriteapi.com/v3/organizations/${orgId}/events/?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    )
    if (!res.ok) return []

    const json   = await res.json()
    const events = json?.events ?? []

    return events.flatMap((e: any): SyncedEvent[] => {
      const tc = e.ticket_classes?.find((t: any) => !t.free && t.on_sale_status === 'AVAILABLE')
              ?? e.ticket_classes?.find((t: any) => t.free)
              ?? e.ticket_classes?.[0]
      if (!tc) return []
      const baseCents    = tc.cost?.value ?? 0
      const eventDateISO = e.start?.utc ?? e.start?.local ?? new Date().toISOString()
      return [{
        id:            `eb_${e.id}`,
        platform:      'eventbrite',
        title:         e.name?.text ?? 'Event',
        venue_name:    e.venue?.name ?? fallbackVenue,
        event_date:    eventDateISO,
        date:          e.start?.local ?? eventDateISO,
        start_time:    null,
        image:         e.logo?.url ?? null,
        base_price:    baseCents,
        display_price: baseCents === 0 ? 0 : markUp(baseCents),
        currency:      tc.cost?.currency ?? 'EUR',
        platform_url:  e.url,
        sold_out:      tc.on_sale_status === 'SOLD_OUT',
        venue_matched: true,
      }]
    })
  } catch {
    return []
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: import('next/server').NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isManual   = authHeader === 'manual'
  const cronSecret = process.env.CRON_SECRET

  if (!isManual && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // ── 1. RA: pull all Italian-area events ─────────────────────────────────────
  const raResults = await Promise.allSettled(RA_ITALIAN_AREAS.map(a => fetchRAForArea(a.id)))
  const raEvents  = raResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  // ── 2. Eventbrite: per-club, only for clubs with an organizer id set ────────
  const { data: ebClubs } = await supabase
    .from('clubs')
    .select('name, eventbrite_organizer_id')
    .not('eventbrite_organizer_id', 'is', null)

  const ebResults = await Promise.allSettled(
    (ebClubs ?? []).map(c =>
      fetchEventbriteForOrganizer(c.eventbrite_organizer_id as string, c.name as string),
    ),
  )
  const ebEvents = ebResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  // ── 3. Combine + dedupe ─────────────────────────────────────────────────────
  const all = [...raEvents, ...ebEvents]
  const seen = new Set<string>()
  const unique = all.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  // ── 4. Purge past events, then upsert ───────────────────────────────────────
  await supabase
    .from('ra_events')
    .delete()
    .lt('event_date', new Date().toISOString())

  if (unique.length > 0) {
    const { error } = await supabase
      .from('ra_events')
      .upsert(
        unique.map(e => ({ ...e, synced_at: new Date().toISOString() })),
        { onConflict: 'id' },
      )
    if (error) {
      console.error('[sync-events] upsert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  console.log(`[sync-events] synced ${unique.length} events (ra=${raEvents.length} eb=${ebEvents.length})`)
  return NextResponse.json({
    synced:     unique.length,
    ra_events:  raEvents.length,
    eb_events:  ebEvents.length,
    eb_clubs:   ebClubs?.length ?? 0,
  })
}
