import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { inboxAddress, newInboxToken } from '@/lib/ticket-inbox'

const ACTIVE = process.env.TICKET_INBOX_ACTIVE === 'true'

// GET /api/me/ticket-inbox → { address, active }
//
// The signed-in user's private ticket address, created on first use. The app
// gives this to Fourvenues instead of the account email (see lib/ticket-inbox)
// — but ONLY when `active`: until the tickets. subdomain's MX points at Resend
// and the webhook is set up, mail to these addresses would bounce. Flip
// TICKET_INBOX_ACTIVE=true in Vercel once Resend shows the domain verified.
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const sb = await createServiceClient()
  const { data: existing } = await sb
    .from('ticket_inboxes').select('token').eq('user_id', user!.id).maybeSingle()
  if (existing?.token) return ok({ address: inboxAddress(existing.token), active: ACTIVE })

  // Insert, retrying on the (astronomically unlikely) token collision. A race
  // with a second request for the same user loses on the primary key and
  // reads the winner's token back.
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = newInboxToken()
    const { error } = await sb.from('ticket_inboxes').insert({ user_id: user!.id, token })
    if (!error) return ok({ address: inboxAddress(token), active: ACTIVE })
    if (error.code !== '23505') return err('Could not create ticket inbox', 500)
    const { data: winner } = await sb
      .from('ticket_inboxes').select('token').eq('user_id', user!.id).maybeSingle()
    if (winner?.token) return ok({ address: inboxAddress(winner.token), active: ACTIVE })
  }
  return err('Could not create ticket inbox', 500)
}
