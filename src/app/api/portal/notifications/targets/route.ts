import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/notifications/targets?q=
// What a broadcast can link to. Only things the consumer app can actually open
// from a tap: ACTIVE venues, and events that are guest-visible right now (the
// v_events_feed gate). Linking a private or unapproved night would open
// nothing — the app resolves events out of that same feed.

export interface LinkTarget {
  type: 'club' | 'event'
  id: string
  name: string
  /** Neighbourhood for a venue; "date · venue" for an event. */
  detail: string | null
}

export async function GET(req: NextRequest) {
  const gate = await requirePortal()
  if (gate) return gate

  // Same sanitising as clubs/browse: PostgREST filter syntax is comma/paren
  // delimited, so strip those from user input.
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().replace(/[(),%]/g, ' ').trim()
  const sb = await createServiceClient()

  let clubsQ = sb.from('clubs').select('id, name, neighborhood').eq('is_active', true)
  if (q) clubsQ = clubsQ.ilike('name', `%${q}%`)
  clubsQ = clubsQ.order('is_featured', { ascending: false }).order('name').limit(8)

  // The view already orders pinned → featured → soonest, so an empty search
  // shows what's worth announcing first.
  let eventsQ = sb.from('v_events_feed').select('id, title, night_date, club_id, location_name')
  if (q) eventsQ = eventsQ.ilike('title', `%${q}%`)
  eventsQ = eventsQ.limit(8)

  const [clubs, events] = await Promise.all([clubsQ, eventsQ])
  if (clubs.error) return err(clubs.error.message, 500)

  // Event venue names in one batch — an embed on the view doesn't resolve.
  const evRows = events.error ? [] : (events.data ?? [])
  const venueIds = [...new Set(evRows.map(e => e.club_id).filter(Boolean))] as string[]
  const venues = new Map<string, string>()
  if (venueIds.length) {
    const { data } = await sb.from('clubs').select('id, name').in('id', venueIds)
    for (const v of data ?? []) venues.set(v.id, v.name)
  }

  const targets: LinkTarget[] = [
    ...evRows.map(e => ({
      type: 'event' as const,
      id: e.id as string,
      name: (e.title as string | null) || 'Untitled event',
      detail: [e.night_date, (e.club_id && venues.get(e.club_id)) || e.location_name]
        .filter(Boolean).join(' · ') || null,
    })),
    ...(clubs.data ?? []).map(c => ({
      type: 'club' as const,
      id: c.id as string,
      name: c.name as string,
      detail: (c.neighborhood as string | null) ?? null,
    })),
  ]
  return ok({ targets })
}
