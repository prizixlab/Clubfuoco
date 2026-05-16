/**
 * Membership tier configuration — single source of truth.
 *
 * On iOS, paid tiers are sold exclusively through Apple In-App Purchase
 * (StoreKit 2) to comply with App Store guideline 3.1.1. The product IDs
 * below MUST match the auto-renewable subscriptions created in
 * App Store Connect (Subscription Group: "Club Fuoco Membership").
 *
 * Stripe is NOT used for memberships. It remains only for real-world
 * services (bookings, event tickets, DJ gig fees) — allowed under 3.1.3(e).
 */

export type PaidTier = 'gold' | 'sapphire' | 'black'
export type Tier     = 'free' | PaidTier

export interface TierConfig {
  tier:       PaidTier
  /** App Store Connect product identifier — auto-renewable subscription. */
  productId:  string
  name:       string
  /** Display price (informational only — the real price comes from StoreKit). */
  priceLabel: string
  /** Rank within the subscription group: higher = better tier. */
  rank:       number
  perks:      string[]
}

export const MEMBERSHIP_TIERS: Record<PaidTier, TierConfig> = {
  gold: {
    tier:       'gold',
    productId:  'com.clubfuoco.app.membership.gold',
    name:       'Gold',
    priceLabel: '€19',
    rank:       1,
    perks: [
      'Priority entry at partner clubs',
      '15% discount on bookings at partner clubs',
      'Monthly guest pass (x1)',
      'Early access to event announcements',
    ],
  },
  sapphire: {
    tier:       'sapphire',
    productId:  'com.clubfuoco.app.membership.sapphire',
    name:       'Sapphire',
    priceLabel: '€49',
    rank:       2,
    perks: [
      '25% discount on bookings at partner clubs',
      'Complimentary guest list access (up to 4×/month)',
      'Personal concierge via WhatsApp',
      'Invite-only afterhours events',
    ],
  },
  black: {
    tier:       'black',
    productId:  'com.clubfuoco.app.membership.black',
    name:       'Black',
    priceLabel: '€500',
    rank:       3,
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

/** All StoreKit product IDs the app should query. */
export const ALL_PRODUCT_IDS = Object.values(MEMBERSHIP_TIERS).map(t => t.productId)

/** Reverse lookup: App Store product ID → tier. */
export function tierForProductId(productId: string): PaidTier | null {
  const match = Object.values(MEMBERSHIP_TIERS).find(t => t.productId === productId)
  return match ? match.tier : null
}
