import type { createServiceClient } from '@/lib/supabase/server'
import { getPartnerOffers } from '@/lib/partner'
import { offerLiveOn } from '@/lib/valid-days'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// ── What a VIP table costs ───────────────────────────────────────────────────
//
// The price of a Rumbalist VIP table is the supplier's, from partner_offers —
// never the phone's. create-vip-intent used to charge whatever `amount` the
// request carried (anything from €0.50), and confirm-vip booked whatever had
// been paid, so a hand-made request bought a confirmed table for 50 cents.
//
// The client still sends its amount, but only as a claim to check: it must be
// the price of a VIP offer that is live at that club (on that night, when the
// night is known). The feed is the same one the app renders from
// (getPartnerOffers: archived offers, muted suppliers and lost contests are
// already gone), so a guest can only pay a price the app showed them.

export type VipPriceCheck =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'price_changed' }

/** Live VIP prices at this club, in cents. `date` narrows to that night. */
export async function vipPricesCents(sb: SB, clubId: string, date: string | null): Promise<number[]> {
  const offers = await getPartnerOffers(sb, clubId)
  return offers
    .filter(o => o.kind === 'vip_table' && (o.price_eur ?? 0) > 0)
    .filter(o => !date || offerLiveOn(o, date))
    .map(o => Math.round((o.price_eur as number) * 100))
}

export async function checkVipPrice(
  sb: SB, clubId: string, date: string | null, amountCents: number,
): Promise<VipPriceCheck> {
  const prices = await vipPricesCents(sb, clubId, date)
  if (prices.length === 0) return { ok: false, reason: 'unavailable' }
  return prices.includes(amountCents) ? { ok: true } : { ok: false, reason: 'price_changed' }
}

export const VIP_PRICE_MESSAGES: Record<'unavailable' | 'price_changed', string> = {
  unavailable: 'This table isn’t available right now.',
  price_changed: 'This table’s price has changed. Check the new price and try again.',
}
