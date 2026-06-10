import { createServiceClient } from '@/lib/supabase/server'
import { notify } from '@/lib/notify'
import { ok } from '@/lib/utils'

// GET /api/admin/group-reminders — daily cron. Nudges anyone who still hasn't
// locked in (invited / maybe) for a group happening tomorrow. Auth is handled by
// middleware (CRON_SECRET bearer, or an admin session, or ?manual=1).
export async function GET() {
  const sb = await createServiceClient()

  // Tomorrow in UTC (YYYY-MM-DD)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  const tomorrow = d.toISOString().slice(0, 10)

  const { data: groups } = await sb
    .from('booking_groups')
    .select('id, organizer_id, clubs(name)')
    .eq('status', 'open')
    .eq('booking_date', tomorrow)

  if (!groups || !groups.length) return ok({ groups: 0, reminded: 0 })

  let reminded = 0
  for (const group of groups) {
    const { data: pending } = await sb
      .from('booking_group_members')
      .select('user_id, rsvp')
      .eq('group_id', group.id)
      .in('rsvp', ['invited', 'maybe'])

    const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
    for (const m of pending ?? []) {
      await notify({
        user_id: m.user_id,
        type: 'group_reminder',
        title: `Tomorrow night at ${club?.name ?? 'the club'} — are you in?`,
        body: 'Your group is locking in. Tap to RSVP.',
        link: `/groups/placeholder?id=${group.id}`,
      })
      reminded++
    }
  }

  return ok({ groups: groups.length, reminded })
}
