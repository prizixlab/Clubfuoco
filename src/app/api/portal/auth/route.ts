import { NextRequest, NextResponse } from 'next/server'
import { PORTAL_COOKIE, isValidPortalPassword, portalSessionToken } from '@/lib/portal-auth'
import { err } from '@/lib/utils'

// POST /api/portal/auth — portal login. Body: { password }. On success sets the
// httpOnly session cookie the middleware checks for /portal/** + /api/portal/**.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!(await isValidPortalPassword(password))) {
    return err('Wrong password', 401)
  }
  const token = await portalSessionToken()
  const res = NextResponse.json({ data: { ok: true }, error: null })
  res.cookies.set(PORTAL_COOKIE, token!, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30,   // 30 days
  })
  return res
}

// DELETE /api/portal/auth — log out.
export async function DELETE() {
  const res = NextResponse.json({ data: { ok: true }, error: null })
  res.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
