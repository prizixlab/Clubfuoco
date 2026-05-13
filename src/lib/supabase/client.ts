import { createClient as _createClient } from '@supabase/supabase-js'

// Singleton — reuse one client instance across the whole app so the in-memory
// session is never lost between component mounts / navigations.
// Typed as `any` to avoid requiring a generated Database type file —
// all table queries use runtime column names; TypeScript safety isn't needed here.
let _instance: any = null

export function createClient(): any {
  if (_instance) return _instance
  _instance = _createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Persist session in localStorage (default). Works correctly in
        // Capacitor WKWebView — unlike @supabase/ssr which relies on cookies.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    }
  )
  return _instance
}
