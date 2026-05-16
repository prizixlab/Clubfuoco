import { NextResponse }    from 'next/server'
import { createClient }    from '@/lib/supabase/server'
import { requireAuth }     from '@/lib/auth'

// GET /api/nero/events
// Returns upcoming published Nero-exclusive events for the authed Nero member.
// Also returns the user's existing RSVPs so the UI can show correct CTA state.

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  // Verify Nero tier
  const { data: me } = await supabase
    .from('users')
    .select('membership_tier')
    .eq('id', user!.id)
    .single()

  if (me?.membership_tier !== 'black') {
    return NextResponse.json({ error: 'Nero members only' }, { status: 403 })
  }

  // Fetch upcoming published events with club info
  const { data: events, error } = await supabase
    .from('nero_events')
    .select(`
      id, title, description, location, event_date, capacity, plus_one,
      clubs ( id, name, neighborhood )
    `)
    .eq('is_published', true)
    .gt('event_date', new Date().toISOString())
    .order('event_date', { ascending: true })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch this user's RSVPs for those events
  const eventIds = (events ?? []).map(e => e.id)
  const { data: rsvps } = eventIds.length
    ? await supabase
        .from('nero_event_rsvps')
        .select('event_id, status')
        .eq('user_id', user!.id)
        .in('event_id', eventIds)
    : { data: [] }

  const rsvpMap: Record<string, string> = {}
  for (const r of rsvps ?? []) rsvpMap[r.event_id] = r.status

  const result = (events ?? []).map(e => ({
    ...e,
    rsvp: rsvpMap[e.id] ?? null,
  }))

  return NextResponse.json({ events: result })
}

// PUT /api/nero/events — club owner creates a Nero event (1 per club per year)
export async function PUT(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json()
  const { club_id, title, description, location, event_date, capacity, plus_one } = body

  if (!club_id || !title || !event_date) {
    return NextResponse.json({ error: 'club_id, title and event_date are required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify caller owns or manages this club
  const { data: club } = await supabase
    .from('clubs')
    .select('id, is_partner, owner_user_id')
    .eq('id', club_id)
    .single()

  if (!club) return NextResponse.json({ error: 'Club not found' }, { status: 404 })
  if (!club.is_partner) return NextResponse.json({ error: 'Club is not a Fuoco partner' }, { status: 403 })
  if (club.owner_user_id !== user!.id) return NextResponse.json({ error: 'Not authorised for this club' }, { status: 403 })

  // Enforce 1 published event per club per calendar year
  const year = new Date(event_date).getFullYear()
  const yearStart = `${year}-01-01T00:00:00.000Z`
  const yearEnd   = `${year + 1}-01-01T00:00:00.000Z`

  const { count } = await supabase
    .from('nero_events')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club_id)
    .eq('is_published', true)
    .gte('event_date', yearStart)
    .lt('event_date', yearEnd)

  if ((count ?? 0) >= 1) {
    return NextResponse.json(
      { error: `${club_id} has already used its one Nero event for ${year}.` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('nero_events')
    .insert({
      club_id,
      title,
      description: description ?? null,
      location:    location    ?? null,
      event_date,
      capacity:    capacity    ?? 40,
      plus_one:    plus_one    ?? false,
      is_published: false, // admin reviews before publishing
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ event: data }, { status: 201 })
}

// POST /api/nero/events — RSVP to an event
export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { event_id, status } = await req.json()
  if (!event_id || !['going', 'interested', 'declined'].includes(status)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('nero_event_rsvps')
    .upsert({ event_id, user_id: user!.id, status }, { onConflict: 'event_id,user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
