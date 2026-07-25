import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ANY_KIND, ANY_DAY } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// Every venue + product that has a supplier, the operator's default rule, and
// any per-NIGHT overrides.
//
// Keyed per VENUE, KIND and WEEKDAY. A guestlist and a VIP table are different
// products; and within a product, a specific night can override the default —
// Rumba runs the door Mon–Fri, Aashi on Saturday. weekday '*' is the default
// (every night); '0'..'6' are Sun..Sat.
//
// Suppliers muted brand-wide (offers_hidden) are excluded — they aren't
// showing anywhere, so they aren't a choice here.

interface Row { club_id: string; brand_id: string; kind: string; is_active?: boolean }
interface Rule { mode: string; brand_ids: string[] }

const KIND_LABEL: Record<string, string> = {
  free_guestlist: 'Guestlist',
  vip_table:      'VIP table',
}

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const [{ data: offers }, { data: brands }, { data: rules }] = await Promise.all([
    sb.from('partner_offers').select('*'),
    sb.from('partner_brands').select('*'),
    sb.from('club_offer_visibility').select('*'),
  ])

  const brandById = new Map<string, { id: string; name: string; color: string; hidden: boolean }>()
  for (const b of brands ?? []) {
    const r = b as Record<string, unknown>
    brandById.set(String(r.id), {
      id: String(r.id), name: String(r.name ?? ''), color: String(r.color ?? '#888888'),
      hidden: r.offers_hidden === true,
    })
  }

  // club|kind -> the brands supplying that product there
  const byClubKind = new Map<string, Set<string>>()
  for (const o of (offers ?? []) as Row[]) {
    if (o.is_active === false) continue
    const brand = brandById.get(o.brand_id)
    if (!brand || brand.hidden) continue
    const key = `${o.club_id}|${o.kind}`
    const set = byClubKind.get(key) ?? new Set<string>()
    set.add(o.brand_id)
    byClubKind.set(key, set)
  }

  const entries = [...byClubKind.entries()]
  const clubIds = [...new Set(entries.map(([key]) => key.split('|')[0]))]

  const clubNames = new Map<string, string>()
  if (clubIds.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of clubs ?? []) clubNames.set(String((c as { id: string }).id), String((c as { name: string }).name))
  }

  // Rules keyed club|kind|weekday. Missing kind/weekday (pre-migration) read as
  // the wildcards, so old rows stay venue-wide / all-nights.
  const ruleBy = new Map<string, Rule>()
  for (const r of rules ?? []) {
    const row = r as Record<string, unknown>
    const kind = typeof row.kind === 'string' && row.kind ? row.kind : ANY_KIND
    const weekday = typeof row.weekday === 'string' && row.weekday ? row.weekday : ANY_DAY
    ruleBy.set(`${String(row.club_id)}|${kind}|${weekday}`, {
      mode: String(row.mode ?? 'all'),
      brand_ids: ((row.brand_ids as string[] | null) ?? []).map(String),
    })
  }

  const items = entries.map(([key, brandIds]) => {
    const [clubId, kind] = key.split('|')
    // Default (all-nights) rule for this kind, else the venue-wide one.
    const defaultRule = ruleBy.get(`${clubId}|${kind}|${ANY_DAY}`)
      ?? ruleBy.get(`${clubId}|${ANY_KIND}|${ANY_DAY}`)
      ?? { mode: 'all', brand_ids: [] }
    // Per-night overrides that exist for THIS exact club|kind.
    const dayRules: Record<string, Rule> = {}
    for (let w = 0; w < 7; w++) {
      const r = ruleBy.get(`${clubId}|${kind}|${w}`)
      if (r) dayRules[String(w)] = r
    }
    return {
      club_id:    clubId,
      club_name:  clubNames.get(clubId) ?? 'Unknown venue',
      kind,
      kind_label: KIND_LABEL[kind] ?? kind,
      conflict:   brandIds.size > 1,
      // The default is still riding the venue-wide rule (no kind-specific one).
      inherited:  !ruleBy.has(`${clubId}|${kind}|${ANY_DAY}`) && ruleBy.has(`${clubId}|${ANY_KIND}|${ANY_DAY}`),
      rule:       defaultRule,
      day_rules:  dayRules,
      suppliers: [...brandIds]
        .map(id => brandById.get(id)!)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }).sort((a, b) => a.club_name.localeCompare(b.club_name) || a.kind.localeCompare(b.kind))

  return ok(items)
}

const WEEKDAY = z.union([z.literal('*'), z.enum(['0', '1', '2', '3', '4', '5', '6'])])

const PutRule = z.object({
  club_id:   z.string().uuid(),
  kind:      z.string().min(1).default(ANY_KIND),
  weekday:   WEEKDAY.default(ANY_DAY),
  mode:      z.enum(['all', 'none', 'selected']),
  brand_ids: z.array(z.string().uuid()).default([]),
}).strict()

const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// PUT /api/portal/conflicts — set one venue+kind+weekday rule.
// A day override with mode 'all' at the default is just "clear the override";
// callers send DELETE-equivalent by upserting mode 'all' with no brands.
export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = PutRule.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid rule')
  const { club_id, kind, weekday, mode, brand_ids } = parsed.data
  if (mode === 'selected' && brand_ids.length === 0) {
    return err('Pick at least one supplier, or choose “No offers”.')
  }

  const sb = await createServiceClient()
  const { error } = await sb.from('club_offer_visibility').upsert({
    club_id, kind, weekday, mode,
    brand_ids: mode === 'selected' ? brand_ids : [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'club_id,kind,weekday' })

  if (error) {
    if (/weekday|kind|club_offer_visibility|schema cache|constraint/i.test(error.message)) {
      return err('Per-night rules need a schema change that has not been applied yet — run ' +
                 'supabase/migrations/20260723_visibility_per_day.sql in the SQL editor.', 503)
    }
    return err(error.message)
  }

  const { data: club } = await sb.from('clubs').select('name').eq('id', club_id).maybeSingle()
  const label = (club as { name?: string } | null)?.name ?? club_id
  const scope = [
    kind === ANY_KIND ? null : KIND_LABEL[kind] ?? kind,
    weekday === ANY_DAY ? null : `${DAY_NAME[Number(weekday)]} nights`,
  ].filter(Boolean).join(' · ')
  const what = scope ? `${label} · ${scope}` : label
  await logAudit(sb, {
    action: 'club.offer_visibility',
    summary: mode === 'all'  ? `All suppliers show at “${what}”`
           : mode === 'none' ? `No supplier offers show at “${what}”`
           : `Limited “${what}” to ${brand_ids.length} supplier${brand_ids.length === 1 ? '' : 's'}`,
    target_type: 'club', target_id: club_id, meta: { kind, weekday, mode, brand_ids },
  })
  return ok({ club_id, kind, weekday, mode, brand_ids })
}

// DELETE /api/portal/conflicts — remove a single day override (revert to default).
export async function DELETE(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const body = await request.json().catch(() => null) as { club_id?: string; kind?: string; weekday?: string } | null
  const club_id = body?.club_id
  const kind = body?.kind ?? ANY_KIND
  const weekday = body?.weekday
  if (!club_id || !weekday || weekday === ANY_DAY) return err('club_id and a specific weekday are required')

  const sb = await createServiceClient()
  const { error } = await sb.from('club_offer_visibility')
    .delete().eq('club_id', club_id).eq('kind', kind).eq('weekday', weekday)
  if (error) return err(error.message)
  return ok({ club_id, kind, weekday, removed: true })
}
