import { err } from '@/lib/utils'

// ── Partner Portal auth ──────────────────────────────────────────────────────
// Shared-secret gate: one PORTAL_PASSWORD env var, checked server-side, no
// Supabase accounts (the consumer app deliberately has no admin accounts).
// The session cookie holds HMAC(PORTAL_PASSWORD, fixed message) — derived only
// from the password, so rotating PORTAL_PASSWORD invalidates every session.
// Web Crypto only: this must run in edge middleware AND node route handlers.

export const PORTAL_COOKIE = 'cf_portal'

const TOKEN_MESSAGE = 'cf-portal-session-v1'

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// The value a logged-in session cookie must carry.
export async function portalSessionToken(): Promise<string | null> {
  const pw = process.env.PORTAL_PASSWORD
  if (!pw) return null   // unset ⇒ portal is closed, nothing can authenticate
  return hmacHex(pw, TOKEN_MESSAGE)
}

export async function isValidPortalCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false
  const expected = await portalSessionToken()
  if (!expected) return false
  // Double-HMAC compare — hides timing without needing timingSafeEqual (edge).
  const [a, b] = await Promise.all([hmacHex(TOKEN_MESSAGE, value), hmacHex(TOKEN_MESSAGE, expected)])
  return a === b
}

export async function isValidPortalPassword(password: string): Promise<boolean> {
  const pw = process.env.PORTAL_PASSWORD
  if (!pw || typeof password !== 'string') return false
  const [a, b] = await Promise.all([hmacHex(TOKEN_MESSAGE, password), hmacHex(TOKEN_MESSAGE, pw)])
  return a === b
}

// Route-handler guard — defence in depth behind the middleware (same pattern
// as requireRole on /api/admin). Returns a 401 response or null to proceed.
// next/headers is imported lazily: this module is also bundled into the edge
// middleware, which must not statically pull in route-handler-only modules.
export async function requirePortal(): Promise<Response | null> {
  const { cookies } = await import('next/headers')
  const store = await cookies()
  const authed = await isValidPortalCookie(store.get(PORTAL_COOKIE)?.value)
  return authed ? null : err('Unauthorized', 401)
}
