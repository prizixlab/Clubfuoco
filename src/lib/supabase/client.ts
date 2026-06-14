import { createClient as _createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

// Singleton — reuse one client instance across the whole app so the in-memory
// session is never lost between component mounts / navigations.
// Typed as `any` to avoid requiring a generated Database type file —
// all table queries use runtime column names; TypeScript safety isn't needed here.
let _instance: any = null

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export function createClient(): any {
  if (_instance) return _instance

  // (The Capacitor WebView branch is gone — iOS is a fully native app now,
  // using supabase-swift. This client only ever runs on the web / SSR.)
  if (typeof window !== 'undefined') {
    // ── Web (Vercel) ──────────────────────────────────────────────────────────
    // Store the session in COOKIES via @supabase/ssr. The Next.js middleware
    // gates every page by reading the auth cookie with createServerClient — a
    // localStorage-only session is invisible to it, so cookie-based login would
    // be bounced straight back to /login. createBrowserClient keeps the cookie
    // in sync so the middleware recognises the signed-in user.
    _instance = createBrowserClient(URL, ANON)
  } else {
    // ── SSR / build ───────────────────────────────────────────────────────────
    _instance = _createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return _instance
}
