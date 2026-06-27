import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/** Billing status for the signed-in promoter: card on file + balance + gate. */
export async function GET(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  const user = userResp.user
  if (!user) return err('Unauthorized', 401)

  const { data: acct } = await sb
    .from('promoter_billing_accounts')
    .select('card_verified, card_brand, card_last4, balance_cents, status')
    .eq('user_id', user.id)
    .maybeSingle()

  return ok({
    cardVerified: acct?.card_verified ?? false,
    cardBrand:    acct?.card_brand ?? null,
    cardLast4:    acct?.card_last4 ?? null,
    balanceCents: acct?.balance_cents ?? 0,
    status:       acct?.status ?? 'active',
  })
}
