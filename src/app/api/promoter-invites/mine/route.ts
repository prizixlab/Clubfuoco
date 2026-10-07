import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { NON_ADMITTING_PAYMENT_LIST } from '@/lib/refunds'
import { refundQuote } from '@/lib/ticket-refund'

/**
 * Returns every promoter-invite this user has claimed (joined to allocation
 * → night → club). Consumed by the consumer Fuoco app's Bookings/Tickets tab.
 * Service role under the hood; caller identified by Bearer token.
 */
export async function GET(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp, error: userErr } = await sb.auth.getUser(bearer)
  if (userErr || !userResp.user) return err('Unauthorized', 401)

  const select = `
      id, full_name, plus_ones, checked_in_at, created_at, payment_status, amount_cents,
      claimed_by_user, purchased_by_user,
      allocation:promoter_allocations (
        id, invite_token, spots,
        night:promoter_nights (
          id, title, night_date, open_time, close_time,
          location_name, address, photo_urls, lineup, hosts,
          club:clubs ( id, name, address, neighborhood, cover_image_url )
        )
      )
    `
  const { data, error } = await sb
    .from('promoter_guests')
    .select(select)
    .eq('claimed_by_user', userResp.user.id)
    // A ticket, not a hold. Opening a paid night's checkout and backing out
    // leaves a 'pending' row for the length of the hold; listed here, the app
    // drew it as a ticket with a QR (that the door then refused) instead of
    // leaving the guest on "Save it, pay later". Refunded spots aren't
    // tickets either. null = written before payment_status existed (free).
    .or(`payment_status.is.null,payment_status.not.in.${NON_ADMITTING_PAYMENT_LIST}`)
    .order('created_at', { ascending: false })

  if (error) return err('Failed to load invites', 500)

  // Tickets this user bought for other people and hasn't sent on yet
  // (claimed_by_user still null). Opt-in with ?include=held: a build that
  // predates multi-ticket purchases would take them for its own ticket.
  // Before the 20261007 migration the column is missing and this quietly
  // returns nothing.
  let held: unknown[] = []
  if (new URL(req.url).searchParams.get('include') === 'held') {
    const { data: rows } = await sb
      .from('promoter_guests')
      .select(select)
      .eq('purchased_by_user', userResp.user.id)
      .is('claimed_by_user', null)
      .or(`payment_status.is.null,payment_status.not.in.${NON_ADMITTING_PAYMENT_LIST}`)
      .order('created_at', { ascending: false })
    held = (rows ?? []).map(r => ({ ...(r as object), held_for_other: true }))
  }

  // What the Refund button would give back, when this account may refund
  // this ticket right now (lib/ticket-refund). Absent = no button.
  const userId = userResp.user.id
  const invites = [...(data ?? []), ...held].map(r => {
    const row = r as Parameters<typeof refundQuote>[0] & {
      allocation?: { night?: { night_date: string; open_time: string | null } | null } | null
    }
    const night = row.allocation?.night
    const quote = night ? refundQuote(row, night, userId) : null
    return { ...(r as object), refund_cents: quote?.ok ? quote.refundCents : null }
  })

  return ok({ invites })
}
