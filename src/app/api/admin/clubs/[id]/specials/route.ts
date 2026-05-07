import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireRole } from '@/lib/auth'
import { z } from 'zod'

const specialSchema = z.object({
  name:           z.string().max(100).optional(),
  description:    z.string().max(300).optional(),
  original_price: z.number().positive().optional(),
  special_price:  z.number().min(0).optional(),
  valid_from:     z.string().datetime().optional(),
  valid_until:    z.string().datetime().optional(),
})

// GET /api/admin/clubs/:id/specials — all specials for this club
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drink_specials')
    .select('*')
    .eq('club_id', id)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)
  return ok(data)
}

// POST /api/admin/clubs/:id/specials — add a new special
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  const body   = await request.json()
  const parsed = specialSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('drink_specials')
    .insert({ club_id: id, ...parsed.data, is_active: true })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
