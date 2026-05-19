import { createClient as _createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import { Capacitor } from '@capacitor/core'

// Singleton — reuse one client instance across the whole app so the in-memory
// session is never lost between component mounts / navigations.
// Typed as `any` to avoid requiring a generated Database type file —
// all table queries use runtime column names; TypeScript safety isn't needed here.
let _instance: any = null

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export function createClient(): any {
  if (_instance) return _instance

  const isWeb = typeof window !== 'undefined' && !Capacitor.isNativePlatform()

  if (isWeb) {
    // ── Web (Vercel) ──────────────────────────────────────────────────────────
    // Store the session in COOKIES via @supabase/ssr. The Next.js middleware
    // gates every page by reading the auth cookie with createServerClient — a
    // localStorage-only session is invisible to it, so cookie-based login would
    // be bounced straight back to /login. createBrowserClient keeps the cookie
    // in sync so the middleware recognises the signed-in user.
    _instance = createBrowserClient(URL, ANON)
  } else {
    // ── Native iOS (Capacitor) / SSR ──────────────────────────────────────────
    // The native shell loads a static bundle with NO middleware, and apiFetch()
    // attaches a Bearer token for cross-origin API calls. A localStorage session
    // works correctly here — unlike @supabase/ssr which relies on cookies.
    _instance = _createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        // Bypass the Web Locks API. Supabase uses navigator.locks to guard the
        // auth token, but in Capacitor's WKWebView that lock can deadlock —
        // signInWithPassword acquires it and never releases, so login hangs
        // forever on a spinner. There is only ever one WebView (one "tab"),
        // so no cross-tab lock is needed: just run the callback directly.
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    })
  }

  return _instance
}
