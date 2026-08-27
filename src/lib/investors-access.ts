// SERVER-ONLY. Never import this from a 'use client' module — the whole point
// is that the access code stays out of the browser bundle.
//
// The /investors gate used to compare the code inside a client component, so
// `FUOCO2026` shipped in the page JS and anyone could read it out of devtools.
// The check now happens in POST /api/investors/unlock and the page is gated
// server-side on an httpOnly cookie, so the browser never sees the code and
// the gated content is never sent to a locked visitor.
//
// This is still a shared code handed round in intro emails, not per-investor
// auth: anyone who has it can pass it on. It keeps casual traffic out; it is
// not a secret-keeping mechanism. The deck itself is protected separately.

import { createHash, timingSafeEqual } from 'node:crypto'

export const INVESTORS_COOKIE = 'cf_inv'

/**
 * The literal is the historical default so nothing breaks if the env var is
 * unset — but set INVESTORS_ACCESS_CODE in production and rotate it there.
 * Changing the code invalidates every cookie already issued (the token below
 * is derived from it), which is what you want when a link leaks.
 */
function accessCode(): string {
  return (process.env.INVESTORS_ACCESS_CODE ?? 'FUOCO2026').trim().toUpperCase()
}

/** Opaque cookie value. Unguessable without the code; not reversible to it. */
export function expectedInvestorToken(): string {
  return createHash('sha256').update(`cf-investors:v1:${accessCode()}`).digest('hex')
}

/** Constant-time compare so the endpoint can't be probed character by character. */
export function codeMatches(input: string): boolean {
  const given    = Buffer.from(input.trim().toUpperCase(), 'utf8')
  const expected = Buffer.from(accessCode(), 'utf8')
  // timingSafeEqual throws on a length mismatch, so hash both to a fixed width
  // first — that keeps the comparison constant-time across lengths too.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Does this request's cookie jar hold a valid unlock token? */
export function tokenIsValid(value: string | undefined): boolean {
  if (!value) return false
  const a = Buffer.from(value, 'utf8')
  const b = Buffer.from(expectedInvestorToken(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
