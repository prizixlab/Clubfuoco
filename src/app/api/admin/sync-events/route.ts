import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { TICKET_MARKUP } from '@/lib/tickets'

// ── Config ────────────────────────────────────────────────────────────────────

// Barcelona clubs to search for on Eventbrite
const BARCELONA_VENUES = [
  'Opium Barcelona',
  'Pacha Barcelona',
  'Sutton Club',
  'Shoko Barcelona',
  'Razzmatazz',
  'Sala Apolo',
  'Nitsa Club',
  'Sala Upload',
  'Input Barcelona',
  'Moog Barcelona',
]

function markUp(cents: number) {
  return Math.ceil(cents * (1 + TICKET_MARKUP))
}

// ── Eventbrite fetch ──────────────────────────────────────────────────────────

interface EBEvent {
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

async function fetchEventbriteForVenue(venueName: string): Promise<EBEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) return []

  const params = new URLSearchParams({
    q:                        venueName,
    'location.address':       'Barcelona, Spain',
    'location.within':        '5km',
    'start_date.range_start': new Date().toISOString(),
    'start_date.range_end':   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ahead
    sort_by:                  'date',
    expand:                   'venue,ticket_classes',
    page_size:                '50',
  })

  const res = await fetch(
    `https://www.eventbriteapi.com/v3/events/search/?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
  )
  if (!res.ok) return []

  const json   = await res.json()
  const events = json?.events ?? []

  return events.flatMap((e: any): EBEvent[] => {
    const paidClass = e.ticket_classes?.find((t: any) => !t.free && t.on_sale_status === 'AVAILABLE')
    const freeClass = e.ticket_classes?.find((t: any) => t.free)
    const tc        = paidClass ?? freeClass ?? e.ticket_classes?.[0]
    if (!tc) return []

    const baseCents    = tc.cost?.value ?? 0
    const localDate    = e.start?.local ?? ''
    const eventDateISO = e.start?.utc ?? localDate

    return [{
      id:            `eb_${e.id}`,
      platform:      'eventbrite',
      title:         e.name?.text ?? 'Event',
      venue_name:    e.venue?.name ?? venueName,
      event_date:    eventDateISO,
      date:          localDate,
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
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: import('next/server').NextRequest) {
  const authHeader  = req.headers.get('authorization')
  const isManual    = authHeader === 'manual'
  const cronSecret  = process.env.CRON_SECRET

  if (!isManual && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.EVENTBRITE_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'EVENTBRITE_TOKEN not set' }, { status: 503 })
  }

  const supabase = await createServiceClient()

  // Fetch events for all venues in parallel
  const results = await Promise.allSettled(
    BARCELONA_VENUES.map(v => fetchEventbriteForVenue(v))
  )

  const allEvents = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  // Deduplicate by id
  const seen  = new Set<string>()
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  // Remove past events first
  await supabase
    .from('ra_events')
    .delete()
    .lt('event_date', new Date().toISOString())

  // Upsert new/updated events
  if (unique.length > 0) {
    const { error } = await supabase
      .from('ra_events')
      .upsert(
        unique.map(e => ({ ...e, synced_at: new Date().toISOString() })),
        { onConflict: 'id' }
      )

    if (error) {
      console.error('[sync-events] upsert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  console.log(`[sync-events] synced ${unique.length} events from Eventbrite`)
  return NextResponse.json({ synced: unique.length, venues: BARCELONA_VENUES.length })
}
