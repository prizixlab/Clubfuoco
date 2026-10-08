// ── What a guest can review ──────────────────────────────────────────────────
//
// The morning-after review used to be booking-only. Guests who got in through
// a Fourvenues link (external_tickets) or a promoter's invite guestlist
// (promoter_guests) are asked too now (20261009b_reviews_any_ticket.sql).
// A review then stores its own club and night, so nothing downstream needs a
// booking row.
//
// Bookings are still listed by the app from its own bookings query; this file
// covers the other two sources.

import type { createServiceClient } from '@/lib/supabase/server'
import { NON_ADMITTING_PAYMENT_LIST } from '@/lib/refunds'

type SB = Awaited<ReturnType<typeof createServiceClient>>

export type ReviewSource = 'fourvenues' | 'invite'

/** Shaped like a booking row so the app's review list and sheet reuse it. */
export interface ReviewTarget {
  id: string
  review_source: ReviewSource
  booking_type: 'general'
  party_size: number
  booking_date: string            // the night
  status: 'confirmed'
  clubs: { id: string; name: string; cover_image_url: string | null; address: string | null; neighborhood: string | null }
  /** The event's own name, when there is one. */
  title: string | null
}

const madridDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })

/**
 * Everything of these two kinds the user hasn't reviewed or dismissed, from 7
 * nights ago to 30 ahead — the app lists the ones from last night back and
 * schedules the 10:00 morning-after notification for the rest.
 */
export async function pendingReviewTargets(sb: SB, userId: string): Promise<ReviewTarget[]> {
  const from = madridDay(-7), to = madridDay(30)
  const out: ReviewTarget[] = []

  // Fourvenues tickets (free lists, tickets, tables) filed to the account.
  const { data: tickets } = await sb
    .from('external_tickets')
    .select('id, club_id, night, heads, event_name, survey_dismissed_at, club:clubs(id, name, cover_image_url, address, neighborhood)')
    .eq('user_id', userId)
    .is('survey_dismissed_at', null)
    .gte('night', from).lte('night', to)
  for (const t of (tickets ?? []) as Record<string, unknown>[]) {
    const club = one(t.club)
    if (!club) continue                        // a night we can't place at a venue
    out.push(target(String(t.id), 'fourvenues', String(t.night), Number(t.heads) || 1, club, (t.event_name as string) ?? null))
  }

  // Invite guestlist spots claimed by this account.
  const { data: guests } = await sb
    .from('promoter_guests')
    .select(`id, plus_ones, survey_dismissed_at,
      allocation:promoter_allocations ( night:promoter_nights ( id, title, night_date,
        club:clubs ( id, name, cover_image_url, address, neighborhood ) ) )`)
    .eq('claimed_by_user', userId)
    .is('survey_dismissed_at', null)
    .or(`payment_status.is.null,payment_status.not.in.${NON_ADMITTING_PAYMENT_LIST}`)
  const nightsWithBooking = new Set<string>()
  {
    // A night reserved in the app already has a booking — and its review.
    const { data: b } = await sb.from('bookings').select('night_id').eq('user_id', userId).not('night_id', 'is', null)
    for (const r of (b ?? []) as { night_id: string }[]) nightsWithBooking.add(r.night_id)
  }
  for (const g of (guests ?? []) as Record<string, unknown>[]) {
    const night = one(one(g.allocation)?.night)
    const club = one(night?.club)
    if (!night || !club || nightsWithBooking.has(String(night.id))) continue
    const date = String(night.night_date)
    if (date < from || date > to) continue
    out.push(target(String(g.id), 'invite', date, 1 + (Number(g.plus_ones) || 0), club, (night.title as string) ?? null))
  }

  if (!out.length) return out
  // Drop the ones already reviewed.
  const [{ data: doneT }, { data: doneG }] = await Promise.all([
    sb.from('booking_surveys').select('external_ticket_id').in('external_ticket_id', out.filter(t => t.review_source === 'fourvenues').map(t => t.id)),
    sb.from('booking_surveys').select('promoter_guest_id').in('promoter_guest_id', out.filter(t => t.review_source === 'invite').map(t => t.id)),
  ])
  const done = new Set([
    ...((doneT ?? []) as { external_ticket_id: string }[]).map(r => r.external_ticket_id),
    ...((doneG ?? []) as { promoter_guest_id: string }[]).map(r => r.promoter_guest_id),
  ])
  return out.filter(t => !done.has(t.id)).sort((a, b) => b.booking_date.localeCompare(a.booking_date))
}

/** The club and night a review of this ticket/spot is about, if it's the user's. */
export async function resolveReviewTarget(
  sb: SB, userId: string, source: ReviewSource, id: string,
): Promise<{ club_id: string | null; night: string } | { error: string; status: number }> {
  if (source === 'fourvenues') {
    const { data } = await sb.from('external_tickets').select('user_id, club_id, night').eq('id', id).maybeSingle()
    if (!data) return { error: 'Ticket not found', status: 404 }
    if (data.user_id !== userId) return { error: 'This ticket belongs to a different account', status: 403 }
    return { club_id: (data.club_id as string | null) ?? null, night: String(data.night) }
  }
  const { data } = await sb.from('promoter_guests')
    .select('claimed_by_user, allocation:promoter_allocations ( night:promoter_nights ( night_date, club_id ) )')
    .eq('id', id).maybeSingle()
  if (!data) return { error: 'Guestlist spot not found', status: 404 }
  if ((data as { claimed_by_user?: string }).claimed_by_user !== userId) {
    return { error: 'This guestlist spot belongs to a different account', status: 403 }
  }
  const night = one(one((data as Record<string, unknown>).allocation)?.night)
  if (!night) return { error: 'Guestlist night not found', status: 404 }
  return { club_id: (night.club_id as string | null) ?? null, night: String(night.night_date) }
}

function target(
  id: string, source: ReviewSource, night: string, party: number, club: Record<string, unknown>, title: string | null,
): ReviewTarget {
  return {
    id, review_source: source, booking_type: 'general', party_size: party, booking_date: night, status: 'confirmed',
    clubs: {
      id: String(club.id), name: String(club.name ?? ''),
      cover_image_url: (club.cover_image_url as string | null) ?? null,
      address: (club.address as string | null) ?? null,
      neighborhood: (club.neighborhood as string | null) ?? null,
    },
    title,
  }
}

function one(v: unknown): Record<string, unknown> | null {
  const x = Array.isArray(v) ? v[0] : v
  return x && typeof x === 'object' ? x as Record<string, unknown> : null
}
