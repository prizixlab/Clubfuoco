import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { broadcastAudience, broadcastPush, type PushApp } from '@/lib/push'

const APPS: PushApp[] = ['clubfuoco', 'promoters']

// GET /api/portal/notifications
// Audience sizes, so the confirm step can state exactly how many devices a send
// would reach before anyone commits to it.
export async function GET() {
  const gate = await requirePortal()
  if (gate) return gate

  const sb = await createServiceClient()
  const [consumer, promoters] = await Promise.all(
    APPS.map(a => broadcastAudience(sb, a)),
  )
  return ok({ clubfuoco: consumer, promoters })
}

// POST /api/portal/notifications  { app, title, body }
// Sends one push to every registered device of an app. Deliberately has no
// scheduling, targeting or retry: this is a blunt announcement tool, and the
// fewer moving parts between a human and a message hitting every phone, the
// less there is to get wrong.
//
// The payload carries no deep link, so tapping simply opens the app — the
// consumer app only routes `bookingId` today, and inventing a new userInfo key
// here would need a matching iOS build to do anything.
export async function POST(req: NextRequest) {
  const gate = await requirePortal()
  if (gate) return gate

  let body: { app?: string; title?: string; body?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }

  const app = (body.app ?? 'clubfuoco') as PushApp
  if (!APPS.includes(app)) return err('Unknown app', 400)

  const title = (body.title ?? '').trim()
  const message = (body.body ?? '').trim()
  if (!title) return err('A title is required', 400)
  // APNs truncates long alerts on the lock screen; reject rather than silently
  // ship something that reads as cut off on every device.
  if (title.length > 60) return err('Title must be 60 characters or fewer', 400)
  if (message.length > 180) return err('Message must be 180 characters or fewer', 400)

  const sb = await createServiceClient()
  const result = await broadcastPush(sb, { title, body: message }, app)

  await logAudit(sb, {
    action: 'notification.broadcast',
    summary: `Push to ${app}: "${title}" → ${result.delivered}/${result.devices} devices`,
    target_type: 'notification',
    meta: { app, title, body: message, ...result },
  })

  return ok(result)
}
