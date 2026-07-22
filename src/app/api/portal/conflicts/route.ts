import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ANY_KIND } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// Every venue + product that has a supplier, and the operator's rule for each.
//
// Keyed per VENUE **AND KIND**: a guestlist and a VIP table are different
// products, so Rumba can run the tables while Aashi runs the door and choosing
// one never drags the other with it.
//
// Deliberately lists products covered by a SINGLE supplier too. Only listing
// genuine clashes meant a venue's VIP table simply vanished from the page,
// leaving no way to see it or switch it off. `conflict` marks the rows where
// suppliers actually compete, so those still stand out.
//
// Suppliers muted brand-wide (offers_hidden) are excluded — they aren't
// showing anywhere, so they aren't a choice here.

interface Row { club_id: string; brand_id: string; kind: string; is_active?: boolean }

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

  // Rules keyed club|kind. A row with no `kind` (pre-migration) is venue-wide.
  const ruleBy = new Map<string, { mode: string; brand_ids: string[] }>()
  for (const r of rules ?? []) {
    const row = r as Record<string, unknown>
    const kind = typeof row.kind === 'string' && row.kind ? row.kind : ANY_KIND
    ruleBy.set(`${String(row.club_id)}|${kind}`, {
      mode: String(row.mode ?? 'all'),
      brand_ids: ((row.brand_ids as string[] | null) ?? []).map(String),
    })
  }

  const items = entries.map(([key, brandIds]) => {
    const [clubId, kind] = key.split('|')
    // The venue-wide rule still governs until this kind is given its own.
    const rule = ruleBy.get(key) ?? ruleBy.get(`${clubId}|${ANY_KIND}`) ?? { mode: 'all', brand_ids: [] }
    return {
      club_id:    clubId,
      club_name:  clubNames.get(clubId) ?? 'Unknown venue',
      kind,
      kind_label: KIND_LABEL[kind] ?? kind,
      /** Two or more suppliers competing for this product — a real decision. */
      conflict:   brandIds.size > 1,
      // True when this kind is still riding the venue-wide rule — the UI says
      // so, because saving here narrows the rule to this kind only.
      inherited:  !ruleBy.has(key) && ruleBy.has(`${clubId}|${ANY_KIND}`),
      rule,
      suppliers: [...brandIds]
        .map(id => brandById.get(id)!)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }).sort((a, b) => a.club_name.localeCompare(b.club_name) || a.kind.localeCompare(b.kind))

  return ok(items)
}

const PutRule = z.object({
  club_id:   z.string().uuid(),
  kind:      z.string().min(1).default(ANY_KIND),
  mode:      z.enum(['all', 'none', 'selected']),
  brand_ids: z.array(z.string().uuid()).default([]),
}).strict()

// PUT /api/portal/conflicts — set one venue+kind's supplier rule.
export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = PutRule.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid rule')
  const { club_id, kind, mode, brand_ids } = parsed.data
  // 'selected' with an empty set would silently mean the same as 'none' —
  // make the operator say which one they meant.
  if (mode === 'selected' && brand_ids.length === 0) {
    return err('Pick at least one supplier, or choose “No offers”.')
  }

  const sb = await createServiceClient()
  const { error } = await sb.from('club_offer_visibility').upsert({
    club_id, kind, mode,
    brand_ids: mode === 'selected' ? brand_ids : [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'club_id,kind' })

  if (error) {
    if (/kind|club_offer_visibility|schema cache|constraint/i.test(error.message)) {
      return err('Per-kind rules need a schema change that has not been applied yet — run ' +
                 'supabase/migrations/20260722_visibility_per_kind.sql in the SQL editor.', 503)
    }
    return err(error.message)
  }

  const { data: club } = await sb.from('clubs').select('name').eq('id', club_id).maybeSingle()
  const label = (club as { name?: string } | null)?.name ?? club_id
  const what = kind === ANY_KIND ? label : `${label} · ${KIND_LABEL[kind] ?? kind}`
  await logAudit(sb, {
    action: 'club.offer_visibility',
    summary: mode === 'all'  ? `All suppliers show at “${what}”`
           : mode === 'none' ? `No supplier offers show at “${what}”`
           : `Limited “${what}” to ${brand_ids.length} supplier${brand_ids.length === 1 ? '' : 's'}`,
    target_type: 'club', target_id: club_id, meta: { kind, mode, brand_ids },
  })
  return ok({ club_id, kind, mode, brand_ids })
}
