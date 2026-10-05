// What Club Fuoco keeps from a paid spot.
//
// Kept apart from the Stripe client so it can be tested without a network, a
// key, or a mock — this is the one calculation in the codebase whose bugs are
// denominated in other people's money.

// Two standing rates, because a public offer and a private event are two
// different deals (see 20260822_split_fee_by_event_kind.sql):
//
//   PRIVATE EVENT — the promoter's own crowd arriving through their own link.
//   We supply the rails, so we take 12%.
//
//   PUBLIC OFFER — listed in the app, so WE supply the audience and the
//   discovery. We take 50%.
//
// Both are only defaults. A signed deal is written per promoter in the portal
// and always wins; these are what applies until someone decides otherwise.

/** Private-event rate every promoter starts on: 12%. */
export const DEFAULT_PLATFORM_FEE_BPS = 1200

/** Public-offer rate every promoter starts on: 50%. */
export const DEFAULT_PUBLIC_PLATFORM_FEE_BPS = 5000

/** The standing rate for a night, by how it is sold. */
export function defaultFeeBpsFor(kind: 'private' | 'public'): number {
  return kind === 'public' ? DEFAULT_PUBLIC_PLATFORM_FEE_BPS : DEFAULT_PLATFORM_FEE_BPS
}

/** Basis points: 1200 = 12.00%. Integers all the way down, so no float ever
 *  touches a currency amount. */
export const BPS_DIVISOR = 10_000

export class FeeError extends Error {}

/**
 * Our cut of `amountCents`, in whole cents.
 *
 * ROUNDS DOWN, deliberately. The promoter is paid `amount - fee`, so any cent
 * lost to rounding lands on our side of the line rather than theirs. Over a
 * season of 3-euro-something fees that is a rounding policy someone would
 * otherwise notice, and it should never be us who benefits from the ambiguity.
 *
 * Throws rather than clamping on bad input: a negative price or a rate above
 * 100% means something upstream is wrong, and quietly charging a plausible
 * number is worse than failing before the guest is asked to pay.
 */
export function platformFeeCents(amountCents: number, feeBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new FeeError(`amountCents must be a non-negative integer, got ${amountCents}`)
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > BPS_DIVISOR) {
    throw new FeeError(`feeBps must be an integer in 0…${BPS_DIVISOR}, got ${feeBps}`)
  }
  return Math.floor((amountCents * feeBps) / BPS_DIVISOR)
}

/** What actually reaches the promoter. Never negative, never above the charge. */
export function promoterTakeCents(amountCents: number, feeBps: number): number {
  return amountCents - platformFeeCents(amountCents, feeBps)
}

/** "12%", "7.5%", "0%" — trailing zeros trimmed, for the portal and the app. */
export function formatFeeBps(bps: number): string {
  const pct = bps / 100
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`
}

/**
 * Parse a rate typed by a human in the portal ("10", "7.5", "12%") into bps.
 * Null when it isn't a rate we're willing to store.
 */
export function parseFeePercent(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, '').trim()
  if (!cleaned) return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null
  const pct = Number(cleaned)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
  // Two decimal places is exactly the bps grid, so this is lossless — but
  // round anyway rather than trusting float multiplication (7.5 * 100 is not
  // always 750 in IEEE-754 land).
  return Math.round(pct * 100)
}
