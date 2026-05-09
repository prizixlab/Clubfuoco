import Stripe from 'stripe'
import type { MembershipPlan, OrderSummary } from '@/types'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  typescript: true,
})

export const PLATFORM_FEE_PERCENT = 0.12 // 12% take rate

// Membership plan definitions — prices in euro cents
// NOTE: all perks apply at partner clubs only (is_partner = true)
export const MEMBERSHIP_PLANS: Record<'gold' | 'sapphire' | 'black', MembershipPlan> = {
  gold: {
    tier:            'gold',
    name:            'Gold',
    price_monthly:   1900,  // €19/month
    stripe_price_id: process.env.STRIPE_PRICE_GOLD ?? '',
    perks: [
      'Priority entry at partner clubs',
      '15% discount on bookings at partner clubs',
      'Monthly guest pass (x1)',
      'Early access to event announcements',
    ],
  },
  sapphire: {
    tier:            'sapphire',
    name:            'Sapphire',
    price_monthly:   4900,  // €49/month
    stripe_price_id: process.env.STRIPE_PRICE_SAPPHIRE ?? '',
    perks: [
      '25% discount on bookings at partner clubs',
      'Complimentary guest list access (up to 4×/month)',
      'Personal concierge via WhatsApp',
      'Invite-only afterhours events',
    ],
  },
  black: {
    tier:            'black',
    name:            'Black',
    price_monthly:   50000, // €500/month
    stripe_price_id: process.env.STRIPE_PRICE_BLACK ?? '',
    perks: [
      'Free VIP entry at all partner clubs',
      '30% discount on all bookings at partner clubs',
      'Complimentary guest list access (unlimited)',
      'Dedicated 24/7 concierge',
      'Invite-only afterhours & private events',
      'Early access to every new partner club',
    ],
  },
}

/**
 * Calculates the final order total applying membership discount.
 * @param isPartnerClub  Whether the club is a Club Fuoco partner.
 *                       Benefits only apply at partner clubs.
 */
export function calculateOrderTotal(
  unitPrice:      number,
  partySize:      number,
  membershipTier: string,
  isPartnerClub = false,
): OrderSummary {
  const subtotal = unitPrice * partySize

  // No discount at non-partner clubs — ever
  const discountRate = isPartnerClub
    ? membershipTier === 'black'   ? 0.30 :
      membershipTier === 'sapphire' ? 0.25 :
      membershipTier === 'gold'     ? 0.15 :
      0
    : 0

  const discount    = Math.round(subtotal * discountRate * 100) / 100
  const total       = subtotal - discount
  const platformFee = Math.round(total * PLATFORM_FEE_PERCENT * 100) / 100

  return { subtotal, discount, total, platformFee }
}
