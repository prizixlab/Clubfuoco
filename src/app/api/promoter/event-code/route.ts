import { NextRequest } from 'next/server'
import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { generateDoorCode, revokeSessionsForCode } from '@/lib/door-events'

// The promoter's side of the event code: read it, create it, rotate it.
//
// Caller-scoped like /api/promoter/pass-theme — the night or series id is
// checked against the caller's ownership, so a promoter can only ever address
// an event that is theirs.
//
// GET    ?night=<id> | ?series=<id>   → the code, or none
// POST   { night_id | series_id, rotate? }  → create, or rotate + revoke doors
// DELETE ?night=<id> | ?series=<id>   → remove the code, revoke every door

type SB = NonNullable<Awaited<ReturnType<typeof resolvePromoterCaller>>['sb']>

/**
 * Does this promoter own the event?
 *
 * Ownership of a night runs through `promoter_allocations.promoter_id` rather
 * than a column on the night: nights materialized from a series by the service
 * role carry `created_by = null`, so the allocation is the only reliable owner.
 */
async function owns(
  sb: SB, userId: string, nightId: string | null, seriesId: string | null,
): Promise<boolean> {
  if (seriesId) {
    const { data } = await sb.from('promoter_series')
      .select('id').eq('id', seriesId).eq('promoter_id', userId).maybeSingle()
    return Boolean(data)
  }
  if (nightId) {
    const { data } = await sb.from('promoter_allocations')
      .select('id').eq('night_id', nightId).eq('promoter_id', userId).maybeSingle()
    return Boolean(data)
  }
  return false
}

/** `?night=` / `?series=` on a GET or DELETE. */
function scopeOf(req: NextRequest) {
  return {
    nightId: req.nextUrl.searchParams.get('night'),
    seriesId: req.nextUrl.searchParams.get('series'),
  }
}

export async function GET(req: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const { nightId, seriesId } = scopeOf(req)
  if (!nightId && !seriesId) return err('night or series required', 400)
  if (!(await owns(sb, userId, nightId, seriesId))) return err('Forbidden', 403)

  const q = sb.from('promoter_door_codes').select('id, code, rotated_at')
  const { data } = seriesId
    ? await q.eq('series_id', seriesId).maybeSingle()
    : await q.eq('night_id', nightId!).maybeSingle()

  if (!data) return ok({ code: null })

  // How many doors are live on this code right now — the number that tells a
  // promoter whether rotating is safe or is about to lock out their own team
  // mid-shift.
  const { count } = await sb
    .from('door_event_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('code_id', data.id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())

  return ok({ code: data.code, rotated_at: data.rotated_at, active_doors: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  let body: { night_id?: string; series_id?: string; rotate?: boolean }
  try { body = await req.json() } catch { return err('Bad request', 400) }

  const nightId = body.night_id ?? null
  const seriesId = body.series_id ?? null
  if (!nightId && !seriesId) return err('night_id or series_id required', 400)
  if (nightId && seriesId) return err('Pass a night or a series, not both', 400)
  if (!(await owns(sb, userId, nightId, seriesId))) return err('Forbidden', 403)

  const match = seriesId ? { series_id: seriesId } : { night_id: nightId! }
  const { data: existing } = await sb
    .from('promoter_door_codes').select('id, code').match(match).maybeSingle()

  if (existing && !body.rotate) return ok({ code: existing.code, created: false })

  // Retry on the unique-code index. Two collisions in a row across 8.9e8
  // combinations is not a scenario worth engineering past, but a silent 23505
  // surfacing as "couldn't create" would be maddening to debug.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateDoorCode()
    const { error } = existing
      ? await sb.from('promoter_door_codes')
          .update({ code, rotated_at: new Date().toISOString() }).eq('id', existing.id)
      : await sb.from('promoter_door_codes')
          .insert({ promoter_id: userId, ...match, code })

    if (error?.code === '23505') continue
    if (error) return err(error.message, 500)

    // Rotation is only meaningful if it locks out the doors holding the old
    // code — otherwise a promoter who suspects a leak changes the number on
    // their screen and nothing else.
    if (existing) await revokeSessionsForCode(sb, existing.id)
    return ok({ code, created: !existing, rotated: Boolean(existing) })
  }
  return err('Could not allocate a code, try again', 500)
}

export async function DELETE(req: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const { nightId, seriesId } = scopeOf(req)
  if (!nightId && !seriesId) return err('night or series required', 400)
  if (!(await owns(sb, userId, nightId, seriesId))) return err('Forbidden', 403)

  const match = seriesId ? { series_id: seriesId } : { night_id: nightId! }
  const { data: existing } = await sb
    .from('promoter_door_codes').select('id').match(match).maybeSingle()
  if (!existing) return ok({ cleared: true })

  // Revoke BEFORE deleting: door_event_sessions.code_id is ON DELETE CASCADE,
  // so dropping the row first would take the sessions with it and lose the
  // record that they were ever revoked.
  await revokeSessionsForCode(sb, existing.id)
  const { error } = await sb.from('promoter_door_codes').delete().eq('id', existing.id)
  if (error) return err(error.message, 500)
  return ok({ cleared: true })
}
