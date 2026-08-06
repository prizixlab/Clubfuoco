import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { authDevice, buildManifest } from '@/lib/door'

// GET /api/door/manifest?venue=<club_id>&date=<yyyy-mm-dd>
// Device-authed. Returns the signed night manifest: every valid token for the
// venue/night with its allowance and current cross-door `used` count, cached by
// the app for offline scanning. `venue` must match the enrolled device's club.
export async function GET(req: NextRequest) {
  const supabase = await createServiceClient()
  const device = await authDevice(supabase)
  if (!device) return err('Unauthorized', 401)

  const venue = req.nextUrl.searchParams.get('venue') ?? device.club_id
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return err('date required (yyyy-mm-dd)', 400)
  if (venue !== device.club_id) return err('Device is not enrolled for that venue', 403)

  const manifest = await buildManifest(supabase, device.club_id, date)
  return ok(manifest)
}
