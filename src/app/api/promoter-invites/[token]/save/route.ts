import { createServiceClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { ok, err } from '@/lib/utils'

// Saving an event to come back to — "I want this, not right now."
//
// POST   /api/promoter-invites/<token>/save    → save it
// DELETE /api/promoter-invites/<token>/save    → unsave
//
// A save is a BOOKMARK and nothing else. It holds no spot, grants no entry, and
// creates no promoter_guests row — see 20260820_paid_events.sql for why that
// separation is load-bearing: promoter_guests is the door list, and a
// saved-but-unpaid row in it would eat capacity on a sold-out night, inflate
// the promoter's headcount, and ride into the offline door pack as somebody a
// bouncer can wave through for free.
//
// Requires an account, unlike claiming. There is nowhere to put a bookmark for
// someone who doesn't exist yet.

async function caller(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return { sb, userId: null }
  const { data } = await sb.auth.getUser(bearer)
  return { sb, userId: data.user?.id ?? null }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { sb, userId } = await caller(req)
  if (!userId) return err('Sign in to save an event', 401)

  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  // The permanent series token is stored rather than this week's, so a saved
  // recurring event still resolves after the night rolls over.
  const { error } = await sb
    .from('promoter_saved_events')
    .upsert({
      user_id: userId,
      allocation_id: resolved.allocationId,
      invite_token: resolved.seriesToken ?? token,
    }, { onConflict: 'user_id,allocation_id' })

  if (error) return err(error.message, 500)
  return ok({ saved: true })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { sb, userId } = await caller(req)
  if (!userId) return err('Sign in to save an event', 401)

  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const { error } = await sb
    .from('promoter_saved_events')
    .delete()
    .eq('user_id', userId)
    .eq('allocation_id', resolved.allocationId)

  if (error) return err(error.message, 500)
  return ok({ saved: false })
}
