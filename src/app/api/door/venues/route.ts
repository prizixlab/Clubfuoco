import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/door/venues?date=<yyyy-mm-dd>
// Venues with something happening that night, for the door app's picker — the
// door has to choose a night before it can cache one. Returns counts only, no
// guest data.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return err('date required (yyyy-mm-dd)', 400)

  const supabase = await createServiceClient()

  const [bk, pn] = await Promise.all([
    supabase.from('bookings').select('club_id').eq('booking_date', date).neq('status', 'cancelled'),
    supabase.from('promoter_nights').select('club_id').eq('night_date', date),
  ])

  const counts = new Map<string, { bookings: number; nights: number }>()
  for (const r of bk.data ?? []) {
    const c = counts.get(r.club_id) ?? { bookings: 0, nights: 0 }
    c.bookings++; counts.set(r.club_id, c)
  }
  for (const r of pn.data ?? []) {
    const c = counts.get(r.club_id) ?? { bookings: 0, nights: 0 }
    c.nights++; counts.set(r.club_id, c)
  }

  const ids = [...counts.keys()]
  if (!ids.length) return ok({ date, venues: [] })

  const { data: clubs } = await supabase
    .from('clubs').select('id, name, neighborhood').in('id', ids)

  const venues = (clubs ?? []).map(c => ({
    id: c.id,
    name: c.name,
    neighborhood: c.neighborhood,
    booking_count: counts.get(c.id)?.bookings ?? 0,
  })).sort((a, b) => b.booking_count - a.booking_count)

  return ok({ date, venues })
}
