import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  const { id } = await params
  const { is_partner } = await req.json()

  const { error } = await supabase
    .from('clubs')
    .update({ is_partner })
    .eq('id', id)

  if (error) return err(error.message)
  return ok({ id, is_partner })
}
