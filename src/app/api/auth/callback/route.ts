import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/url'
import { NextRequest, NextResponse } from 'next/server'

// Handles OAuth redirect (Google, Apple, etc.)
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

  let target = `${origin}/login?error=auth_callback_failed`
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) target = `${origin}${next}`
  }

  const response = NextResponse.redirect(target)
  response.cookies.delete('cf_oauth_next')   // one-shot
  return response
}
