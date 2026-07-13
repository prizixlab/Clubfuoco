import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { listPending } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

type Item = {
  id: string
  type: 'change' | 'night' | 'series'
  entity: string
  action: string
  summary: string
  created_at: string
  payload?: Record<string, unknown> | null
}

function clubName(row: unknown): string {
  const c = (row as { club?: { name?: string } | { name?: string }[] }).club
  const name = Array.isArray(c) ? c[0]?.name : c?.name
  return name ?? 'a venue'
}

// GET /api/portal/reviews — the whole approval queue: supplier offer changes
// (pending_changes) plus promoter nights and series awaiting review. Promoter
// tables are queried defensively so a missing review_status column (pre-
// migration) just omits them rather than erroring.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const items: Item[] = []

  try {
    const changes = await listPending(sb)
    for (const r of changes) {
      items.push({ id: r.id, type: 'change', entity: r.entity, action: r.action, summary: r.summary, created_at: r.created_at, payload: r.payload })
    }
  } catch { /* changes table missing → skip */ }

  const { data: nights, error: nightErr } = await sb
    .from('promoter_nights')
    .select('id, title, night_date, created_at, club:clubs(name)')
    .eq('review_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)
  if (!nightErr) {
    for (const n of nights ?? []) {
      const r = n as { id: string; title: string | null; night_date: string; created_at: string }
      items.push({
        id: r.id, type: 'night', entity: 'night', action: 'night.create',
        summary: `New night${r.title ? ` “${r.title}”` : ''} at ${clubName(n)} · ${r.night_date}`,
        created_at: r.created_at,
      })
    }
  }

  const { data: series, error: seriesErr } = await sb
    .from('promoter_series')
    .select('id, title, created_at, club:clubs(name)')
    .eq('review_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)
  if (!seriesErr) {
    for (const s of series ?? []) {
      const r = s as { id: string; title: string | null; created_at: string }
      items.push({
        id: r.id, type: 'series', entity: 'series', action: 'series.create',
        summary: `New recurring series${r.title ? ` “${r.title}”` : ''} at ${clubName(s)}`,
        created_at: r.created_at,
      })
    }
  }

  items.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return ok(items)
}
