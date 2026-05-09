import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// PATCH /api/notifications/[id] — mark single notification as read
export async function PATCH(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', user!.id)

  if (error) return err(error.message)
  return ok({ updated: true })
}
