import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { ok, err } from '@/lib/utils'
import { rateLimit, clientIp } from '@/lib/ratelimit'
import {
  fingerprint, osVersionFromUA, looksLikeIOS, HANDOFF_TTL_MINUTES,
} from '@/lib/invite-handoff'

// POST /api/invite-handoff  { token }
//
// Recorded by the invite page immediately before it sends someone to the App
// Store, so the app can pick the invite back up on first launch. See
// src/lib/invite-handoff.ts for why this is a guess and why a guess is allowed.
//
// Unauthenticated by necessity — the whole point is that this person has no
// account yet and no app.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  // Generous: a real visitor fires this once, but a shared NAT is exactly the
  // population this feature exists for, so the cap can't be per-person tight.
  if (!rateLimit(`handoff:${ip}`, 20, 60_000)) return err('Slow down', 429)

  let body: { token?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const token = body.token?.trim()
  if (!token) return err('token required', 400)

  const ua = req.headers.get('user-agent')
  // Only iOS installs can ever claim a ticket. Recording anything else adds
  // rows that cannot match and can only widen someone else's collision window.
  if (!looksLikeIOS(ua)) return ok({ recorded: false, reason: 'not-ios' })

  const sb = await createServiceClient()

  // Validate the token before storing it. Otherwise this endpoint is a free
  // write primitive: anyone could seed the table with junk that later gets
  // handed to a real installer as their "invite".
  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const expires = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000)
  const { error } = await sb.from('invite_handoffs').insert({
    token,
    fingerprint: fingerprint(ip, osVersionFromUA(ua)),
    expires_at: expires.toISOString(),
  })
  // A failure here costs the user nothing — they still have the link in their
  // messages, and the clipboard channel is unaffected. Never surface it.
  if (error) {
    console.warn('[invite-handoff] could not record ticket:', error.message)
    return ok({ recorded: false })
  }

  return ok({ recorded: true, expires_at: expires.toISOString() })
}
