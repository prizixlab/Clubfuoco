import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { safeNextPath } from '@/lib/url'
import { NextRequest, NextResponse } from 'next/server'

// Handles the OAuth redirect (Google, Apple, …) and the PKCE code exchange.
//
// IMPORTANT: the session cookies set during exchangeCodeForSession MUST be
// written onto the exact NextResponse we return. Using a next/headers-based
// client and then returning a separate NextResponse.redirect() drops those
// cookies, so the user ends up redirected WITHOUT a session (lands on the
// home/marketing page, logged out). This wires the cookies straight onto the
// redirect response — the canonical @supabase/ssr pattern.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Destination after sign-in. Prefer an explicit ?next= (email flows); fall
  // back to the cf_oauth_next cookie set before the OAuth round-trip (providers
  // can drop query params on the redirect). Always validated to a same-origin
  // path so a tampered value can't become an open redirect.
  const cookieRaw = request.cookies.get('cf_oauth_next')?.value
  const cookieNext = cookieRaw ? safeNextPath(decodeURIComponent(cookieRaw)) : null
  const next = safeNextPath(searchParams.get('next')) ?? cookieNext ?? '/'

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`)
    const cookieMethods: CookieMethodsServer = {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    }
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: cookieMethods }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      response.cookies.delete('cf_oauth_next')   // one-shot
      return response
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
