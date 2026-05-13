import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // ── Support Bearer token auth from Capacitor (cross-origin, no cookies) ──────
  // apiFetch() attaches `Authorization: Bearer <access_token>` when running
  // inside the native shell. Cross-origin fetches to Vercel don't carry cookies,
  // so we verify the token directly instead of relying on the cookie session.
  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/, '')

  const cookieMethods: CookieMethodsServer = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
      supabaseResponse = NextResponse.next({ request })
      cookiesToSet.forEach(({ name, value, options }) =>
        supabaseResponse.cookies.set(name, value, options)
      )
    },
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods }
  )

  // If a Bearer token was supplied (Capacitor), verify it directly;
  // otherwise fall back to cookie-based session (browser).
  let user = null
  if (bearerToken) {
    const { data } = await supabase.auth.getUser(bearerToken)
    user = data.user
  } else {
    const { data } = await supabase.auth.getUser()
    user = data.user
  }

  const { pathname } = request.nextUrl

  // ── Public routes — always accessible ──────────────────────────────────────
  const isPublic =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/places/photo') || // photo proxy used by cards
    /^\/api\/(bookings|tickets|guest-lists)\/[^/]+\/wallet$/.test(pathname) || // booking/ticket wallet passes
    /^\/api\/membership\/wallet\/[^/]+$/.test(pathname)                        // membership wallet pass

  // ── Admin API — allow cron / manual triggers to bypass session ──────────────
  if (pathname.startsWith('/api/admin')) {
    const authHeader = request.headers.get('authorization')
    const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isManual   = request.nextUrl.searchParams.get('manual') === '1'
    if (!user && !isCron && !isManual) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── Redirect unauthenticated users to /login ────────────────────────────────
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Redirect logged-in users away from auth/splash pages ───────────────────
  if (user && (pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/explore'
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
