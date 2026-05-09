import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

// Use for webhook handlers and admin ops that must bypass RLS
export async function createServiceClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: cookieMethods(cookieStore) }
  )
}
