import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { UserRole } from '@/types'

// Returns null if not authenticated
export async function getUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

// Returns full profile row from public.users
export async function getUserProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
  const { data: { user } } = await supabase.auth.getUser()

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
