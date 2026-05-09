import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'

  const { data, error } = await supabase
    .from('venue_suggestions')
    .select('*')
    .eq('status', status)
    .order('ai_confidence', { ascending: false })

  if (error) return err(error.message)
  return ok(data ?? [])
}
