import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// GET /api/rumbas/[id] — public if active, staff sees inactive too
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // Try fetching without RLS restriction first (for staff)
  const serviceClient = await createServiceClient()
  const { data: rumba, error } = await serviceClient
    .from('rumbas')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !rumba) return err('Rumba not found', 404)

  // If inactive, check if user is staff/admin
  if (!rumba.is_active) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err('Not found', 404)

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['staff', 'admin'].includes(profile.role)) {
      return err('Not found', 404)
    }
  }

  // Get signup count
  const { count } = await serviceClient
    .from('rumba_signups')
    .select('id', { count: 'exact', head: true })
    .eq('rumba_id', id)
    .neq('status', 'denied')

  return ok({ ...rumba, signup_count: count ?? 0 })
}

// PATCH /api/rumbas/[id] — staff/admin only
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const body = await request.json()
  const allowed = ['title', 'venue_name', 'venue_place_id', 'event_date', 'capacity', 'description', 'cover_image', 'dress_code', 'is_active']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('rumbas')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

// DELETE /api/rumbas/[id] — staff/admin only
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('rumbas')
    .delete()
    .eq('id', id)

  if (error) return err(error.message, 500)
  return ok({ deleted: true })
}
