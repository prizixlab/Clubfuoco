import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import type { UserRole } from '@/types'

// Read a Bearer token from the request's Authorization header (Capacitor sends this
// because cookies don't cross the capacitor://localhost → vercel.app origin boundary).
async function getBearerToken(): Promise<string | null> {
  try {
    const h = await headers()
    const auth = h.get('authorization')
    if (!auth) return null
    const match = auth.match(/^Bearer\s+(.+)$/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Returns null if not authenticated
export async function getUser() {
  const supabase = await createClient()
  const token = await getBearerToken()
  const { data: { user }, error } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

// Returns full profile row from public.users
export async function getUserProfile() {
  const supabase = await createClient()
  const token = await getBearerToken()
  const { data: { user } } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return data
}

// Use in route handlers: returns user or a 401 response
export async function requireAuth() {
  const user = await getUser()
  if (!user) {
    return {
      user: null,
      response: NextResponse.json(
        { data: null, error: 'Unauthorized' },
        { status: 401 }
      ),
    }
  }
  return { user, response: null }
}

// Use for admin/staff routes: returns user or a 401/403 response
export async function requireRole(roles: UserRole[]) {
  const supabase = await createClient()
  const token = await getBearerToken()
  const { data: { user } } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser()

  if (!user) {
    return {
      user: null,
      response: NextResponse.json(
        { data: null, error: 'Unauthorized' },
        { status: 401 }
      ),
    }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !roles.includes(profile.role as UserRole)) {
    return {
      user: null,
      response: NextResponse.json(
        { data: null, error: 'Forbidden' },
        { status: 403 }
      ),
    }
  }

  return { user, response: null }
}

// Use for admin routes that are ALSO invoked by Vercel cron. Accepts either:
//   1. A request carrying the CRON_SECRET as a Bearer token (Vercel attaches this
//      automatically to scheduled invocations when CRON_SECRET is set), or
//   2. An authenticated user holding one of the given roles.
// Returns { user, response } like requireRole — on the cron path user is null.
export async function requireCronOrRole(req: Request, roles: UserRole[]) {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (secret && authHeader === `Bearer ${secret}`) {
    return { user: null, response: null }
  }
  return requireRole(roles)
}
