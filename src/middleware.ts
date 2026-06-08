import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function middleware(request: NextRequest) {
  // ── CORS preflight — Capacitor sends OPTIONS before every POST ──────────────
  if (request.method === 'OPTIONS' && request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
  }

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
  // Guideline 5.1.1(v): non-account content (browsing venues, events, pricing)
  // must be reachable without an account. Login is only required for
  // account-based actions, which the affected pages gate themselves.
  const isPublic =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/explore') ||      // Guest browsing — venue feed
    pathname.startsWith('/clubs') ||        // Guest browsing — venue detail pages
    pathname.startsWith('/rumbas') ||       // Guest browsing — events
    // Marketing site surfaces (clubfuoco.com only — iOS never hits these)
    pathname.startsWith('/about') ||
    pathname.startsWith('/partners') ||
    pathname.startsWith('/investors') ||
    pathname.startsWith('/press') ||
    pathname.startsWith('/api/partnership-inquiries') ||
    pathname.startsWith('/api/places') ||   // Venue/details/photo APIs
    pathname.startsWith('/api/events') ||   // Event listings
    pathname.startsWith('/api/clubs') ||    // Public clubs read APIs
    pathname.startsWith('/api/rumbas') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks') ||
    /^\/api\/(bookings|tickets|guest-lists)\/[^/]+\/wallet$/.test(pathname) ||
    /^\/api\/membership\/wallet\/[^/]+$/.test(pathname)

  // ── Admin API — allow cron / manual triggers to bypass session ──────────────
  if (pathname.startsWith('/api/admin')) {
    const authHeader = request.headers.get('authorization')
    const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isManual   = request.nextUrl.searchParams.get('manual') === '1'
    if (!user && !isCron && !isManual) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
    }
    // Cron/manual/logged-in admin — skip the general auth redirect below
    return NextResponse.next({ request })
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

  // ── Attach CORS headers to every API response ──────────────────────────────
  if (request.nextUrl.pathname.startsWith('/api/')) {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => supabaseResponse.headers.set(k, v))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
