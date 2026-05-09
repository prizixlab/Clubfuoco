import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import type { RumbaSignupStatus } from '@/types'

// PATCH /api/rumbas/[id]/signups/[signupId] — staff/admin only — update status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; signupId: string }> }
) {
  const { id, signupId } = await params
  const { user, response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const body = await request.json()
  const { status } = body

  const validStatuses: RumbaSignupStatus[] = ['confirmed', 'arrived', 'denied']
  if (!validStatuses.includes(status)) {
    return err('status must be confirmed, arrived, or denied')
  }

  const supabase = await createServiceClient()

  const updates: Record<string, unknown> = { status }
  if (status === 'arrived') {
    updates.checked_in_at = new Date().toISOString()
    updates.checked_in_by = user!.id
  }

  const { data, error } = await supabase
    .from('rumba_signups')
    .update(updates)
    .eq('id', signupId)
    .eq('rumba_id', id)
    .select()
    .single()

  if (error) return err(error.message, 500)
  if (!data) return err('Signup not found', 404)
  return ok(data)
}
