import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'
import {
  parseFeePercent, formatFeeBps, DEFAULT_PLATFORM_FEE_BPS,
} from '@/lib/platform-fee'

// PATCH /api/portal/promoters/:id/fee   { percent: "10" | "7.5" | "0", note?: string }
// GET   /api/portal/promoters/:id/fee
//
// The rate Club Fuoco takes from this promoter's ticket sales. Default 12%;
// adjusted here when a deal is signed.
//
// `:id` is a promoter_applications id, matching the sibling route, because the
// portal's promoter list is built from applications.
//
// Every change is audited. This directly changes how much money a person
// receives, so "who dropped Nova to 5%, and when" has to be answerable later —
// and a note field exists so the answer can include why.

/**
 * Accepts EITHER an application id or a user id.
 *
 * The sibling routes key on promoter_applications.id, because the portal's
 * roster was originally built from applications. But the rate lives on the
 * USER, and the roster also emits rows for brands that never applied — those
 * carry application_id null, so an application id is not something the client
 * can always supply. The fee control therefore sends the user id, and this
 * accepts both rather than forcing one convention onto a list that has two.
 */
/**
 * The GET response, exported so the portal control imports it instead of
 * hand-writing a duplicate.
 *
 * It previously declared `percent` while this route returned `fee_percent`.
 * api<T>() is an unchecked cast, so that was not a compile error — it was
 * `undefined` at runtime, and calling .trim() on it crashed the whole portal
 * page. Sharing the type makes that class of drift impossible.
 */
export type FeeResponse = {
  fee_bps: number
  fee_percent: string
  public_fee_bps: number
  public_percent: string
  note: string | null
  public_note: string | null
  is_default: boolean
  updated_at: string | null
  onboarded: boolean
  charges_enabled: boolean
  payouts_enabled: boolean
}

async function resolveUser(
  sb: Awaited<ReturnType<typeof createServiceClient>>, id: string
): Promise<string | null> {
  const { data: app } = await sb
    .from('promoter_applications')
    .select('user_id')
    .eq('id', id)
    .maybeSingle()
  const fromApp = (app as { user_id?: string } | null)?.user_id
  if (fromApp) return fromApp

  const { data: user } = await sb
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  return (user as { id?: string } | null)?.id ?? null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const sb = await createServiceClient()
  const userId = await resolveUser(sb, id)
  if (!userId) return err('Application not found', 404)

  const { data } = await sb
    .from('promoter_payout_accounts')
    .select('platform_fee_bps, platform_fee_public_bps, fee_note, fee_note_public, fee_updated_at, charges_enabled, payouts_enabled, stripe_account_id')
    .eq('user_id', userId)
    .maybeSingle()

  const bps = (data as { platform_fee_bps?: number } | null)?.platform_fee_bps
    ?? DEFAULT_PLATFORM_FEE_BPS

  const pubBps = (data as { platform_fee_public_bps?: number } | null)?.platform_fee_public_bps
  const body: FeeResponse = {
    fee_bps: bps,
    public_fee_bps: Number.isInteger(pubBps) ? pubBps! : DEFAULT_PLATFORM_FEE_BPS,
    public_percent: formatFeeBps(Number.isInteger(pubBps) ? pubBps! : DEFAULT_PLATFORM_FEE_BPS),
    public_note: (data as { fee_note_public?: string } | null)?.fee_note_public ?? null,
    fee_percent: formatFeeBps(bps),
    is_default: bps === DEFAULT_PLATFORM_FEE_BPS,
    note: (data as { fee_note?: string } | null)?.fee_note ?? null,
    updated_at: (data as { fee_updated_at?: string } | null)?.fee_updated_at ?? null,
    // So the portal can say whether this promoter can actually be paid yet.
    onboarded: Boolean((data as { stripe_account_id?: string } | null)?.stripe_account_id),
    charges_enabled: (data as { charges_enabled?: boolean } | null)?.charges_enabled ?? false,
    payouts_enabled: (data as { payouts_enabled?: boolean } | null)?.payouts_enabled ?? false,
  }
  return ok(body)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Bad request')
  // Which deal is being repriced. Defaults to private so an older caller that
  // predates the split keeps changing the rate it always changed.
  const kind = body.kind === 'public' ? 'public' : 'private'
  if (typeof body.percent !== 'string') return err('percent is required, e.g. "10" or "7.5"')

  const bps = parseFeePercent(body.percent)
  if (bps === null) {
    return err('Rate must be a number between 0 and 100, with at most two decimals (e.g. 10, 7.5, 0).')
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) || null : null

  const sb = await createServiceClient()
  const userId = await resolveUser(sb, id)
  if (!userId) return err('Application not found', 404)

  const { data: before } = await sb
    .from('promoter_payout_accounts')
    .select('platform_fee_bps')
    .eq('user_id', userId)
    .maybeSingle()
  const prevRow = before as { platform_fee_bps?: number; platform_fee_public_bps?: number } | null
  const previous = (kind === 'public' ? prevRow?.platform_fee_public_bps : prevRow?.platform_fee_bps)
    ?? DEFAULT_PLATFORM_FEE_BPS

  // Upsert: a promoter can be given a negotiated rate before they have ever
  // opened the payouts screen, which is exactly when a deal gets signed.
  const { error } = await sb
    .from('promoter_payout_accounts')
    .upsert({
      user_id: userId,
      ...(kind === 'public'
        ? { platform_fee_public_bps: bps, fee_note_public: note }
        : { platform_fee_bps: bps, fee_note: note }),
      fee_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (error) return err(error.message, 500)

  await logAudit(sb, {
    action: 'promoter.fee_changed',
    summary: `${kind === 'public' ? 'Public offer' : 'Private event'} rate `
      + `${formatFeeBps(previous)} → ${formatFeeBps(bps)}${note ? ` — ${note}` : ''}`,
    target_type: 'promoter',
    target_id: userId,
    meta: { kind, from_bps: previous, to_bps: bps, note },
  })

  return ok({
    kind,
    fee_bps: bps,
    fee_percent: formatFeeBps(bps),
    is_default: bps === DEFAULT_PLATFORM_FEE_BPS,
    previous_percent: formatFeeBps(previous),
    note,
  })
}
