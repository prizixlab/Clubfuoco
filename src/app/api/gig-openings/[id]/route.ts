import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const body = await request.json()
  const { data, error } = await supabase
    .from('gig_openings')
    .update(body)
    .eq('id', id)
    .eq('club_id', staff.club_id)
    .select()
    .single()
  if (error) return err(error.message)
  return ok(data)
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')
  const { error } = await supabase.from('gig_openings').delete().eq('id', id).eq('club_id', staff.club_id)
  if (error) return err(error.message)
  return ok({ deleted: true })
}
