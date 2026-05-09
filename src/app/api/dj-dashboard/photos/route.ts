import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')
  const { data, error } = await supabase.from('dj_photos').select('*').eq('dj_id', dj.id).order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data)
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const caption = formData.get('caption') as string | null

  if (!file) return err('No file provided')

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `photos/${dj.id}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('dj-media')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) return err(uploadError.message)

  const { data: { publicUrl } } = supabase.storage.from('dj-media').getPublicUrl(path)

  const { data, error } = await supabase
    .from('dj_photos')
    .insert({ dj_id: dj.id, url: publicUrl, caption })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
