import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { sendPromoterDisclosure, type DisclosureEmailClub } from '@/lib/email'
import { loadDisclosureClubs } from '@/lib/disclosure-data'
import { half, promoterPart, DISCLOSURE_STATEMENT } from '@/lib/disclosure'
import { ok, err } from '@/lib/utils'

// GET  /api/portal/brands/:id/disclosure — the clubs this promoter works and
//      every VIP table they sell at each, with all its prices.
// POST /api/portal/brands/:id/disclosure — email the disclosure.
//
// The POST only carries what the operator typed (club pays, Club Fuoco's part,
// guestlist prices). Clubs, tables and prices are reloaded here, so the email
// can only list tables this promoter actually sells. The full sent payload goes
// to the audit log — that row is our copy of what the contract extension said.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const clubs = await loadDisclosureClubs(await createServiceClient(), id)
  return clubs ? ok({ clubs }) : err('Promoter not found', 404)
}

const money = z.number().min(0).max(1_000_000).nullable()

const Body = z.object({
  to: z.string().email(),
  clubs: z.array(z.object({
    club_id: z.string().uuid(),
    gl_man: money,
    gl_woman: money,
    tables: z.array(z.object({
      key: z.string().min(3).max(300),
      club_pays: money,
      fuoco_part: money,
    })).max(200),
  })).max(300),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid disclosure')
  const body = parsed.data

  const sb = await createServiceClient()
  const brand = await getBrand(sb, id)
  if (!brand) return err('Promoter not found', 404)
  const known = await loadDisclosureClubs(sb, id)
  if (!known?.length) return err('This promoter has no clubs or tables to disclose')

  const input = new Map(body.clubs.map(c => [c.club_id, c]))
  const clubs: DisclosureEmailClub[] = []
  for (const k of known) {
    const c = input.get(k.club_id)
    const terms = new Map((c?.tables ?? []).map(t => [t.key, t]))
    const tables = k.tables.map(t => {
      const tt = terms.get(t.key) ?? { club_pays: null, fuoco_part: null }
      return { ...t, club_pays: tt.club_pays, fuoco_part: tt.fuoco_part, promoter_part: promoterPart(tt) }
    })
    const bad = tables.find(t => t.promoter_part != null && t.promoter_part < 0)
    if (bad) return err(`${k.club_name} · ${bad.name}: Club Fuoco's part is more than the club pays`)
    const gl_man = c?.gl_man ?? null
    const gl_woman = c?.gl_woman ?? null
    // A club with no tables and no guestlist prices has nothing to disclose.
    if (!tables.length && gl_man == null && gl_woman == null) continue
    clubs.push({
      club_name: k.club_name, tables,
      gl_man, gl_woman, gl_man_half: half(gl_man), gl_woman_half: half(gl_woman),
    })
  }
  if (!clubs.length) return err('Nothing to disclose yet — add guestlist prices or rank them on a table')

  const sentAt = new Date().toISOString()
  let sent: boolean
  try {
    sent = await sendPromoterDisclosure({
      to: body.to, displayName: brand.name, clubs, statement: DISCLOSURE_STATEMENT, sentAt,
    })
  } catch (e) {
    return err(`Email failed: ${e instanceof Error ? e.message : 'unknown error'}`, 502)
  }
  if (!sent) return err('Email is not configured (RESEND_API_KEY missing)', 503)

  const tableCount = clubs.reduce((n, c) => n + c.tables.length, 0)
  await logAudit(sb, {
    action: 'brand.disclosure_sent',
    summary: `Sent disclosure (${clubs.length} club${clubs.length === 1 ? '' : 's'}, ${tableCount} table${tableCount === 1 ? '' : 's'}) to ${body.to} for ${brand.name}`,
    target_type: 'brand',
    target_id: brand.id,
    meta: { to: body.to, sent_at: sentAt, statement: DISCLOSURE_STATEMENT, clubs },
  })

  return ok({ sent: true, to: body.to })
}
