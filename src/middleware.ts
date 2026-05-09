import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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

  const { data: { user } } = await supabase.auth.getUser()

  if (request.nextUrl.pathname.startsWith('/api/admin')) {
    // Allow cron jobs (Bearer token) and manual triggers (?manual=1) to bypass session check
    const authHeader = request.headers.get('authorization')
    const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isManual   = request.nextUrl.searchParams.get('manual') === '1'
    if (!user && !isCron && !isManual) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
