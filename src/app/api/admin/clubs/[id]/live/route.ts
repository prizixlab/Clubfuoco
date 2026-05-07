import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err, crowdLabelFromPercent } from '@/lib/utils'
import { requireRole } from '@/lib/auth'
import { z } from 'zod'

const liveUpdateSchema = z.object({
  crowd_percentage:   z.number().int().min(0).max(100).optional(),
  current_dj:         z.string().max(100).optional().nullable(),
  dj_photo_url:       z.string().url().optional().nullable(),
  queue_wait_minutes: z.number().int().min(0).optional().nullable(),
  is_open:            z.boolean().optional(),
  special_note:       z.string().max(200).optional().nullable(),
})

// PATCH /api/admin/clubs/:id/live
// The most-used admin endpoint — called by club staff throughout the night
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  const body   = await request.json()
  const parsed = liveUpdateSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const update: Record<string, unknown> = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: user!.id,
  }

  // Auto-derive crowd_label from percentage when provided
  if (typeof parsed.data.crowd_percentage === 'number') {
    update.crowd_label = crowdLabelFromPercent(parsed.data.crowd_percentage)
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('live_status')
    .upsert({ club_id: id, ...update }, { onConflict: 'club_id' })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}
