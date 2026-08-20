import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { stripe } from './stripe'
import { DEFAULT_PLATFORM_FEE_BPS } from './platform-fee'

// ── Stripe Connect — paying promoters without us in the loop ────────────────
//
// Express accounts, destination charges. When a guest pays, the money lands in
// the PROMOTER's Stripe balance minus our application fee, and Stripe pays it
// out to their bank on its own schedule. Nobody at Club Fuoco moves money,
// approves a payout, or reconciles a ledger — which is the requirement.
//
// Express specifically (not Standard, not Custom): Stripe hosts the onboarding
// and runs KYC, so we never see an IBAN or an ID document, and Stripe hosts the
// promoter's own dashboard for payouts and receipts. Custom would put all of
// that on us.

export type PayoutAccount = {
  user_id: string
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  requirements_due: string[]
  disabled_reason: string | null
  country: string | null
  default_currency: string | null
  /** Our cut of a PRIVATE event's sales, in basis points. */
  platform_fee_bps: number
  /** Our cut of a PUBLIC offer's sales. A different deal, so a different rate. */
  platform_fee_public_bps: number
}

const COLUMNS =
  'user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, ' +
  'requirements_due, disabled_reason, country, default_currency, ' +
  'platform_fee_bps, platform_fee_public_bps'

/** The promoter's payout row, creating the local half if it's missing. */
export async function payoutAccount(
  sb: SupabaseClient, userId: string
): Promise<PayoutAccount> {
  const { data } = await sb
    .from('promoter_payout_accounts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (data) return data as unknown as PayoutAccount
  return {
    user_id: userId,
    stripe_account_id: null,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements_due: [],
    disabled_reason: null,
    country: null,
    default_currency: null,
    platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
    platform_fee_public_bps: DEFAULT_PLATFORM_FEE_BPS,
  }
}

/**
 * The rate that applies to one night.
 *
 * Which of the two depends on how the night is sold, not on who sells it: a
 * private event is the promoter's own crowd through their own link, a public
 * offer is an audience we supplied. Falls back to the private rate for a night
 * whose visibility is missing, because link-only is what a promoter night is
 * unless it was deliberately published.
 */
export function feeBpsForVisibility(
  account: PayoutAccount, visibility: string | null | undefined
): number {
  const bps = visibility === 'public'
    ? account.platform_fee_public_bps
    : account.platform_fee_bps
  return Number.isInteger(bps) ? bps : DEFAULT_PLATFORM_FEE_BPS
}

/**
 * The rate to charge this promoter, in basis points.
 *
 * Read at CHARGE time rather than baked into the night when it was priced, so a
 * renegotiated deal applies to the next ticket sold rather than needing every
 * existing event re-saved. The flip side — a rate change moves money on events
 * already on sale — is the behaviour a deal actually wants.
 */
export async function feeBpsFor(sb: SupabaseClient, promoterId: string): Promise<number> {
  const { data } = await sb
    .from('promoter_payout_accounts')
    .select('platform_fee_bps')
    .eq('user_id', promoterId)
    .maybeSingle()
  const bps = (data as { platform_fee_bps?: number } | null)?.platform_fee_bps
  return Number.isInteger(bps) ? bps! : DEFAULT_PLATFORM_FEE_BPS
}

/**
 * The promoter's Stripe account, created on first use.
 *
 * `country` comes from the caller because Stripe fixes it at creation and it
 * can never be changed afterwards — an account made in the wrong country has to
 * be abandoned and rebuilt, taking its KYC with it.
 */
export async function ensureConnectAccount(
  sb: SupabaseClient,
  userId: string,
  opts: { email?: string | null; country?: string | null }
): Promise<string> {
  const existing = await payoutAccount(sb, userId)
  if (existing.stripe_account_id) return existing.stripe_account_id

  const account = await stripe.accounts.create({
    type: 'express',
    country: opts.country || 'ES',
    email: opts.email ?? undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      // Stripe wants an MCC; 7922 is theatrical/event promotion, which is what
      // this is. A wrong MCC can silently raise the risk profile of every
      // charge that follows.
      mcc: '7922',
      product_description: 'Admission to nightlife events promoted via Club Fuoco',
    },
    // Losses on a promoter's charges fall to their balance, not ours.
    settings: { payouts: { schedule: { interval: 'daily', delay_days: 'minimum' } } },
    metadata: { club_fuoco_user_id: userId },
  })

  await sb.from('promoter_payout_accounts').upsert({
    user_id: userId,
    stripe_account_id: account.id,
    country: account.country ?? null,
    default_currency: account.default_currency ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  return account.id
}

/**
 * A fresh hosted-onboarding URL.
 *
 * Single-use and short-lived by Stripe's design, so it is minted per tap rather
 * than stored. `refresh_url` is where Stripe sends someone whose link expired
 * mid-flow — it has to mint another one, or they are stuck on a dead page with
 * their documents half uploaded.
 */
export async function onboardingLink(
  accountId: string, appUrl: string
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    // The account id has to be ON the refresh URL — Stripe does not append it,
    // and the refresh handler has no session to infer it from (the promoter is
    // coming back from Stripe's domain, in whatever browser it opened).
    refresh_url: `${appUrl}/api/promoter/payouts/refresh?account=${encodeURIComponent(accountId)}`,
    return_url: `${appUrl}/payouts/done`,
    type: 'account_onboarding',
  })
  return link.url
}

/** A link into Stripe's own dashboard, where the promoter sees their payouts. */
export async function dashboardLink(accountId: string): Promise<string> {
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

/** Copy Stripe's view of an account into ours. Stripe is the source of truth. */
export async function syncAccount(
  sb: SupabaseClient, account: Stripe.Account
): Promise<void> {
  const userId = account.metadata?.club_fuoco_user_id
  if (!userId) return

  await sb.from('promoter_payout_accounts').upsert({
    user_id: userId,
    stripe_account_id: account.id,
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    // Verbatim from Stripe — currently_due is what actually unblocks them.
    requirements_due: account.requirements?.currently_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
    country: account.country ?? null,
    default_currency: account.default_currency ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

/**
 * Can this promoter be paid right now?
 *
 * Gating on `charges_enabled` rather than `details_submitted`: submitting
 * documents is not the same as Stripe accepting them, and pricing an event on
 * an account Stripe has not cleared means the failure surfaces at a guest's
 * checkout — the worst possible place to find out.
 */
export function canCharge(a: PayoutAccount): boolean {
  return Boolean(a.stripe_account_id) && a.charges_enabled
}
