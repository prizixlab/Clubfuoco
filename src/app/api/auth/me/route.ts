import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/auth/me — returns current user profile
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return err('Unauthorized', 401)

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !data) return err('User not found', 404)
  return ok(data)
}
