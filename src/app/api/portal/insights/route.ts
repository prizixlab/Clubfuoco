import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/insights — bookings performance for the Insights tab.
// Bookings are attributed to clubs (club_id) and type (general = free guestlist,
// vip = VIP table). Since one supplier is live at a time, recent bookings
// reflect the active supplier's shelf. Aggregated in JS from a 30-day window.
type Row = { id: string; club_id: string; booking_type: string; status: string; created_at: string; total_amount: number | null; checked_in_at: string | null }

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await sb
    .from('bookings')
    .select('id, club_id, booking_type, status, created_at, total_amount, checked_in_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) return err(error.message, 500)
  const rows = (data ?? []) as Row[]

  // Club names for the ids we saw.
  const clubIds = [...new Set(rows.map(r => r.club_id))]
  const nameById: Record<string, string> = {}
  if (clubIds.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of clubs ?? []) nameById[(c as { id: string }).id] = (c as { name: string }).name
  }

  const cancelled = (r: Row) => r.status === 'cancelled'
  const live = rows.filter(r => !cancelled(r))
  const dayMs = 24 * 3600 * 1000
  const now = Date.now()
  const within = (r: Row, days: number) => now - new Date(r.created_at).getTime() <= days * dayMs

  const isVip = (r: Row) => r.booking_type === 'vip'

  // 14-day trend (oldest → newest), bookings per day.
  const trend: { date: string; count: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * dayMs)
    const key = d.toISOString().slice(0, 10)
    trend.push({ date: key, count: live.filter(r => r.created_at.slice(0, 10) === key).length })
  }

  // By club (top 8 by volume).
  const byClubMap: Record<string, { free: number; vip: number }> = {}
  for (const r of live) {
    const b = (byClubMap[r.club_id] ??= { free: 0, vip: 0 })
    if (isVip(r)) b.vip++; else b.free++
  }
  const byClub = Object.entries(byClubMap)
    .map(([club_id, v]) => ({ club: nameById[club_id] ?? '—', ...v, total: v.free + v.vip }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const recent = live.slice(0, 20).map(r => ({
    id: r.id, club: nameById[r.club_id] ?? '—', kind: isVip(r) ? 'VIP Table' : 'Free Guestlist',
    status: r.status, created_at: r.created_at, checked_in: !!r.checked_in_at,
    amount: r.total_amount ?? null,
  }))

  return ok({
    totals: {
      last7:      live.filter(r => within(r, 7)).length,
      last30:     live.length,
      vip30:      live.filter(isVip).length,
      free30:     live.filter(r => !isVip(r)).length,
      checkedIn30: live.filter(r => r.checked_in_at).length,
    },
    trend,
    byClub,
    recent,
  })
}
