import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// GET /api/rumbas — public, returns active rumbas with signup counts
export async function GET() {
  const supabase = await createClient()

  const { data: rumbas, error } = await supabase
    .from('rumbas')
    .select('*')
    .eq('is_active', true)
    .order('event_date', { ascending: true })

  if (error) return err(error.message, 500)

  // Get signup counts for each rumba
  const rumbaIds = (rumbas ?? []).map((r: any) => r.id)
  let countMap: Record<string, number> = {}

  if (rumbaIds.length > 0) {
    const { data: counts } = await supabase
      .from('rumba_signups')
      .select('rumba_id')
      .in('rumba_id', rumbaIds)
      .neq('status', 'denied')

    if (counts) {
      counts.forEach((c: any) => {
        countMap[c.rumba_id] = (countMap[c.rumba_id] ?? 0) + 1
      })
    }
  }

  const withCounts = (rumbas ?? []).map((r: any) => ({
    ...r,
    signup_count: countMap[r.id] ?? 0,
  }))

  // Active rumbas + live signup counts. Counts move minute-to-minute when
  // people are signing up, so use short (60s) cache — stale rows for ~a
  // minute are fine; the actual signup endpoint hits the DB directly.
  return ok(withCounts, 200, 'short')
}

// POST /api/rumbas — staff/admin only — create a rumba
export async function POST(request: NextRequest) {
  const { user, response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const body = await request.json()
  const { title, venue_name, venue_place_id, event_date, capacity, description, cover_image, dress_code } = body

  if (!title || !venue_name || !event_date) {
    return err('title, venue_name, and event_date are required')
  }

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('rumbas')
    .insert({
      title,
      venue_name,
      venue_place_id: venue_place_id ?? null,
      event_date,
      capacity: capacity ?? 100,
      description: description ?? null,
      cover_image: cover_image ?? null,
      dress_code: dress_code ?? null,
      is_active: false,
      created_by: user!.id,
    })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data, 201)
}
