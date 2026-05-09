import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// Recomputes and stores the user's taste profile from all available signals
async function recomputeProfile(userId: string) {
  const supabase = await createServiceClient()

  // ── 1. Survey signals ─────────────────────────────────────────────────────
  const { data: surveys } = await supabase
    .from('booking_surveys')
    .select('rating, vibe_rating, crowd_rating, would_return, drinks, booking_id')
    .eq('user_id', userId)

  // ── 2. Booking history ────────────────────────────────────────────────────
  const { data: bookings } = await supabase
    .from('bookings')
    .select('club_id, booking_date, party_size, clubs(neighborhood, music_genres)')
    .eq('user_id', userId)
    .eq('status', 'confirmed')

  // ── 3. Saved favorites ────────────────────────────────────────────────────
  const { data: favs } = await supabase
    .from('place_favorites')
    .select('place_id')
    .eq('user_id', userId)

  // ── 4. Tags for booked clubs ──────────────────────────────────────────────
  const bookedClubIds = [...new Set((bookings ?? []).map(b => b.club_id))]
  const { data: bookedTags } = bookedClubIds.length > 0
    ? await supabase
        .from('club_tags')
        .select('tag, category')
        .in('club_id', bookedClubIds)
    : { data: [] }

  // Score genre/vibe tags — weight by survey rating
  const tagScores: Record<string, number> = {}

  for (const survey of surveys ?? []) {
    const { data: bk } = await supabase
      .from('bookings')
      .select('club_id')
      .eq('id', survey.booking_id)
      .single()
    if (!bk) continue

    const { data: tags } = await supabase
      .from('club_tags')
      .select('tag, category')
      .eq('club_id', bk.club_id)

    const multiplier = survey.rating >= 4 ? 2 : survey.rating >= 3 ? 1 : -1
    for (const t of tags ?? []) {
      tagScores[t.tag] = (tagScores[t.tag] ?? 0) + multiplier
    }
  }

  // Boost tags from all booked clubs (implicit positive signal — they went)
  for (const t of bookedTags ?? []) {
    tagScores[t.tag] = (tagScores[t.tag] ?? 0) + 1
  }

  // Top genres and vibes = tags with positive score, sorted by score
  const positiveByCategory = (cat: string) =>
    Object.entries(tagScores)
      .filter(([tag, score]) => score > 0 && (bookedTags ?? []).some(t => t.tag === tag && t.category === cat))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)

  const topGenres = positiveByCategory('music')
  const topVibes  = positiveByCategory('vibe')

  // Preferred neighborhoods from bookings
  const neighborhoodCount: Record<string, number> = {}
  for (const b of bookings ?? []) {
    const n = (b.clubs as any)?.neighborhood
    if (n) neighborhoodCount[n] = (neighborhoodCount[n] ?? 0) + 1
  }
  const topNeighborhoods = Object.entries(neighborhoodCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n]) => n)

  // Day-of-week patterns
  const days = (bookings ?? []).map(b => new Date(b.booking_date).getDay())
  const goesWeekends = days.some(d => d === 5 || d === 6 || d === 0)
  const goesWeekdays = days.some(d => d >= 1 && d <= 4)

  // Avg party size
  const partySizes = (bookings ?? []).map(b => b.party_size).filter(Boolean)
  const avgPartySize = partySizes.length > 0
    ? Math.round(partySizes.reduce((a, b) => a + b, 0) / partySizes.length)
    : 2

  await supabase
    .from('user_taste_profile')
    .upsert({
      user_id:             userId,
      top_genres:          topGenres,
      top_vibes:           topVibes,
      top_neighborhoods:   topNeighborhoods,
      goes_weekends:       goesWeekends,
      goes_weekdays:       goesWeekdays,
      avg_party_size:      avgPartySize,
      updated_at:          new Date().toISOString(),
    }, { onConflict: 'user_id' })
}

// GET /api/me/taste-profile — returns the user's current taste profile
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data } = await supabase
    .from('user_taste_profile')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()

  return ok(data)
}

// POST /api/me/taste-profile — trigger a recompute (called after bookings/surveys)
export async function POST() {
  const { user, response } = await requireAuth()
  if (response) return response

  await recomputeProfile(user!.id)
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_taste_profile')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()

  return ok(data)
}

