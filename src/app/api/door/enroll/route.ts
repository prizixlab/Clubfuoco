import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { isoNoMs, newDeviceToken, sha256 } from '@/lib/door'

// POST /api/door/enroll  { code }
// Exchanges a one-time enrollment code (provisioned via POST /api/door/devices)
// for a device bearer token bound to the venue. No Supabase session — the door
// app authenticates as a device from here on. Idempotent-ish: a code is consumed
// on first claim; re-using it 404s.
export async function POST(req: NextRequest) {
  let body: { code?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const code = body.code?.trim().toUpperCase()
  if (!code) return err('Enrollment code required', 400)

  const supabase = await createServiceClient()

  const { data: device } = await supabase
    .from('door_devices')
    .select('id, club_id, enrollment_expires_at, claimed_at, clubs(name)')
    .eq('enrollment_code', code)
    .maybeSingle()

  if (!device || device.claimed_at) return err('That enrollment code wasn’t recognised.', 404)
  if (device.enrollment_expires_at && new Date(device.enrollment_expires_at) < new Date()) {
    return err('That enrollment code has expired.', 410)
  }

  const token = newDeviceToken()
  const { error } = await supabase
    .from('door_devices')
    .update({
      token_hash: sha256(token),
      claimed_at: isoNoMs(),
      enrollment_code: null,          // consume the one-time code
      last_seen_at: isoNoMs(),
    })
    .eq('id', device.id)
  if (error) return err(error.message)

  const club = device.clubs as { name?: string } | null
  return ok({
    device_token: token,
    venue: device.club_id,
    venue_name: club?.name ?? 'Venue',
  })
}
