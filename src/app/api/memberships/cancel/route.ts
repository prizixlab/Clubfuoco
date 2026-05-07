import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'

// POST /api/memberships/cancel
export async function POST() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data: membership, error } = await supabase
    .from('memberships')
    .select('stripe_subscription_id, status')
    .eq('user_id', user!.id)
    .single()

  if (error || !membership) return err('No active membership found', 404)
  if (membership.status === 'cancelled') return err('Already cancelled', 400)

  // Cancel at period end in Stripe (user keeps access until billing cycle ends)
  if (membership.stripe_subscription_id) {
    await stripe.subscriptions.update(membership.stripe_subscription_id, {
      cancel_at_period_end: true,
    })
  }

  await supabase
    .from('memberships')
    .update({ status: 'cancelled' })
    .eq('user_id', user!.id)

  await supabase
    .from('users')
    .update({ membership_tier: 'free' })
    .eq('id', user!.id)

  return ok({ cancelled: true })
}
