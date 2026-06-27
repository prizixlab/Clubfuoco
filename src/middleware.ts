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

  // ── Admin API — first layer of defence ──────────────────────────────────────
  // Allow Vercel cron (CRON_SECRET bearer) or any logged-in user through here;
  // every /api/admin route additionally self-protects with requireRole /
  // requireCronOrRole, so this is defence-in-depth, not the only gate.
  // NOTE: there is intentionally NO `?manual=1` bypass — that let any
  // unauthenticated caller run admin jobs (Google Places sync, discover, …).
  if (pathname.startsWith('/api/admin')) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get('authorization')
    const isCron     = !!cronSecret && authHeader === `Bearer ${cronSecret}`
    if (!user && !isCron) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next({ request })
  }

  // ── Web is invite-only ──────────────────────────────────────────────────────
  // The ONLY app surface on the web is the /join invite flow plus the auth it
  // needs to complete. Everything else — explore, clubs, rumbas, groups,
  // tickets, profile, settings, dashboards, etc. — lives exclusively in the
  // native app and must NOT be reachable in a browser. Any other page route is
  // bounced to the marketing home. API routes are deliberately untouched: the
  // native app and the join flow both depend on them (each route self-protects).
  if (!pathname.startsWith('/api/')) {
    const WEB_ALLOWED = [
      '/about', '/partners', '/investors', '/press', '/legal',   // marketing
      '/join',                                                    // invite flow
      '/i',                                                       // promoter invite links (/i/<token>)
      '/billing',                                                 // Stripe card-setup return page
      '/login', '/signup', '/complete-profile', '/auth',         // auth for joining
    ]
    const allowed =
      pathname === '/' ||
      WEB_ALLOWED.some(p => pathname === p || pathname.startsWith(`${p}/`))
    if (!allowed) {
      const home = request.nextUrl.clone()
      home.pathname = '/'
      home.search = ''
      return NextResponse.redirect(home)
    }
  }

  // ── Attach CORS headers to every API response ──────────────────────────────
  if (request.nextUrl.pathname.startsWith('/api/')) {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => supabaseResponse.headers.set(k, v))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclude Next internals and static public assets (images, scripts, styles,
    // fonts). Files like /motion.js and /glimmer.js live in public/ and must be
    // served directly — without this the auth guard redirects them to /login.
    '/((?!_next/static|_next/image|\\.well-known/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|woff|woff2|ttf|ico|txt|json)$).*)',
  ],
}
