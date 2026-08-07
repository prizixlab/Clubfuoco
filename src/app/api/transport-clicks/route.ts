import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { z } from 'zod'

const schema = z.object({
  platform:      z.enum(['maps', 'uber']),
  club_place_id: z.string().max(128).optional().nullable(),
  club_name:     z.string().max(256).optional().nullable(),
})

// POST /api/transport-clicks
// Fire-and-forget telemetry: every tap of "Directions" (Apple Maps) or "Uber"
// on a club detail page lands here, so we know which venues guests are actually
// trying to travel to and which transport option they prefer. Cheap insert;
// never blocks opening the deep link.
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
    .from('transport_clicks')
    .insert({
      user_id:       user?.id ?? null,
      platform:      parsed.data.platform,
      club_place_id: parsed.data.club_place_id ?? null,
      club_name:     parsed.data.club_name     ?? null,
    })

  if (insertError) {
    // Don't fail the user's flow over telemetry. Log + return success.
    console.error('[transport-clicks] insert failed:', insertError.message)
  }

  return ok({ logged: !insertError })
}
