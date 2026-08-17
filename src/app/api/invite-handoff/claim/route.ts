import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { rateLimit, clientIp } from '@/lib/ratelimit'
import { fingerprint, normaliseOsVersion } from '@/lib/invite-handoff'

// POST /api/invite-handoff/claim  { os_version }
//
// Called ONCE, on the app's first launch, to ask "was this install started from
// an invite link?". Returns the token if a ticket from the same coarse
// fingerprint is still open.
//
// What the caller may do with the answer is narrow, and the narrowness is the
// safety property: PRE-FILL the invite screen. Never claim, never join, never
// charge. A wrong match then costs someone one wrong event page.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  // Tighter than recording: a legitimate app asks exactly once per install, so
  // repeated claims from one address are someone walking the table.
  if (!rateLimit(`handoff-claim:${ip}`, 10, 60_000)) return err('Slow down', 429)

  let body: { os_version?: unknown }
  try { body = await req.json() } catch { body = {} }

  const fp = fingerprint(ip, normaliseOsVersion(body.os_version))
  const sb = await createServiceClient()

  // Newest first: someone who tapped two invites gets the one they most
  // recently acted on, which is the one they are waiting to see.
  const { data } = await sb
    .from('invite_handoffs')
    .select('id, token')
    .eq('fingerprint', fp)
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return ok({ token: null })

  // Burn it. A ticket that survived its claim would hand the same invite to
  // every later install behind the same NAT.
  const { data: burned } = await sb
    .from('invite_handoffs')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('claimed_at', null)      // lost a race → somebody else already took it
    .select('id')
    .maybeSingle()

  if (!burned) return ok({ token: null })

  return ok({ token: data.token })
}
