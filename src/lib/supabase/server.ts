import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'

function cookieMethods(cookieStore: Awaited<ReturnType<typeof cookies>>): CookieMethodsServer {
  return {
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        )
      } catch {
        // read-only in Server Components — safe to ignore
      }
    },
  }
}

// Use in Server Components and Route Handlers (anon key — respects RLS)
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods(cookieStore) }
  )
}

// Returns a Supabase client that acts AS the requesting user for RLS.
//
// Native (Capacitor) requests carry no cookies — only `Authorization: Bearer
// <jwt>`. For those we use the plain supabase-js client with the JWT in the
// global headers: PostgREST then resolves auth.uid() to the real user, so RLS
// policies like `auth.uid() = user_id` pass. (The @supabase/ssr client can't
// do this — it derives auth from cookies and ignores a passed-in header.)
//
// Web requests have a cookie session, so we fall back to the cookie client.
export async function createAuthedClient() {
  let token: string | null = null
  try {
    const h = await headers()
    const auth = h.get('authorization')
    token = auth?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  } catch {
    // headers() unavailable — fall through to cookie session
  }

  if (token) {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth:   { persistSession: false, autoRefreshToken: false },
      }
    )
  }

  // No Bearer token — web request, use the cookie-based session
  return createClient()
}

// Use for webhook handlers and admin ops that must bypass RLS.
//
// This MUST be a plain supabase-js client with NO cookie store. If the request
// carries a logged-in user's cookie, @supabase/ssr's createServerClient sends
// that user's JWT as the Authorization header, which overrides the service-role
// key — PostgREST then treats the request as the normal user and RLS applies
// (e.g. "new row violates row-level security policy"). A cookie-less client
// authenticates purely as service_role and correctly bypasses RLS.
export async function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
