import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('dj_gigs')
    .insert({ dj_id: id, ...body })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('dj_gigs')
    .select(`id, event_name, gig_date, start_time, end_time, set_type, is_confirmed, clubs (id, name, cover_image_url, neighborhood)`)
    .eq('dj_id', id)
    .gte('gig_date', new Date().toISOString().split('T')[0])
    .order('gig_date', { ascending: true })

  if (error) return err(error.message)
  return ok(data)
}
