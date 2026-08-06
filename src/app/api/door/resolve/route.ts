import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { resolveDescriptor } from '@/lib/door'

// POST /api/door/resolve  { payload }
// Live per-scan resolution for OPEN-ACCESS mode: the door scans a QR (a URL like
// <app>/verify/<token>, or fuoco-invite:<guestId>, or a bare token), and this
// looks it up in the live tables and returns the uniform Access Descriptor.
//
// Deliberately UNauthenticated while there are no partner clubs — anyone with
// the app can scan (the product decision: "just allow anyone to scan/void"). It
// reads via the service role (bookings/promoter_guests sit behind RLS), and is
// read-only: admissions are recorded separately via /sync.
export async function POST(req: NextRequest) {
  let body: { payload?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const payload = body.payload?.trim()
  if (!payload) return err('payload required', 400)

  const supabase = await createServiceClient()
  const descriptor = await resolveDescriptor(supabase, payload)

  if (!descriptor) {
    // Unknown code — return an explicit invalid descriptor the app can render.
    return ok({
      holder_name: 'Unknown code',
      holder_avatar_url: null,
      kind: 'paid_entry',
      entitlement: { label: payload.slice(0, 32), count: 0, extras: [] },
      allowance: { used: 0, allowed: 0 },
      status: 'invalid',
      venue: '',
      venue_name: '',
      night: '',
      token_ref: `invalid-${payload.slice(0, 40)}`,
    })
  }
  return ok(descriptor)
}
