import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireRole } from '@/lib/auth'
import { newEnrollmentCode, isoNoMs } from '@/lib/door'

// Device provisioning — the gated creation path for enrollment codes. This is
// where real club_staff auth lives (the door app itself has none). A staff
// member creates a device row for their club and hands the returned one-time
// code to the physical device, which claims it via POST /api/door/enroll.
//
// POST /api/door/devices     { club_id, label? }  → { enrollment_code, … }
// GET  /api/door/devices?club_id=…                → list devices for a club
export async function POST(req: NextRequest) {
  const { user, response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  let body: { club_id?: string; label?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  if (!body.club_id) return err('club_id required', 400)

  const supabase = await createServiceClient()

  // A non-admin may only provision devices for a club they staff.
  const authed = await staffsClub(supabase, user!.id, body.club_id)
  if (!authed) return err('Forbidden', 403)

  const code = newEnrollmentCode()
  const expires = new Date(Date.now() + 24 * 3600 * 1000)   // 24h to claim
  const { data, error } = await supabase
    .from('door_devices')
    .insert({
      club_id: body.club_id,
      label: body.label ?? null,
      enrollment_code: code,
      enrollment_expires_at: isoNoMs(expires),
      created_by: user!.id,
    })
    .select('id, club_id, label, created_at')
    .single()
  if (error) return err(error.message)

  return ok({
    device: data,
    enrollment_code: code,
    enrollment_expires_at: isoNoMs(expires),
  }, 201)
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response
  const clubId = req.nextUrl.searchParams.get('club_id')
  if (!clubId) return err('club_id required', 400)

  const supabase = await createServiceClient()
  if (!(await staffsClub(supabase, user!.id, clubId))) return err('Forbidden', 403)

  const { data, error } = await supabase
    .from('door_devices')
    .select('id, label, claimed_at, last_seen_at, revoked_at, created_at')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok({ devices: data })
}

// admin bypasses the club check; everyone else must have a club_staff row (or
// own the club) for that club_id.
async function staffsClub(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string, clubId: string,
): Promise<boolean> {
  const { data: profile } = await supabase.from('users').select('role').eq('id', userId).single()
  if (profile?.role === 'admin') return true
  const [{ data: staff }, { data: club }] = await Promise.all([
    supabase.from('club_staff').select('id').eq('user_id', userId).eq('club_id', clubId).maybeSingle(),
    supabase.from('clubs').select('id').eq('id', clubId).eq('owner_user_id', userId).maybeSingle(),
  ])
  return Boolean(staff || club)
}
