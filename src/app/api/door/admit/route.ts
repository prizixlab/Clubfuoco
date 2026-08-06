import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { billableForKind, isoNoMs, usedForToken, type CredentialKind } from '@/lib/door'

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

  const kind = (body.kind ?? 'paid_entry') as CredentialKind
  const { error } = await supabase
    .from('admission_scans')
    .upsert({
      scan_id,
      club_id: ctx.clubId,
      night_date: ctx.night,
      token_ref,
      credential_kind: kind,
      action,
      count: Math.max(1, Math.floor(body.count ?? 1)),
      billable: billableForKind(kind),
      holder_name: body.holder_name ?? null,
      reason: body.reason ?? null,
      device_time: isoNoMs(),
    }, { onConflict: 'scan_id', ignoreDuplicates: true })
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

/** Resolve club_id + night_date (and row id) straight from a token_ref. */
async function tokenContext(
  supabase: Awaited<ReturnType<typeof createServiceClient>>, tokenRef: string,
): Promise<{
  kind: 'booking' | 'guest'; id: string; clubId: string; night: string
  allowed?: number; status?: string
} | null> {
  if (tokenRef.startsWith('bk_')) {
    const id = tokenRef.slice(3)
    const { data } = await supabase
      .from('bookings')
      .select('id, club_id, booking_date, party_size, admissions_allowed, status')
      .eq('id', id).maybeSingle()
    if (!data) return null
    return {
      kind: 'booking', id: data.id, clubId: data.club_id, night: data.booking_date,
      allowed: data.admissions_allowed ?? data.party_size ?? 1,
      status: data.status,
    }
  }
  if (tokenRef.startsWith('pg_')) {
    const id = tokenRef.slice(3)
    const { data } = await supabase
      .from('promoter_guests')
      .select('id, promoter_allocations(promoter_nights(club_id, night_date))')
      .eq('id', id).maybeSingle()
    if (!data) return null
    const night = (data.promoter_allocations as { promoter_nights?: { club_id?: string; night_date?: string } } | null)?.promoter_nights
    if (!night?.club_id || !night?.night_date) return null
    return { kind: 'guest', id: data.id, clubId: night.club_id, night: night.night_date }
  }
  return null
}
