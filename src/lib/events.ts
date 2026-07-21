// Upcoming events for a venue, from public.events (the agentbox RA feed —
// see EVENTS_INGEST_BRIEF.md). Distinct from src/lib/tickets.ts's
// ExternalEvent, which models the older, thinner `ra_events` cache.
//
// Events are linked to a venue by `club_id`, resolved at ingest time. That
// replaces the fuzzy venue-name matching the old /api/events route did: an
// event either belongs to this club or it doesn't, so a Rooftop event can no
// longer surface on every other rooftop's page.

export interface ClubEvent {
  ra_event_id: string
  title:       string
  date:        string          // yyyy-MM-dd, the listing day
  start_time:  string | null   // ISO instant; already correct Madrid local time
  venue_name:  string
  promoters:   string[]
  artists:     string[]
  interested:  number
  attending:   number
  ra_url:      string | null
  // `cost` is deliberately NOT surfaced. It is free text on the source
  // ("0", "10€", "", "€") and the brief is explicit that it is unreliable —
  // showing it as a price would misstate what the door actually costs.
}

// "Sat 19 Jul" — the listing day. Parsed as a local date (not via Date(str),
// which treats a bare yyyy-MM-dd as UTC and can shift the day backwards.
export function formatEventDate(date: string, locale = 'en-GB'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

// "23:00". The stored instant is correct, so render it in Barcelona time
// regardless of where the reader's device is.
export function formatEventTime(startTime: string | null, locale = 'en-GB'): string | null {
  if (!startTime) return null
  const d = new Date(startTime)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid',
  })
}

/** Is this event on, or after, the given yyyy-MM-dd? String compare is safe on ISO dates. */
export function isUpcoming(event: ClubEvent, today: string): boolean {
  return event.date >= today
}
