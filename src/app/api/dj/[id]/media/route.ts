import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()

  const [photosRes, samplersRes] = await Promise.all([
    supabase.from('dj_photos').select('id, url, caption').eq('dj_id', id).order('created_at', { ascending: false }),
    supabase.from('dj_samplers').select('id, title, url, type').eq('dj_id', id).order('created_at', { ascending: false }),
  ])

  if (photosRes.error) return err(photosRes.error.message)
  return ok({ photos: photosRes.data, samplers: samplersRes.data ?? [] })
}
