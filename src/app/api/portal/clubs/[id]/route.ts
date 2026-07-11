import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/clubs/:id — the full club row (all columns) for the Clubs
// tab's detail modal. Service client so the portal can read/write regardless
// of RLS.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()
  const { data, error } = await sb.from('clubs').select('*').eq('id', id).maybeSingle()
  if (error) return err(error.message, 500)
  if (!data) return err('Club not found', 404)
  return ok(data)
}

// Only operator-editable columns are patchable. Google/sync-managed fields
// (photos, ratings, place_id, opening_hours, *_venue_id, *_synced_at) are
// deliberately excluded — .strict() rejects anything not listed here so a
// stray key can't clobber synced data.
const nullableNumber = z.number().nullable()
const PatchClub = z.object({
  name:                z.string().trim().min(1).max(120).optional(),
  slug:                z.string().trim().min(1).max(120).optional(),
  description:         z.string().trim().max(4000).nullable().optional(),
  address:             z.string().trim().max(300).nullable().optional(),
  neighborhood:        z.string().trim().max(120).nullable().optional(),
  lat:                 nullableNumber.optional(),
  lng:                 nullableNumber.optional(),
  cover_image_url:     z.string().trim().url().nullable().optional(),
  music_genres:        z.array(z.string().trim().min(1)).nullable().optional(),
  max_capacity:        z.number().int().positive().max(1_000_000).nullable().optional(),
  general_entry_price: z.number().min(0).max(100_000).nullable().optional(),
  vip_table_min_spend: z.number().min(0).max(1_000_000).nullable().optional(),
  instagram_handle:    z.string().trim().max(120).nullable().optional(),
  whatsapp_link:       z.string().trim().max(300).nullable().optional(),
  is_active:           z.boolean().optional(),
  is_featured:         z.boolean().optional(),
  is_partner:          z.boolean().optional(),
}).strict()

// PATCH /api/portal/clubs/:id — edit a club's operator-owned fields.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const parsed = PatchClub.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid club patch')
  if (Object.keys(parsed.data).length === 0) return err('Nothing to update')

  const sb = await createServiceClient()
  const { error } = await sb.from('clubs').update(parsed.data).eq('id', id)
  if (error) {
    const msg = /duplicate key|unique/.test(error.message)
      ? `That slug is already taken by another club`
      : error.message
    return err(msg, 500)
  }
  const { data } = await sb.from('clubs').select('*').eq('id', id).maybeSingle()
  return ok(data)
}
