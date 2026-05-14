/**
 * Direct Supabase query functions.
 *
 * Used by Capacitor (iOS) pages instead of routing through Vercel API routes.
 * All queries run client-side with the authenticated browser Supabase client,
 * so RLS policies on the tables enforce access control.
 */

import { createClient } from '@/lib/supabase/client'

/** Normalise whatever is stored in opening_hours → string[7] */
function toHoursArray(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v)
      if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string')
    } catch {}
    return v.split(/(?=Monday:|Tuesday:|Wednesday:|Thursday:|Friday:|Saturday:|Sunday:)/i).map(s => s.trim()).filter(Boolean)
  }
  return []
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

/** Returns the current user from the local session — no network call. */
async function currentUser() {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function proxyPhoto(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) {
    try {
      const ref = new URL(url).searchParams.get('photo_reference')
      if (ref) return `https://clubfuoco.vercel.app/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=800`
    } catch { /* fall through */ }
  }
  return url
}

// ─── Places / Clubs ───────────────────────────────────────────────────────────

/** Fetch clubs within `radius` metres of (lat, lng). */
export async function getNearbyClubs(lat: number, lng: number, radius: number) {
  const supabase = createClient()

  const latDelta = radius / 111_000
  const lngDelta = radius / 85_000

  const { data: clubs, error } = await supabase
    .from('clubs')
    .select(`
      id, name, slug, address, neighborhood,
      lat, lng, cover_image_url, gallery_urls, photos,
      rating, ratings_total, music_genres, google_place_id,
      general_entry_price, vip_table_min_spend,
      is_featured, is_partner,
      live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
      club_tags ( tag, category )
    `)
    .eq('is_active', true)
    .not('lat', 'is', null)
    .gte('lat', lat - latDelta).lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta).lte('lng', lng + lngDelta)
    .order('is_featured',   { ascending: false })
    .order('is_partner',    { ascending: false })
    .order('ratings_total', { ascending: false, nullsFirst: false })
    .order('rating',        { ascending: false, nullsFirst: false })
    .limit(2000)

  if (error) throw new Error(error.message)

  return (clubs ?? []).map((club: any) => {
    const tags: string[] = (club.club_tags ?? []).map((t: any) => t.tag)

    const photoSeen = new Set<string>()
    const allPhotos: string[] = [
      ...(club.cover_image_url ? [club.cover_image_url] : []),
      ...(Array.isArray(club.photos)       ? club.photos       : []),
      ...(Array.isArray(club.gallery_urls) ? club.gallery_urls : []),
    ]
      .filter(Boolean)
      .map(proxyPhoto)
      .filter((url): url is string => {
        if (!url || photoSeen.has(url)) return false
        photoSeen.add(url)
        return true
      })
      .slice(0, 8)

    return {
      place_id:            club.id,
      name:                club.name,
      slug:                club.slug,
      address:             club.address ?? '',
      neighborhood:        club.neighborhood ?? null,
      lat:                 club.lat  ?? 0,
      lng:                 club.lng  ?? 0,
      rating:              club.rating        ?? null,
      ratings_total:       club.ratings_total ?? 0,
      price_level:         null,
      is_open:             (club.live_status as any)?.is_open ?? null,
      live_status:         club.live_status   ?? null,
      music_genres:        club.music_genres  ?? [],
      tags,
      google_place_id:     club.google_place_id ?? null,
      is_featured:         club.is_featured,
      is_partner:          club.is_partner,
      general_entry_price: club.general_entry_price ?? null,
      vip_table_min_spend: club.vip_table_min_spend ?? null,
      cover_photo:         allPhotos[0] ?? null,
      photos:              allPhotos,
      photo_refs:          [],
      website:             null,
      maps_url: club.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${club.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' Barcelona')}`,
    }
  })
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function getPlaceFavorites() {
  const user = await currentUser()
  if (!user) return []
  const supabase = createClient()

  const { data, error } = await supabase
    .from('place_favorites')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function savePlaceFavorite(place: {
  place_id: string; name: string; address: string
  cover_photo?: string | null; rating?: number | null
}) {
  const user = await currentUser()
  if (!user) throw new Error('Not authenticated')
  const supabase = createClient()

  const { error } = await supabase
    .from('place_favorites')
    .upsert({ user_id: user.id, ...place }, { onConflict: 'user_id,place_id' })
  if (error) throw new Error(error.message)
}

export async function removePlaceFavorite(place_id: string) {
  const user = await currentUser()
  if (!user) throw new Error('Not authenticated')
  const supabase = createClient()

  const { error } = await supabase
    .from('place_favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('place_id', place_id)
  if (error) throw new Error(error.message)
}

// ─── User preferences ─────────────────────────────────────────────────────────

export async function getUserPreferences(): Promise<{ preferences: any; onboarding_done: boolean } | null> {
  const user = await currentUser()
  if (!user) return null
  const supabase = createClient()

  const { data } = await supabase
    .from('users')
    .select('preferences, onboarding_done')
    .eq('id', user.id)
    .single()

  return (data as any) ?? null
}

export async function saveUserPreferences(preferences: Record<string, unknown>) {
  const user = await currentUser()
  if (!user) throw new Error('Not authenticated')
  const supabase = createClient()

  const { error } = await supabase
    .from('users')
    .update({ preferences, onboarding_done: true })
    .eq('id', user.id)
  if (error) throw new Error(error.message)
}

// ─── Survey preferences ───────────────────────────────────────────────────────

export async function getSurveyPreferences() {
  const user = await currentUser()
  if (!user) return null
  const supabase = createClient()

  const { data: surveys, error } = await supabase
    .from('booking_surveys')
    .select(`
      rating, drinks, vibe_rating, crowd_rating, would_return,
      bookings ( booking_date, clubs ( id, name, price_level ) )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error || !surveys?.length) return null

  const drinkCounts: Record<string, number> = {}
  for (const s of surveys) {
    for (const d of (s.drinks ?? []) as string[]) {
      drinkCounts[d] = (drinkCounts[d] ?? 0) + 1
    }
  }

  const avgRating   = surveys.reduce((s: number, r: any) => s + r.rating,       0) / surveys.length
  const avgVibe     = surveys.reduce((s: number, r: any) => s + r.vibe_rating,  0) / surveys.length
  const avgCrowd    = surveys.reduce((s: number, r: any) => s + r.crowd_rating, 0) / surveys.length
  const wouldReturn = surveys.filter((s: any) => s.would_return).length / surveys.length

  return {
    avgRating, avgVibe, avgCrowd, wouldReturn,
    topDrinks:   Object.entries(drinkCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d),
    surveyCount: surveys.length,
  }
}

// ─── Taste profile ────────────────────────────────────────────────────────────

export async function getTasteProfile() {
  const user = await currentUser()
  if (!user) return null
  const supabase = createClient()

  const { data } = await supabase
    .from('user_taste_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return data ?? null
}

// ─── Club detail ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getClubById(id: string) {
  const supabase = createClient()

  const isUUID = UUID_RE.test(id)

  const baseQuery = (supabase as any)
    .from('clubs')
    .select(`
      id, name, slug, address, neighborhood,
      lat, lng, cover_image_url, gallery_urls, photos,
      rating, ratings_total, music_genres, google_place_id,
      description, instagram_handle, whatsapp_link,
      general_entry_price, vip_table_min_spend,
      opening_hours, is_featured, is_partner, is_active,
      reviews,
      live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
      club_tags ( tag, category )
    `)

  const { data: club, error } = await (isUUID
    ? baseQuery.eq('id', id)
    : baseQuery.eq('google_place_id', id)
  ).maybeSingle()

  if (error) throw new Error(error.message)
  if (!club) return null

  const tags: string[] = (club.club_tags ?? []).map((t: any) => t.tag)

  const seen = new Set<string>()
  const allPhotos: string[] = [
    ...(club.cover_image_url ? [club.cover_image_url] : []),
    ...(Array.isArray(club.photos)       ? club.photos       : []),
    ...(Array.isArray(club.gallery_urls) ? club.gallery_urls : []),
  ]
    .filter(Boolean)
    .map(proxyPhoto)
    .filter((url): url is string => {
      if (!url || seen.has(url)) return false
      seen.add(url)
      return true
    })

  const reviews: any[] = Array.isArray(club.reviews) ? club.reviews : []

  return {
    place_id:       club.id,
    name:           club.name,
    slug:           club.slug,
    address:        club.address ?? '',
    neighborhood:   club.neighborhood ?? null,
    lat:            club.lat  ?? null,
    lng:            club.lng  ?? null,
    description:    club.description ?? null,
    instagram_handle: club.instagram_handle ?? null,
    whatsapp_link:  club.whatsapp_link ?? null,
    phone:          null,
    website:        null,
    rating:         club.rating        ?? null,
    ratings_total:  club.ratings_total ?? 0,
    price_level:    null,
    is_open:        (club.live_status as any)?.is_open ?? null,
    live_status:    club.live_status ?? null,
    weekday_hours:  toHoursArray(club.opening_hours),
    music_genres:   club.music_genres  ?? [],
    tags,
    google_place_id: club.google_place_id ?? null,
    is_partner:     club.is_partner,
    is_featured:    club.is_featured,
    general_entry_price: club.general_entry_price ?? null,
    vip_table_min_spend: club.vip_table_min_spend ?? null,
    reviews,
    photos:         allPhotos,
    cover_photo:    allPhotos[0] ?? null,
    maps_url: club.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${club.google_place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' Barcelona')}`,
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function getEvents() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('ra_events')
    .select('id, platform, title, venue_name, date, start_time, image, base_price, display_price, currency, platform_url, sold_out, venue_matched')
    .gte('event_date', new Date().toISOString())   // only future events
    .order('event_date', { ascending: true })
    .limit(200)

  if (error) return []
  return (data ?? []) as import('@/lib/tickets').ExternalEvent[]
}

// ─── Rumbas ───────────────────────────────────────────────────────────────────

export async function getRumbas() {
  const supabase = createClient()

  const { data: rumbas, error } = await supabase
    .from('rumbas')
    .select('*')
    .eq('is_active', true)
    .order('event_date', { ascending: true })

  if (error) return []

  const rumbaIds = (rumbas ?? []).map((r: any) => r.id)
  let countMap: Record<string, number> = {}

  if (rumbaIds.length > 0) {
    const { data: counts } = await supabase
      .from('rumba_signups')
      .select('rumba_id')
      .in('rumba_id', rumbaIds)
      .neq('status', 'denied')

    if (counts) {
      counts.forEach((c: any) => {
        countMap[c.rumba_id] = (countMap[c.rumba_id] ?? 0) + 1
      })
    }
  }

  return (rumbas ?? []).map((r: any) => ({ ...r, signup_count: countMap[r.id] ?? 0 }))
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function getMe() {
  const user = await currentUser()
  if (!user) return null
  const supabase = createClient()

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return data ?? null
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export async function getMyBookings() {
  const user = await currentUser()
  if (!user) return { bookings: [], signups: [], tickets: [] }
  const supabase = createClient()

  const [bookingsRes, signupsRes, ticketsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, booking_type, party_size, booking_date, arrival_window,
        status, total_amount, qr_code_token, created_at,
        clubs (id, name, cover_image_url, address, neighborhood)
      `)
      .eq('user_id', user.id)
      .order('booking_date', { ascending: false }),

    supabase
      .from('guest_list_signups')
      .select(`
        id, full_name, party_size, status, tier, checked_in, created_at,
        guest_lists (id, event_name, event_date, cutoff_time, free_entry_label,
          clubs (id, name, neighborhood)
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),

    supabase
      .from('ticket_orders')
      .select(`
        id, event_name, venue_name, venue_place_id, event_date,
        quantity, base_price_cents, markup_cents, total_cents,
        status, qr_token, created_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  return {
    bookings: bookingsRes.data ?? [],
    signups:  signupsRes.data  ?? [],
    tickets:  ticketsRes.data  ?? [],
  }
}

// ─── Pending surveys ──────────────────────────────────────────────────────────

export async function getPendingSurveys() {
  const user = await currentUser()
  if (!user) return []
  const supabase = createClient()

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo   = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, booking_date, booking_type, clubs(id, name, cover_image_url)')
    .eq('user_id', user.id)
    .in('status', ['confirmed', 'used'])
    .lte('booking_date', yesterday.toISOString().slice(0, 10))
    .gte('booking_date', weekAgo.toISOString().slice(0, 10))
    .order('booking_date', { ascending: false })

  if (!bookings?.length) return []

  const { data: done } = await supabase
    .from('booking_surveys')
    .select('booking_id')
    .in('booking_id', bookings.map((b: any) => b.id))

  const doneIds = new Set((done ?? []).map((d: any) => d.booking_id))
  return bookings.filter((b: any) => !doneIds.has(b.id))
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications() {
  const user = await currentUser()
  if (!user) return []
  const supabase = createClient()

  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return data ?? []
}

export async function markNotificationsRead() {
  const user = await currentUser()
  if (!user) return
  const supabase = createClient()

  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
}
