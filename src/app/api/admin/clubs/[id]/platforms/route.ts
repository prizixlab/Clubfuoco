import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const VENUE_STOPWORDS = new Set([
  'barcelona', 'club', 'bar', 'the', 'lounge', 'hotel', 'cafe', 'cafes',
  'music', 'night', 'live', 'room', 'space', 'house', 'disco', 'dance',
  'party', 'venue', 'stage', 'place', 'sala', 'local', 'bcn', 'spain',
  'restaurante', 'restaurant', 'cocktail', 'cocteleria', 'terraza',
])

function venueMatch(a: string, b: string): boolean {
  const na = normName(a)
  const nb = normName(b)
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const meaningful = (s: string) =>
    s.split(' ').filter(w => w.length > 2 && !VENUE_STOPWORDS.has(w))
  const wordsA = meaningful(na)
  const wordsB = new Set(meaningful(nb))
  return wordsA.length > 0 && wordsA.some(w => wordsB.has(w))
}

// ── Platform search helpers ───────────────────────────────────────────────────

async function searchDice(clubName: string): Promise<string | null> {
  const apiKey = process.env.DICE_API_KEY
  if (!apiKey) return null
  try {
    const params = new URLSearchParams({
      'filter[q]':            clubName,
      'filter[country_code]': 'ES',
      'page[size]':           '5',
    })
    const res  = await fetch(`https://api.dice.fm/events?${params}`, {
      headers: { 'X-Api-Key': apiKey },
      cache:   'no-store',
    })
    if (!res.ok) return null
    const json: any   = await res.json()
    const events: any[] = json?.data ?? []
    const match = events.find((e: any) => venueMatch(e.venue?.name ?? '', clubName))
    return match?.venue?.id ? String(match.venue.id) : null
  } catch {
    return null
  }
}

async function searchXceed(clubName: string): Promise<string | null> {
  const apiKey = process.env.XCEED_API_KEY
  if (!apiKey) return null
  try {
    const params  = new URLSearchParams({ q: clubName, country: 'es' })
    const res     = await fetch(`https://xceed.me/api/v2/clubs?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache:   'no-store',
    })
    if (!res.ok) return null
    const json: any   = await res.json()
    const clubs: any[] = json?.data ?? json ?? []
    const match = clubs.find((c: any) => venueMatch(c.name ?? '', clubName))
    return match?.id ? String(match.id) : null
  } catch {
    return null
  }
}

async function searchSongkick(clubName: string): Promise<string | null> {
  const apiKey = process.env.SONGKICK_API_KEY
  if (!apiKey) return null
  try {
    const params = new URLSearchParams({ query: clubName, apikey: apiKey })
    const res    = await fetch(
      `https://api.songkick.com/api/3.0/search/venues.json?${params}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const json: any    = await res.json()
    const venues: any[] = json?.resultsPage?.results?.venue ?? []
    const match = venues.find((v: any) => venueMatch(v.displayName ?? '', clubName))
    return match?.id ? String(match.id) : null
  } catch {
    return null
  }
}

async function searchEventbrite(clubName: string): Promise<string | null> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) return null
  try {
    const params = new URLSearchParams({
      q:                    clubName,
      'location.address':   'Barcelona, Spain',
      'location.within':    '2km',
      expand:               'organizer',
    })
    const res  = await fetch(`https://www.eventbriteapi.com/v3/events/search/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   'no-store',
    })
    if (!res.ok) return null
    const json: any    = await res.json()
    const events: any[] = json?.events ?? []
    const match = events.find((e: any) =>
      venueMatch(e.organizer?.name ?? '', clubName) ||
      venueMatch(e.name?.text ?? '', clubName)
    )
    return match?.organizer?.id ? String(match.organizer.id) : null
  } catch {
    return null
  }
}

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const { user, response } = await requireAuth()
  if (response) return { user: null, response }

  const supabase = await createServiceClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user!.id)
    .single()

  if (!['admin', 'staff'].includes(profile?.role ?? '')) {
    return { user: null, response: err('Forbidden', 403) }
  }
  return { user, response: null }
}

// ── GET — search all platforms for this club ──────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdmin()
  if (response) return response

  const { id } = await params
  const supabase = await createServiceClient()

  const { data: club, error } = await supabase
    .from('clubs')
    .select('name, ra_venue_slug, dice_venue_id, xceed_venue_id, songkick_venue_id, eventbrite_organizer_id')
    .eq('id', id)
    .single()

  if (error || !club) return err('Club not found', 404)

  const clubName = club.name as string

  // Run all platform searches in parallel
  const [diceId, xceedId, songkickId, eventbriteOrgId] = await Promise.all([
    club.dice_venue_id         ? Promise.resolve(club.dice_venue_id as string)         : searchDice(clubName),
    club.xceed_venue_id        ? Promise.resolve(club.xceed_venue_id as string)        : searchXceed(clubName),
    club.songkick_venue_id     ? Promise.resolve(club.songkick_venue_id as string)     : searchSongkick(clubName),
    club.eventbrite_organizer_id ? Promise.resolve(club.eventbrite_organizer_id as string) : searchEventbrite(clubName),
  ])

  return ok({
    club_id:                   id,
    club_name:                 clubName,
    ra_venue_slug:             club.ra_venue_slug ?? null,
    dice_venue_id:             diceId,
    xceed_venue_id:            xceedId,
    songkick_venue_id:         songkickId,
    eventbrite_organizer_id:   eventbriteOrgId,
  })
}

// ── POST — save platform IDs to the club ─────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdmin()
  if (response) return response

  const { id } = await params

  const body = await req.json() as {
    dice_venue_id?:            string | null
    xceed_venue_id?:           string | null
    songkick_venue_id?:        string | null
    eventbrite_organizer_id?:  string | null
    ra_venue_slug?:            string | null
  }

  // Build update object — only include keys that were explicitly provided
  const update: Record<string, string | null> = {}
  if ('dice_venue_id'           in body) update.dice_venue_id            = body.dice_venue_id            ?? null
  if ('xceed_venue_id'          in body) update.xceed_venue_id           = body.xceed_venue_id           ?? null
  if ('songkick_venue_id'       in body) update.songkick_venue_id        = body.songkick_venue_id        ?? null
  if ('eventbrite_organizer_id' in body) update.eventbrite_organizer_id  = body.eventbrite_organizer_id  ?? null
  if ('ra_venue_slug'           in body) update.ra_venue_slug            = body.ra_venue_slug            ?? null

  if (Object.keys(update).length === 0) return err('No fields provided')

  const supabase = await createServiceClient()
  const { error } = await supabase.from('clubs').update(update).eq('id', id)
  if (error) return err(error.message)

  return ok({ id, updated: update })
}
