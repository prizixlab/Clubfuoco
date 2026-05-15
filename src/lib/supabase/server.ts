import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
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

// Like createClient(), but also forwards a Capacitor Bearer token (when present)
// as the PostgREST Authorization header. This makes the client act AS the user
// for RLS purposes — auth.uid() resolves correctly even though Capacitor
// requests carry no cookies. Web requests fall back to the cookie session.
// Use this for RLS-protected tables accessed from the native app.
export async function createAuthedClient() {
  const cookieStore = await cookies()
  let token: string | null = null
  try {
    const h = await headers()
    const auth = h.get('authorization')
    token = auth?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  } catch {
    // headers() unavailable — fall through to cookie session
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: cookieMethods(cookieStore),
      ...(token && { global: { headers: { Authorization: `Bearer ${token}` } } }),
    }
  )
}

// Use for webhook handlers and admin ops that must bypass RLS
export async function createServiceClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: cookieMethods(cookieStore) }
  )
}
