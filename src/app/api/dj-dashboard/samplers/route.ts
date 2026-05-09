import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')
  const { data, error } = await supabase.from('dj_samplers').select('*').eq('dj_id', dj.id).order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data)
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')

  const { title, url, type } = await request.json()
  if (!title || !url) return err('Title and URL are required')

  const { data, error } = await supabase
    .from('dj_samplers')
    .insert({ dj_id: dj.id, title, url, type: type ?? 'soundcloud' })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
