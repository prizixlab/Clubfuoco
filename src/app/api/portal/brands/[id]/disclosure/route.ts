import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { sendPromoterDisclosure } from '@/lib/email'
import { computeNight, DISCLOSURE_STATEMENT } from '@/lib/disclosure'
import { ok, err } from '@/lib/utils'

// POST /api/portal/brands/:id/disclosure — email the promoter a disclosure of
// the money on their logged nights (club pays per table, our share, guestlist
// men/women + the 50% split).
//
// Keyed by BRAND, same as /events: nights hang off the brand's owner. Night
// ids are re-checked against that owner so a disclosure can only cite nights
// actually logged for this promoter. The full sent payload goes to the audit
// log — that row is our copy of what the contract extension said.

const money = z.number().min(0).max(1_000_000).nullable()

const Body = z.object({
  to: z.string().email(),
  nights: z.array(z.object({
    night_id: z.string().uuid(),
    table_club_pays: money,
    table_our_share: money,
    gl_man: money,
    gl_woman: money,
  })).min(1).max(1000),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid disclosure')
  const body = parsed.data

  const sb = await createServiceClient()
  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)
  if (!brand.owner_user_id) return err('This promoter has no logged nights yet')

  const ids = [...new Set(body.nights.map(n => n.night_id))]
  const found: { id: string; night_date: string; title: string | null; club_id: string | null; location_name: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('promoter_nights')
      .select('id, night_date, title, club_id, location_name')
      .eq('created_by', brand.owner_user_id)
      .in('id', ids.slice(i, i + 200))
    if (error) return err(error.message, 500)
    found.push(...(data ?? []))
  }
  const nightById = new Map(found.map(n => [n.id, n]))
  if (nightById.size !== ids.length) return err('Some nights are not logged for this promoter')

  const clubIds = [...new Set(found.map(n => n.club_id).filter((v): v is string => !!v))]
  const clubName = new Map<string, string>()
  if (clubIds.length) {
    const { data } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of (data ?? []) as { id: string; name: string }[]) clubName.set(c.id, c.name)
  }

  const nights = body.nights
    .map(n => {
      const row = nightById.get(n.night_id)!
      const venue = (row.club_id ? clubName.get(row.club_id) : null) ?? row.location_name ?? ''
      return computeNight({
        ...n,
        night_date: row.night_date,
        label: [venue, row.title].filter(Boolean).join(' · ') || 'Night',
      })
    })
    .sort((a, b) => a.night_date.localeCompare(b.night_date))

  const sentAt = new Date().toISOString()
  let sent: boolean
  try {
    sent = await sendPromoterDisclosure({
      to: body.to, displayName: brand.name, nights, statement: DISCLOSURE_STATEMENT, sentAt,
    })
  } catch (e) {
    return err(`Email failed: ${e instanceof Error ? e.message : 'unknown error'}`, 502)
  }
  if (!sent) return err('Email is not configured (RESEND_API_KEY missing)', 503)

  await logAudit(sb, {
    action: 'brand.disclosure_sent',
    summary: `Sent disclosure (${nights.length} night${nights.length === 1 ? '' : 's'}) to ${body.to} for ${brand.name}`,
    target_type: 'brand',
    target_id: brand.id,
    meta: { to: body.to, sent_at: sentAt, statement: DISCLOSURE_STATEMENT, nights },
  })

  return ok({ sent: true, to: body.to, nights: nights.length })
}
