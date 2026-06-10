import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { generateInviteCode } from '@/lib/groups'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const createSchema = z.object({
  club_id:      z.string().uuid(),
  booking_type: z.enum(['general', 'vip']),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  organizer_pays: z.boolean().default(true),
  organizer_amount: z.number().nonnegative().optional(),  // custom € the organizer pays (e.g. a VIP table)
  members: z.array(z.object({
    user_id:          z.string().uuid(),
    payment_required: z.boolean(),
    amount_due:       z.number().nonnegative().optional(),
  })).max(19).default([]),
})

// GET /api/groups — groups I organize or belong to (lightweight list)
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const sb = await createServiceClient()

  const { data: mine } = await sb
    .from('booking_group_members')
    .select('group_id')
    .eq('user_id', me)
  const ids = (mine ?? []).map(r => r.group_id)
  if (!ids.length) return ok([])

  const { data: groups } = await sb
    .from('booking_groups')
    .select('id, booking_type, booking_date, status, invite_code, clubs(name, cover_image_url)')
    .in('id', ids)
    .order('booking_date', { ascending: false })

  return ok(groups ?? [])
}

// POST /api/groups — create a group, invite friends, set who pays
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { club_id, booking_type, booking_date, organizer_pays, organizer_amount, members } = parsed.data

  const sb = await createServiceClient()

  // Validate club + pricing
  const { data: club } = await sb
    .from('clubs')
    .select('id, name, is_active, general_entry_price, vip_table_min_spend')
    .eq('id', club_id)
    .maybeSingle()
  if (!club || !club.is_active) return err('Club not found', 404)

  const unitPrice = booking_type === 'vip' ? club.vip_table_min_spend : club.general_entry_price
  // Club per-person pricing is only needed when someone relies on it — i.e. a
  // payer with no custom amount. Rumbalist groups pass organizer_amount / custom
  // per-member amounts (e.g. a €400 VIP table), so a missing club price is fine.
  const needsClubPrice =
    (organizer_pays && organizer_amount == null) ||
    members.some(m => m.payment_required && m.amount_due == null)
  if (needsClubPrice && !unitPrice) return err('Pricing not available for this club', 400)

  // De-dupe invited members and drop the organizer if they slipped in
  const invited = members.filter((m, i) =>
    m.user_id !== me && members.findIndex(x => x.user_id === m.user_id) === i)

  // Unique invite code (retry a couple of times on the rare collision)
  let invite_code = generateInviteCode()
  for (let i = 0; i < 3; i++) {
    const { data: clash } = await sb.from('booking_groups').select('id').eq('invite_code', invite_code).maybeSingle()
    if (!clash) break
    invite_code = generateInviteCode()
  }

  const { data: group, error: gErr } = await sb
    .from('booking_groups')
    .insert({ club_id, organizer_id: me, booking_type, booking_date, invite_code, status: 'open' })
    .select('id')
    .single()
  if (gErr || !group) return err(gErr?.message ?? 'Could not create group')

  // Organizer is a "going" member; pays their own entry from the group screen.
  const memberRows = [
    {
      group_id: group.id, user_id: me, role: 'organizer', rsvp: 'going',
      payment_required: organizer_pays || (organizer_amount ?? 0) > 0,
      amount_due: organizer_amount ?? null,
    },
    ...invited.map(m => ({
      group_id: group.id, user_id: m.user_id, role: 'member', rsvp: 'invited',
      payment_required: m.payment_required || (m.amount_due ?? 0) > 0,
      amount_due: m.amount_due ?? null,
    })),
  ]
  const { error: mErr } = await sb.from('booking_group_members').insert(memberRows)
  if (mErr) return err(mErr.message)

  // Notify invited friends
  const { data: meRow } = await sb.from('users').select('full_name').eq('id', me).maybeSingle()
  const myName = meRow?.full_name?.trim() || 'A friend'
  await Promise.all(invited.map(m =>
    notify({
      user_id: m.user_id,
      type: 'group_invite',
      title: `${myName} invited you out at ${club.name}`,
      body: m.payment_required ? 'Tap to join and grab your spot.' : "You're on the list — tap to confirm.",
      link: `/groups/placeholder?id=${group.id}`,
    }),
  ))

  return ok({ id: group.id, invite_code }, 201)
}
