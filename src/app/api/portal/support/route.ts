import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requirePortal } from '@/lib/portal-auth'

export interface SupportRow {
  id: string
  topic: string
  message: string | null
  status: 'open' | 'in_progress' | 'resolved'
  created_at: string
  resolved_at: string | null
  night_date: string | null
  contact_email: string | null
  guest_name: string | null
  club_name: string | null
  booking_id: string | null
  booking_ref: string | null
  booking_status: string | null
  party_size: number | null
}

// GET /api/portal/support?status=open|all — the support inbox.
//
// Joins are done as separate lookups rather than PostgREST embeds: support_requests
// has FKs to users, bookings and clubs, and bookings itself has two FKs to users,
// which makes nested embeds ambiguous (the same 300 that bit the door manifest).
export async function GET(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  const status = req.nextUrl.searchParams.get('status') ?? 'open'
  const sb = await createServiceClient()

  let q = sb
    .from('support_requests')
    .select('id, topic, message, status, created_at, resolved_at, night_date, contact_email, user_id, booking_id, club_id')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') q = q.eq('status', status)

  const { data: rows, error } = await q
  // Table lands with a manual migration — an empty inbox beats a broken tab.
  if (error) return ok({ requests: [], counts: { open: 0, in_progress: 0, resolved: 0 }, unavailable: true })

  const userIds = [...new Set((rows ?? []).map(r => r.user_id).filter(Boolean))] as string[]
  const bookingIds = [...new Set((rows ?? []).map(r => r.booking_id).filter(Boolean))] as string[]
  const clubIds = [...new Set((rows ?? []).map(r => r.club_id).filter(Boolean))] as string[]

  const [users, bookings, clubs, counts] = await Promise.all([
    userIds.length ? sb.from('users').select('id, full_name, email').in('id', userIds) : { data: [] },
    bookingIds.length ? sb.from('bookings').select('id, qr_code_token, status, party_size').in('id', bookingIds) : { data: [] },
    clubIds.length ? sb.from('clubs').select('id, name').in('id', clubIds) : { data: [] },
    sb.from('support_requests').select('status'),
  ])

  const uMap = new Map((users.data ?? []).map(u => [u.id, u]))
  const bMap = new Map((bookings.data ?? []).map(b => [b.id, b]))
  const cMap = new Map((clubs.data ?? []).map(c => [c.id, c]))

  const requests: SupportRow[] = (rows ?? []).map(r => {
    const u = r.user_id ? uMap.get(r.user_id) : null
    const b = r.booking_id ? bMap.get(r.booking_id) : null
    const c = r.club_id ? cMap.get(r.club_id) : null
    return {
      id: r.id, topic: r.topic, message: r.message, status: r.status,
      created_at: r.created_at, resolved_at: r.resolved_at, night_date: r.night_date,
      contact_email: r.contact_email ?? u?.email ?? null,
      guest_name: u?.full_name ?? null,
      club_name: c?.name ?? null,
      booking_id: r.booking_id,
      booking_ref: b?.qr_code_token ?? null,
      booking_status: b?.status ?? null,
      party_size: b?.party_size ?? null,
    }
  })

  const tally = { open: 0, in_progress: 0, resolved: 0 }
  for (const r of counts.data ?? []) {
    if (r.status in tally) tally[r.status as keyof typeof tally]++
  }

  return ok({ requests, counts: tally, unavailable: false })
}

// PATCH /api/portal/support — { id, status }
export async function PATCH(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  let body: { id?: string; status?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const { id, status } = body
  if (!id) return err('id required', 400)
  if (!status || !['open', 'in_progress', 'resolved'].includes(status)) {
    return err('bad status', 400)
  }

  const sb = await createServiceClient()
  const { error } = await sb
    .from('support_requests')
    .update({
      status,
      // Stamped on the way in, cleared on reopen, so "resolved" always carries
      // a real timestamp rather than a stale one from a previous resolution.
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) return err(error.message)
  return ok({ id, status })
}
