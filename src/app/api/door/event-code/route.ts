import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { rateLimit, clientIp } from '@/lib/ratelimit'
import { redeemDoorCode } from '@/lib/door-events'

// POST /api/door/event-code  { code, label?, device_model? }
//
// A door team types the promoter's six-character event code and gets back a
// bearer token scoped to that ONE night. It is the private-event counterpart to
// /api/door/enroll: that binds a device to a venue, this binds a device to an
// event — which is what a private party at a warehouse actually has.
//
// Unauthenticated by necessity (the door app has no user login) and safe to be:
// the code IS the credential, redemption is rate-limited, and what a session
// unlocks is a night pack whose entries are each sealed against the guest's own
// QR. A stolen code buys the ability to admit, not a guest list.
export async function POST(req: NextRequest) {
  // 5 attempts a minute. At 31^6 ≈ 8.9e8 codes that is ~340 years of guessing
  // per code-space sweep — and a door team fat-fingering a real code twice is
  // nowhere near the ceiling.
  if (!rateLimit(`door-code:${clientIp(req)}`, 5, 60_000)) {
    return err('Too many attempts. Wait a minute and try again.', 429)
  }

  let body: { code?: string; label?: string; device_model?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  if (!body.code?.trim()) return err('Event code required', 400)

  const sb = await createServiceClient()
  const session = await redeemDoorCode(sb, body.code, {
    label: body.label ?? null,
    deviceModel: body.device_model ?? null,
  })

  // One message for every failure — unknown code, inactive series, nothing on
  // tonight. Distinguishing them would confirm to a guesser that a code exists,
  // which is the one bit worth protecting here.
  if (!session) return err('That event code wasn’t recognised.', 404)

  return ok({
    event_token: session.token,
    night_id: session.nightId,
    night_date: session.nightDate,
    event_name: session.eventName,
    expires_at: session.expiresAt,
  })
}
