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

// POST /api/portal/notifications  { app, title, body, link? }
// Sends one push to every registered device of an app. Deliberately has no
// scheduling, targeting or retry: this is a blunt announcement tool, and the
// fewer moving parts between a human and a message hitting every phone, the
// less there is to get wrong.
//
// `link` = { type: 'club' | 'event', id } (consumer app only) rides in the
// payload as `link: '/clubs/<id>'` or `'/events/<id>'` — the same `link` key
// the ticket-ready push already uses. Builds that predate the venue/event
// routing ignore paths they don't know, so on those a tap just opens the app.
export async function POST(req: NextRequest) {
  const gate = await requirePortal()
  if (gate) return gate

  let body: { app?: string; title?: string; body?: string; link?: { type?: string; id?: string } | null }
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

  // Verify the target is something a tap can actually open, so a push never
  // lands on a dead screen: an active venue, or a guest-visible event.
  let link: { type: 'club' | 'event'; id: string; name: string; path: string } | null = null
  if (body.link) {
    if (app !== 'clubfuoco') return err('Links are only supported on the Club Fuoco app', 400)
    const { type, id } = body.link
    if (!id || (type !== 'club' && type !== 'event')) return err('Bad link', 400)
    if (type === 'club') {
      const { data } = await sb.from('clubs').select('id, name').eq('id', id).eq('is_active', true).maybeSingle()
      if (!data) return err('That venue is not active in the app', 400)
      link = { type, id, name: data.name, path: `/clubs/${id}` }
    } else {
      const { data } = await sb.from('v_events_feed').select('id, title').eq('id', id).maybeSingle()
      if (!data) return err('That event is not live in the app (unpublished, private or past)', 400)
      link = { type, id, name: data.title ?? 'Untitled event', path: `/events/${id}` }
    }
  }

  const result = await broadcastPush(
    sb,
    { title, body: message, payload: link ? { link: link.path } : undefined },
    app,
  )

  await logAudit(sb, {
    action: 'notification.broadcast',
    summary: `Push to ${app}: "${title}"${link ? ` (→ ${link.name})` : ''} → ${result.delivered}/${result.devices} devices`,
    target_type: 'notification',
    meta: { app, title, body: message, link, ...result },
  })

  return ok(result)
}
