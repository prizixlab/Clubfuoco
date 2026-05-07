import Stripe from 'stripe'
import type { MembershipPlan, OrderSummary } from '@/types'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  typescript: true,
})

export const PLATFORM_FEE_PERCENT = 0.12 // 12% take rate

// Membership plan definitions — prices in euro cents
export const MEMBERSHIP_PLANS: Record<'gold' | 'sapphire', MembershipPlan> = {
  gold: {
    tier:            'gold',
    name:            'Gold',
    price_monthly:   1900,  // €19/month
    stripe_price_id: process.env.STRIPE_PRICE_GOLD ?? '',
    perks: [
      'Priority entry line at all partner clubs',
      '15% discount on all bookings',
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
      '25% discount on all bookings',
      'Complimentary guestlist access (up to 4x/month)',
      'Personal concierge via WhatsApp',
      'Invite-only afterhours events',
    ],
  },
}

// Calculates final order total applying membership discount
export function calculateOrderTotal(
  unitPrice:       number,
  partySize:       number,
  membershipTier:  string
): OrderSummary {
  const subtotal = unitPrice * partySize

  const discountRate =
    membershipTier === 'sapphire' ? 0.25 :
    membershipTier === 'gold'     ? 0.15 :
    0

  const discount    = Math.round(subtotal * discountRate * 100) / 100
  const total       = subtotal - discount
  const platformFee = Math.round(total * PLATFORM_FEE_PERCENT * 100) / 100

  return { subtotal, discount, total, platformFee }
}
