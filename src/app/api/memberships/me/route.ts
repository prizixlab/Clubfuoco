import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

// GET /api/memberships/me — current user's membership (null = free tier)
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data } = await supabase
    .from('memberships')
    .select('*')
    .eq('user_id', user!.id)
    .single()

  return ok(data ?? null)
}
