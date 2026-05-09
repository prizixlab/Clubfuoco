import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

// GET /api/admin/clubs/search?q=<query>
// Searches Google Places Text Search for Barcelona nightlife venues
export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get('q')
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })

  const searchQuery = `${q} Barcelona`
  const res  = await fetch(
    `${BASE}/textsearch/json?query=${encodeURIComponent(searchQuery)}&type=bar|night_club&key=${KEY}`
  )
  const data = await res.json()

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return NextResponse.json({ error: data.status }, { status: 502 })
  }

  // Fetch already-imported place IDs so we can mark them
  const { data: existing } = await supabase
    .from('clubs')
    .select('google_place_id')
    .not('google_place_id', 'is', null)

  const importedIds = new Set((existing ?? []).map(c => c.google_place_id))

  const results = (data.results ?? [])
    .filter((r: any) => !importedIds.has(r.place_id))   // hide already imported
    .slice(0, 10)
    .map((r: any) => ({
      place_id: r.place_id,
      name:     r.name,
      address:  r.formatted_address,
      rating:   r.rating ?? null,
      types:    r.types ?? [],
    }))

  return NextResponse.json({ data: results })
}
