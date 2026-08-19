import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { billableForKind, isoNoMs, usedForToken, type CredentialKind } from '@/lib/door'
import { eventAccessDenied } from '@/lib/door-events'

// POST /api/door/admit  { scan_id, action, token_ref, count, kind, holder_name, reason? }
//
// Records ONE admission (or void) from the door scanner, for open-access mode
// (no device enrollment — see the door app's AppMode.openAccess). Idempotent on
// scan_id, so a retry from the app's queue can't double-count.
//
// Side effect that matters to promoters: a guestlist admission stamps
// promoter_guests.checked_in_at + checked_in_source='door_scan', which is what
// the promoter app's 15s poll picks up to show the guest as SCANNED IN. A void
// that drops the net count back to zero clears that stamp again.
export async function POST(req: NextRequest) {
  let body: {
    scan_id?: string; action?: 'admit' | 'void'; token_ref?: string
    count?: number; kind?: CredentialKind; holder_name?: string; reason?: string
  }
  try { body = await req.json() } catch { return err('Bad request', 400) }

  const { scan_id, token_ref } = body
  const action = body.action ?? 'admit'
  if (!scan_id || !token_ref) return err('scan_id and token_ref required', 400)
  if (action !== 'admit' && action !== 'void') return err('bad action', 400)

  const supabase = await createServiceClient()

  // Derive club/night from the token itself — never trust the client for the
  // fields the overscan ledger is keyed on.
  const ctx = await tokenContext(supabase, token_ref)
  if (!ctx) return err('Unknown token_ref', 404)

  // The gate that actually stops someone walking guests into a private party.
  // /resolve refuses to identify them; this refuses to admit them.
  const access = await eventAccessDenied(supabase, req, ctx.nightId)
  if (access !== 'ok') {
    return err(
      access === 'needs_code'
        ? 'This door is secured — enter the event code to scan it.'
        : 'That code is for a different event.',
      403,
    )
  }

  const kind = (body.kind ?? 'paid_entry') as CredentialKind
  const row = {
    scan_id,
    club_id: ctx.clubId,
    night_id: ctx.nightId,
    night_date: ctx.night,
    token_ref,
    credential_kind: kind,
    action,
    count: Math.max(1, Math.floor(body.count ?? 1)),
    billable: billableForKind(kind),
    holder_name: body.holder_name ?? null,
    reason: body.reason ?? null,
    device_time: isoNoMs(),
  }
  let { error } = await supabase
    .from('admission_scans')
    .upsert(row, { onConflict: 'scan_id', ignoreDuplicates: true })
  // night_id lands with a manual migration. A club night worked before it and
  // must keep working after — retry without the column rather than turning a
  // deployment-ordering problem into a guest stuck at the door. A night with no
  // club can't be saved this way, but it couldn't be admitted at all before the
  // migration either, so nothing regresses.
  if (error && /night_id|column|schema cache/i.test(error.message ?? '') && ctx.clubId) {
    const { night_id: _dropped, ...lean } = row
    ;({ error } = await supabase
      .from('admission_scans')
      .upsert(lean, { onConflict: 'scan_id', ignoreDuplicates: true }))
  }
  if (error) return err(error.message)

  const used = await usedForToken(supabase, token_ref)

  // Reflect door state onto the guest/booking row the rest of the product reads.
  if (ctx.kind === 'guest') {
    if (used > 0) {
      // checked_in_source lands with a manual migration; fall back to stamping
      // just checked_in_at if it isn't applied yet (prod drifts from /migrations).
      const { error: e1 } = await supabase.from('promoter_guests')
        .update({ checked_in_at: isoNoMs(), checked_in_source: 'door_scan' })
        .eq('id', ctx.id).is('checked_in_at', null)
      if (e1) {
        await supabase.from('promoter_guests')
          .update({ checked_in_at: isoNoMs() })
          .eq('id', ctx.id).is('checked_in_at', null)
      }
    } else {
      // Fully voided — undo only a stamp the door itself made.
      const { error: e2 } = await supabase.from('promoter_guests')
        .update({ checked_in_at: null, checked_in_source: null })
        .eq('id', ctx.id).eq('checked_in_source', 'door_scan')
      if (e2) {
        await supabase.from('promoter_guests')
          .update({ checked_in_at: null }).eq('id', ctx.id)
      }
    }
  } else if (ctx.kind === 'booking') {
    // Flip the booking to 'used' once its allowance is fully consumed — for a
    // single-seat ticket that's the first swipe. Doing it per-head instead would
    // mark a party of 4 used after one person walked in, which is exactly what
    // the count-based model exists to avoid.
    const fullyAdmitted = used > 0 && used >= (ctx.allowed ?? 1)
    if (used > 0) {
      const patch: Record<string, unknown> = { checked_in_at: isoNoMs() }
      if (fullyAdmitted && ctx.status !== 'cancelled') patch.status = 'used'
      await supabase.from('bookings').update(patch).eq('id', ctx.id)
    } else if (ctx.status === 'used') {
      // Fully voided — hand the booking back so it can be scanned again.
      await supabase.from('bookings')
        .update({ status: 'confirmed', checked_in_at: null })
        .eq('id', ctx.id)
    }
  }

  return ok({ recorded: true, token_ref, used })
}

// Local to this route. A `route.ts` may only export the HTTP handlers and
// Next's config constants — a value export like the function below fails the
// build with "does not match the required types of a Next.js Route", and `tsc
// --noEmit` does not catch it because the check lives in Next's generated
// route types, not the app's own tsconfig. Move these to src/lib/door.ts if
// another route ever needs them.
interface TokenContext {
  kind: 'booking' | 'guest'
  id: string
  /** null for a promoter night at a custom location — see nightId. */
  clubId: string | null
  /** The promoter night, when there is one. Bookings are always at a club. */
  nightId: string | null
  night: string
  allowed?: number
  status?: string
  visibility?: 'public' | 'private'
}

/**
 * Resolve the admission scope straight from a token_ref.
 *
 * This used to require a `club_id` and return null without one, which made
 * every custom-location night un-admittable — a 404 "Unknown token_ref" for a
 * perfectly real guest. `promoter_nights.club_id` is nullable by design, and a
 * private event is normally at a warehouse or a roof rather than a club, so the
 * scope is now (club OR night) and the ledger records whichever it has.
 */
async function tokenContext(
  supabase: Awaited<ReturnType<typeof createServiceClient>>, tokenRef: string,
): Promise<TokenContext | null> {
  if (tokenRef.startsWith('bk_')) {
    const id = tokenRef.slice(3)
    const { data } = await supabase
      .from('bookings')
      .select('id, club_id, booking_date, party_size, admissions_allowed, status')
      .eq('id', id).maybeSingle()
    if (!data) return null
    return {
      kind: 'booking', id: data.id, clubId: data.club_id, nightId: null,
      night: data.booking_date,
      allowed: data.admissions_allowed ?? data.party_size ?? 1,
      status: data.status,
    }
  }
  if (tokenRef.startsWith('pg_')) {
    const id = tokenRef.slice(3)
    // visibility lands with a manual migration; a missing column must not stop
    // a guest getting through the door, so fall back to the lean select and
    // treat the night as public (today's behaviour).
    const cols = 'id, payment_status, promoter_allocations(promoter_nights(id, club_id, night_date, visibility))'
    let row = await supabase.from('promoter_guests').select(cols).eq('id', id).maybeSingle()
    if (row.error) {
      row = await supabase.from('promoter_guests')
        .select('id, payment_status, promoter_allocations(promoter_nights(id, club_id, night_date))')
        .eq('id', id).maybeSingle()
    }
    if (!row.data) return null
    // The last line of defence. resolve() refuses an unpaid spot and the night
    // pack no longer seals one in, but admit is what actually WRITES an entry —
    // and a door running an older cached pack, or a hand-made QR built from a
    // guest id the checkout response handed out, must not get through here.
    //
    // Note payment_status stays in BOTH selects above, including the drift
    // fallback: dropping it there to survive a missing column would fail open,
    // which is exactly the bug this closes.
    const pay = (row.data as { payment_status?: string }).payment_status ?? 'free'
    if (pay === 'pending' || pay === 'refunded') return null
    const night = (row.data.promoter_allocations as {
      promoter_nights?: { id?: string; club_id?: string; night_date?: string; visibility?: string }
    } | null)?.promoter_nights
    // A night with neither a club nor an id can't be counted against anything.
    if (!night?.night_date || (!night.club_id && !night.id)) return null
    return {
      kind: 'guest', id: row.data.id as string,
      clubId: night.club_id ?? null,
      nightId: night.id ?? null,
      night: night.night_date,
      visibility: night.visibility === 'private' ? 'private' : 'public',
    }
  }
  return null
}
