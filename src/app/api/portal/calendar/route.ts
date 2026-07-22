import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ANY_KIND } from '@/lib/partner'
import { parseValidDays, weekdayOf } from '@/lib/valid-days'
import { ok, err } from '@/lib/utils'

// What is actually running, night by night.
//
// The schedule lives in three places that no single screen showed together:
// the offer's valid_days, the supplier's brand-wide hide switch, and the
// per-venue conflict rule. This resolves all three per date so the operator
// sees the real answer rather than the raw rows.
//
// `skipped_dates` on the offer is the per-night suspend. It already existed
// and the consumer path already honours it (offerRunsOn); it just had no UI.

const KIND_LABEL: Record<string, string> = {
  free_guestlist: 'Guestlist',
  vip_table:      'VIP table',
}

/** YYYY-MM-DD for `days` consecutive dates starting at `from`. */
function dateRange(from: string, days: number): string[] {
  const out: string[] = []
  const start = new Date(`${from}T12:00:00Z`)
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const todayMadrid = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })

export async function GET(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  const url = new URL(request.url)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') ?? '')
    ? url.searchParams.get('from')!
    : todayMadrid()
  const days = Math.min(31, Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14))

  const sb = await createServiceClient()
  const [{ data: offers }, { data: brands }, { data: rules }] = await Promise.all([
    sb.from('partner_offers').select('*'),
    sb.from('partner_brands').select('*'),
    sb.from('club_offer_visibility').select('*'),
  ])

  // Only the venues that actually have offers. A plain select on `clubs` is
  // capped at PostgREST's 1000-row default and there are more clubs than that,
  // so venues past the cap came back nameless.
  const offerClubIds = [...new Set(((offers ?? []) as Record<string, unknown>[])
    .map(o => String(o.club_id ?? '')).filter(Boolean))]
  const { data: clubs } = offerClubIds.length
    ? await sb.from('clubs').select('id, name').in('id', offerClubIds)
    : { data: [] as { id: string; name: string }[] }

  const brandById = new Map<string, { id: string; name: string; color: string; hidden: boolean }>()
  for (const b of brands ?? []) {
    const r = b as Record<string, unknown>
    brandById.set(String(r.id), {
      id: String(r.id), name: String(r.name ?? ''), color: String(r.color ?? '#888888'),
      hidden: r.offers_hidden === true,
    })
  }
  const clubName = new Map<string, string>()
  for (const c of clubs ?? []) clubName.set(String((c as { id: string }).id), String((c as { name: string }).name))

  const ruleBy = new Map<string, { mode: string; brand_ids: string[] }>()
  for (const r of rules ?? []) {
    const row = r as Record<string, unknown>
    const kind = typeof row.kind === 'string' && row.kind ? row.kind : ANY_KIND
    ruleBy.set(`${String(row.club_id)}|${kind}`, {
      mode: String(row.mode ?? 'all'),
      brand_ids: ((row.brand_ids as string[] | null) ?? []).map(String),
    })
  }
  function blockedByRule(clubId: string, kind: string, brandId: string): boolean {
    const rule = ruleBy.get(`${clubId}|${kind}`) ?? ruleBy.get(`${clubId}|${ANY_KIND}`)
    if (!rule || rule.mode === 'all') return false
    if (rule.mode === 'none') return true
    return !rule.brand_ids.includes(brandId)
  }

  const rows = (offers ?? []) as Record<string, unknown>[]
  const dates = dateRange(from, days)

  const calendar = dates.map(date => {
    const weekday = weekdayOf(date)
    const entries = rows.flatMap(o => {
      if (o.is_active === false) return []
      const brand = brandById.get(String(o.brand_id ?? ''))
      if (!brand) return []
      const kind = String(o.kind ?? '')
      const clubId = String(o.club_id ?? '')

      const valid = parseValidDays(String(o.valid_days ?? ''))
      const onDay = weekday === null || valid.size === 0 || valid.has(weekday)
      if (!onDay) return []            // not scheduled this weekday at all

      const skipped = ((o.skipped_dates as string[] | null) ?? []).includes(date)
      // Why it isn't running, most specific first — the operator needs to know
      // WHICH switch to flip, not just that nothing shows.
      const blocked = skipped ? 'suspended'
                    : brand.hidden ? 'supplier_hidden'
                    : blockedByRule(clubId, kind, brand.id) ? 'conflict_rule'
                    : null
      return [{
        offer_id:   String(o.id ?? ''),
        club_id:    clubId,
        club_name:  clubName.get(clubId) ?? 'Unknown venue',
        kind,
        kind_label: KIND_LABEL[kind] ?? kind,
        title:      String(o.title ?? ''),
        time_window: String(o.time_window ?? ''),
        brand:      { id: brand.id, name: brand.name, color: brand.color },
        live:       blocked === null,
        blocked,
      }]
    }).sort((a, b) =>
      a.club_name.localeCompare(b.club_name) || a.kind.localeCompare(b.kind))

    return {
      date,
      weekday: weekday === null ? null : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday],
      live: entries.filter(e => e.live).length,
      entries,
    }
  })

  return ok({ from, days, today: todayMadrid(), calendar })
}

const Suspend = z.object({
  offer_id:  z.string().uuid(),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  suspended: z.boolean(),
}).strict()

// PUT /api/portal/calendar — suspend or restore ONE offer on ONE night.
//
// Edits partner_offers.skipped_dates, which the consumer gate already reads,
// so this takes effect without touching the offer's schedule.
export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = Suspend.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { offer_id, date, suspended } = parsed.data

  const sb = await createServiceClient()
  const { data: offer } = await sb
    .from('partner_offers').select('*').eq('id', offer_id).maybeSingle()
  if (!offer) return err('Offer not found', 404)

  const row = offer as Record<string, unknown>
  const current = ((row.skipped_dates as string[] | null) ?? []).map(String)
  const next = suspended
    ? [...new Set([...current, date])].sort()
    : current.filter(d => d !== date)

  const { error } = await sb
    .from('partner_offers').update({ skipped_dates: next }).eq('id', offer_id)
  if (error) return err(error.message)

  const { data: club } = await sb
    .from('clubs').select('name').eq('id', String(row.club_id ?? '')).maybeSingle()
  await logAudit(sb, {
    action: suspended ? 'offer.suspend_date' : 'offer.restore_date',
    summary: `${suspended ? 'Suspended' : 'Restored'} “${String(row.title ?? 'offer')}” at ` +
             `“${(club as { name?: string } | null)?.name ?? 'venue'}” on ${date}`,
    target_type: 'offer', target_id: offer_id, meta: { date, suspended },
  })
  return ok({ offer_id, date, suspended, skipped_dates: next })
}
