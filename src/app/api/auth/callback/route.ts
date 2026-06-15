import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/url'
import { NextRequest, NextResponse } from 'next/server'

// Handles OAuth redirect (Google, Apple, etc.)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only ever follow a validated same-origin path — never an attacker-supplied
  // absolute URL (open-redirect guard).
  const next = safeNextPath(searchParams.get('next')) ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
