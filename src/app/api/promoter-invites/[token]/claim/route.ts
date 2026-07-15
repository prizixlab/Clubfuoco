import { createServiceClient, createClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { ok, err } from '@/lib/utils'

/**
 * Public claim endpoint for promoter invite links.
 * Anyone with a valid token can claim a spot — we mint a promoter_guests row
 * stamped with `created_via_invite = true`. Service role so anon visitors
 * write past RLS.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const plusOnes = Math.max(0, Math.min(10, Number(body.plus_ones) || 0))
  // Optional: did the guest agree to share location for auto check-in?
  // Tri-state — absent stays null (the invite page doesn't ask yet).
  const locationConsent = typeof body.location_consent === 'boolean' ? body.location_consent : null

  if (!fullName) return err('Name is required', 400)

  const sb = await createServiceClient()

  // Identify the claimer from the Bearer token if present. NEVER trust a
  // user id from the request body — that lets a caller attribute a claim to
  // any victim. Anonymous (Instagram webview, no session) claims are allowed
  // and simply have a null claimed_by_user.
  let claimedByUser: string | null = null
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer) {
    // Native app: Bearer token.
    const { data: userResp } = await sb.auth.getUser(bearer)
    claimedByUser = userResp.user?.id ?? null
  } else {
    // Web: cookie session (logged-in Safari). Anonymous webview → stays null.
    const cookieClient = await createClient()
    const { data: { user } } = await cookieClient.auth.getUser()
    claimedByUser = user?.id ?? null
  }

  // Resolve one-off OR permanent series token → the concrete night's allocation.
  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const { data: alloc, error: allocErr } = await sb
    .from('promoter_allocations')
    .select('id, spots, night:promoter_nights(max_plus_ones), promoter_guests(id, full_name, plus_ones, claimed_by_user)')
    .eq('id', resolved.allocationId)
    .single()

  if (allocErr || !alloc) return err('Invite not found', 404)

  // Enforce the per-guest plus-one cap (null = no limit).
  const nightRow = Array.isArray(alloc.night) ? alloc.night[0] : alloc.night
  const maxPlus = (nightRow as { max_plus_ones: number | null } | null)?.max_plus_ones
  const cappedPlusOnes = maxPlus == null ? plusOnes : Math.min(plusOnes, maxPlus)

  // Dedupe: a logged-in user who re-taps their link gets their existing row
  // back instead of a second claim (which would double-count capacity).
  if (claimedByUser) {
    const existing = (alloc.promoter_guests ?? []).find(
      (g: { claimed_by_user: string | null }) => g.claimed_by_user === claimedByUser)
    if (existing) return ok({ guest: existing, alreadyClaimed: true })
  }

  const used = (alloc.promoter_guests ?? []).reduce(
    (s: number, g: { plus_ones: number }) => s + 1 + g.plus_ones, 0)
  if (used + 1 + cappedPlusOnes > alloc.spots) return err('Not enough spots left', 409)

  const row: Record<string, unknown> = {
    allocation_id: alloc.id,
    full_name: fullName,
    plus_ones: cappedPlusOnes,
    created_via_invite: true,
    claimed_by_user: claimedByUser,
    referral_id: resolved.referralId,   // tag the staff member who brought them
  }
  if (locationConsent !== null) row.location_consent = locationConsent

  let { data: guest, error: insertErr } = await sb
    .from('promoter_guests')
    .insert(row)
    .select('id, full_name, plus_ones')
    .single()

  // Drift-defensive: location_consent ships in a manual migration — a claim
  // must never fail because that column isn't applied yet.
  if (insertErr && 'location_consent' in row
      && /location_consent|column|schema cache/i.test(insertErr.message ?? '')) {
    delete row.location_consent
    ;({ data: guest, error: insertErr } = await sb
      .from('promoter_guests')
      .insert(row)
      .select('id, full_name, plus_ones')
      .single())
  }

  // 23505 = unique_violation from the partial index (race between the dedupe
  // check above and insert). Fetch and return the winning row.
  if (insertErr?.code === '23505' && claimedByUser) {
    const { data: winner } = await sb
      .from('promoter_guests')
      .select('id, full_name, plus_ones')
      .eq('allocation_id', alloc.id)
      .eq('claimed_by_user', claimedByUser)
      .single()
    if (winner) return ok({ guest: winner, alreadyClaimed: true })
  }
  // 23514 = check_violation raised by the capacity trigger (lost the race for
  // the last spot). The app-level check above is the friendly path; this is
  // the atomic backstop.
  if (insertErr?.code === '23514') return err('Not enough spots left', 409)
  if (insertErr || !guest) return err('Couldn\'t add you to the list', 500)
  return ok({ guest })
}
