import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

// Admin-only: list all pending verification requests
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  // Simple admin check via users table
  const { data: profile } = await supabase
    .from('users')
    .select('account_type')
    .eq('id', user!.id)
    .single()

  // Allow club staff with admin role OR any club/user that's an admin
  // For now: only allow if account_type is not 'user' (club/dj can't access either)
  // You should add an is_admin column; for now we use a hardcoded check
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim())
  const { data: authUser } = await supabase.auth.admin.getUserById(user!.id)
  const email = authUser?.user?.email ?? ''

  if (!ADMIN_EMAILS.includes(email)) return err('Forbidden', 403)

  const { data, error } = await supabase
    .from('club_verification_requests')
    .select('*, clubs(id, name), users!user_id(email)')
    .in('status', ['pending_instagram', 'pending_maps', 'pending_review'])
    .order('created_at', { ascending: true })

  if (error) return err(error.message)
  return ok(data)
}
