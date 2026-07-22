import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// Venues covered by more than one supplier, and the operator's rule for each.
//
// A conflict is "two or more visible suppliers have a live offer at this
// venue" — deliberately counted per VENUE, not per venue+kind, because the
// decision is made per venue. Suppliers muted brand-wide (offers_hidden) are
// excluded: they aren't competing for anything.

interface Row { club_id: string; brand_id: string; kind: string; is_active?: boolean }

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

  // club -> brand -> the offer kinds that supplier runs there
  const byClub = new Map<string, Map<string, Set<string>>>()
  for (const o of (offers ?? []) as Row[]) {
    if (o.is_active === false) continue
    const brand = brandById.get(o.brand_id)
    if (!brand || brand.hidden) continue
    const perBrand = byClub.get(o.club_id) ?? new Map<string, Set<string>>()
    const kinds = perBrand.get(o.brand_id) ?? new Set<string>()
    kinds.add(o.kind)
    perBrand.set(o.brand_id, kinds)
    byClub.set(o.club_id, perBrand)
  }

  const conflicted = [...byClub.entries()].filter(([, perBrand]) => perBrand.size > 1)
  const clubIds = conflicted.map(([clubId]) => clubId)

  const clubNames = new Map<string, string>()
  if (clubIds.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of clubs ?? []) clubNames.set(String((c as { id: string }).id), String((c as { name: string }).name))
  }

  const ruleByClub = new Map<string, { mode: string; brand_ids: string[] }>()
  for (const r of rules ?? []) {
    const row = r as Record<string, unknown>
    ruleByClub.set(String(row.club_id), {
      mode: String(row.mode ?? 'all'),
      brand_ids: ((row.brand_ids as string[] | null) ?? []).map(String),
    })
  }

  const items = conflicted.map(([clubId, perBrand]) => ({
    club_id: clubId,
    club_name: clubNames.get(clubId) ?? 'Unknown venue',
    rule: ruleByClub.get(clubId) ?? { mode: 'all', brand_ids: [] },
    suppliers: [...perBrand.entries()].map(([brandId, kinds]) => ({
      ...brandById.get(brandId)!,
      kinds: [...kinds].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.club_name.localeCompare(b.club_name))

  return ok(items)
}

const PutRule = z.object({
  club_id:   z.string().uuid(),
  mode:      z.enum(['all', 'none', 'selected']),
  brand_ids: z.array(z.string().uuid()).default([]),
}).strict()

// PUT /api/portal/conflicts — set one venue's supplier rule.
export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = PutRule.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid rule')
  const { club_id, mode, brand_ids } = parsed.data
  // 'selected' with an empty set would silently mean the same as 'none' —
  // make the operator say which one they meant.
  if (mode === 'selected' && brand_ids.length === 0) {
    return err('Pick at least one supplier, or choose “No offers”.')
  }

  const sb = await createServiceClient()
  const { error } = await sb.from('club_offer_visibility').upsert({
    club_id, mode,
    brand_ids: mode === 'selected' ? brand_ids : [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'club_id' })

  if (error) {
    if (/club_offer_visibility|schema cache/i.test(error.message)) {
      return err('Conflict rules need a schema change that has not been applied yet — run ' +
                 'supabase/migrations/20260721_club_offer_visibility.sql in the SQL editor.', 503)
    }
    return err(error.message)
  }

  const { data: club } = await sb.from('clubs').select('name').eq('id', club_id).maybeSingle()
  const label = (club as { name?: string } | null)?.name ?? club_id
  await logAudit(sb, {
    action: 'club.offer_visibility',
    summary: mode === 'all'  ? `All suppliers show at “${label}”`
           : mode === 'none' ? `No supplier offers show at “${label}”`
           : `Limited “${label}” to ${brand_ids.length} supplier${brand_ids.length === 1 ? '' : 's'}`,
    target_type: 'club', target_id: club_id, meta: { mode, brand_ids },
  })
  return ok({ club_id, mode, brand_ids })
}
