import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/notifications — user's notifications
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, is_read, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return err(error.message)
  return ok(data)
}

// PATCH /api/notifications — mark all as read
export async function PATCH() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user!.id)
    .eq('is_read', false)

  return ok({ updated: true })
}
