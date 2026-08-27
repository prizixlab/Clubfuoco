import { NextResponse } from 'next/server'
import { INVESTORS_COOKIE, codeMatches, expectedInvestorToken } from '@/lib/investors-access'

// POST /api/investors/unlock — verifies the /investors access code server-side
// and, on success, sets an httpOnly session cookie the page checks on render.
// The code itself never leaves the server, so it can't be lifted out of the
// client bundle the way the old client-side comparison allowed.

export async function POST(req: Request) {
  let code = ''
  try {
    const body = await req.json()
    code = String(body?.code ?? '')
  } catch {
    // fall through — an empty code just fails the check below
  }

  if (!code || !codeMatches(code)) {
    // Deliberately vague: don't say whether the code was empty, short, or close.
    return NextResponse.json({ data: null, error: 'Invalid code' }, { status: 401 })
  }

  const res = NextResponse.json({ data: { ok: true }, error: null })
  res.cookies.set(INVESTORS_COOKIE, expectedInvestorToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    // No maxAge — a session cookie, matching the sessionStorage behaviour the
    // gate had before. Closing the browser re-locks the page.
  })
  return res
}
