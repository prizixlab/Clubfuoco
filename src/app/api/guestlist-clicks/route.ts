import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { z } from 'zod'

const schema = z.object({
  source:        z.enum(['dj', 'club']),
  club_place_id: z.string().max(128).optional().nullable(),
  club_name:     z.string().max(256).optional().nullable(),
  offer_kind:    z.string().max(16).optional().nullable(),
  dj_ra_id:      z.string().max(64).optional().nullable(),
  night:         z.string().max(32).optional().nullable(),
})

// POST /api/guestlist-clicks
// Fire-and-forget telemetry: records whether a guestlist open came from the
// Featured DJ menu ("dj") or a club's normal offer card ("club"), so we can see
// how much the DJ boxes drive bookings. Cheap insert; never blocks the flow.
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
    .from('guestlist_clicks')
    .insert({
      user_id:       user?.id ?? null,
      source:        parsed.data.source,
      club_place_id: parsed.data.club_place_id ?? null,
      club_name:     parsed.data.club_name     ?? null,
      offer_kind:    parsed.data.offer_kind    ?? null,
      dj_ra_id:      parsed.data.dj_ra_id      ?? null,
      night:         parsed.data.night         ?? null,
    })

  if (insertError) {
    // Don't fail the user's flow over telemetry. Log + return success.
    console.error('[guestlist-clicks] insert failed:', insertError.message)
  }

  return ok({ logged: !insertError })
}
