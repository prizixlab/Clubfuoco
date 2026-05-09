import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/rumbas/[id]/signups/mine — returns the current user's signup if any
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return ok(null)

  const serviceClient = await createServiceClient()
  const { data: signup, error } = await serviceClient
    .from('rumba_signups')
    .select('*')
    .eq('rumba_id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !signup) return ok(null)

  // Get position on list
  const { count } = await serviceClient
    .from('rumba_signups')
    .select('id', { count: 'exact', head: true })
    .eq('rumba_id', id)
    .neq('status', 'denied')
    .lte('created_at', signup.created_at)

  return ok({ ...signup, position: count ?? 1 })
}
