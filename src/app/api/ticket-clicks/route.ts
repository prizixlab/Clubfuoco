import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { z } from 'zod'

const schema = z.object({
  event_id:       z.string().min(1).max(128),
  platform:       z.string().min(1).max(32),
  event_title:    z.string().max(256).optional().nullable(),
  venue_name:     z.string().max(256).optional().nullable(),
  venue_place_id: z.string().max(128).optional().nullable(),
  event_date:     z.string().optional().nullable(),  // ISO
  display_price:  z.number().int().nonnegative().optional().nullable(),
  currency:       z.string().max(8).optional().nullable(),
})

// POST /api/ticket-clicks
// Fire-and-forget telemetry: every tap of "Get Tickets" on an external-platform
// event lands here so we have authoritative numbers for affiliate/distribution
// partner applications later. Cheap insert; never blocks the user's purchase flow.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const user     = await getUser()        // null when unauthenticated is fine
  const supabase = await createServiceClient()

  const { error: insertError } = await supabase
    .from('ticket_clicks')
    .insert({
      user_id:        user?.id ?? null,
      event_id:       parsed.data.event_id,
      platform:       parsed.data.platform,
      event_title:    parsed.data.event_title    ?? null,
      venue_name:     parsed.data.venue_name     ?? null,
      venue_place_id: parsed.data.venue_place_id ?? null,
      event_date:     parsed.data.event_date     ?? null,
      display_price:  parsed.data.display_price  ?? null,
      currency:       parsed.data.currency       ?? null,
    })

  if (insertError) {
    // Don't fail the user's flow over telemetry. Log + return success.
    console.error('[ticket-clicks] insert failed:', insertError.message)
  }

  return ok({ logged: !insertError })
}
