import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err, generateQRToken } from '@/lib/utils'
import { stripe, calculateOrderTotal } from '@/lib/stripe'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  action:            z.enum(['join', 'decline', 'maybe']).default('join'),
  payment_method_id: z.string().optional(),
})

// POST /api/groups/[id]/join — RSVP to a group. Paying members supply a
// payment_method_id and are charged their own share; guests just confirm.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return err('Invalid request')
  const { action, payment_method_id } = parsed.data

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select('id, club_id, organizer_id, booking_type, booking_date, status, clubs(name, general_entry_price, vip_table_min_spend, is_partner)')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return err('Group not found', 404)

  const { data: existing } = await sb
    .from('booking_group_members')
    .select('id, rsvp, payment_required, amount_due, paid, booking_id')
    .eq('group_id', groupId)
    .eq('user_id', me)
    .maybeSingle()

  // ── Decline ────────────────────────────────────────────────────────────────
  if (action === 'decline') {
    if (!existing) return ok({ rsvp: 'declined' })
    await sb.from('booking_group_members').update({ rsvp: 'declined' }).eq('id', existing.id)
    return ok({ rsvp: 'declined' })
  }

  // ── Maybe (tentative) — no booking, no charge ────────────────────────────────
  if (action === 'maybe') {
    if (group.status !== 'open') return err('This group is closed', 400)
    if (existing?.paid) return err('You already paid for this group', 400)
    const { error: mbErr } = existing
      ? await sb.from('booking_group_members').update({ rsvp: 'maybe' }).eq('id', existing.id)
      : await sb.from('booking_group_members').insert({
          group_id: groupId, user_id: me, role: 'member', rsvp: 'maybe',
          payment_required: false, amount_due: null,
        })
    if (mbErr) {
      if (/check constraint|rsvp/i.test(mbErr.message)) {
        return err('Run the group_rsvp_maybe migration in Supabase (allows the maybe state).', 503)
      }
      return err(mbErr.message)
    }
    return ok({ rsvp: 'maybe' })
  }

  // ── Join ─────────────────────────────────────────────────────────────────--
  if (group.status !== 'open') return err('This group is closed', 400)

  // Already fully joined → idempotent
  if (existing && existing.rsvp === 'going' && existing.booking_id) {
    return ok({ rsvp: 'going', booking_id: existing.booking_id })
  }

  // The host always covers the group, so guests joining via an invite link are
  // never charged — they just RSVP. (Pre-listed members keep whatever the
  // organizer allocated to them.)
  const paymentRequired = existing ? existing.payment_required : false
  // Custom organizer allocation (e.g. a split VIP table) overrides club pricing.
  const customAmount = existing && existing.amount_due != null ? Number(existing.amount_due) : null

  const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
  const unitPrice = group.booking_type === 'vip' ? club?.vip_table_min_spend : club?.general_entry_price
  // A VIP table must have a price; general entry may legitimately be free (0 or
  // null) — e.g. a free guestlist night — and joins at no charge.
  if (group.booking_type === 'vip' && customAmount == null && !unitPrice) {
    return err('Pricing not available', 400)
  }

  const { data: profile } = await sb
    .from('users')
    .select('membership_tier, stripe_customer_id, full_name')
    .eq('id', me)
    .maybeSingle()

  const qrToken = generateQRToken()
  let total = 0
  let platformFee = 0
  let paymentIntentId: string | null = null

  // What this member actually owes: a custom organizer allocation, else the
  // club's per-person price when they're a payer, else 0 (free entry).
  const chargeUnit = customAmount != null ? customAmount : (paymentRequired ? (unitPrice ?? 0) : 0)
  const willCharge = chargeUnit > 0

  if (willCharge) {
    if (!payment_method_id) return err('Payment required', 402)
    const calc = customAmount != null
      ? calculateOrderTotal(customAmount, 1, 'free', false)
      : calculateOrderTotal(unitPrice, 1, profile?.membership_tier ?? 'free', club?.is_partner ?? false)
    total = calc.total
    platformFee = calc.platformFee
    try {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'eur',
        customer: profile?.stripe_customer_id ?? undefined,
        payment_method: payment_method_id,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { group_id: groupId, user_id: me, qr_token: qrToken },
      })
      paymentIntentId = intent.id
    } catch (e: any) {
      return err(e.message ?? 'Payment failed', 402)
    }
  }

  // Each member's entry is a normal booking row (own QR / wallet pass).
  const { data: booking, error: bErr } = await sb
    .from('bookings')
    .insert({
      user_id:                  me,
      club_id:                  group.club_id,
      booking_type:             group.booking_type,
      party_size:               1,
      booking_date:             group.booking_date,
      status:                   'confirmed',
      stripe_payment_intent_id: paymentIntentId,
      unit_price:               chargeUnit,
      total_amount:             total,
      platform_fee:             platformFee,
      qr_code_token:            qrToken,
    })
    .select('id')
    .single()
  if (bErr || !booking) return err(bErr?.message ?? 'Could not create entry')

  // Upsert my membership as "going"
  if (existing) {
    await sb.from('booking_group_members')
      .update({ rsvp: 'going', paid: willCharge, booking_id: booking.id })
      .eq('id', existing.id)
  } else {
    await sb.from('booking_group_members').insert({
      group_id: groupId, user_id: me, role: 'member', rsvp: 'going',
      payment_required: willCharge, paid: willCharge, booking_id: booking.id,
    })
  }

  // Tell the organizer someone joined
  if (group.organizer_id !== me) {
    const myName = profile?.full_name?.trim() || 'A friend'
    await notify({
      user_id: group.organizer_id,
      type: 'group_join',
      title: `${myName} joined your group at ${club?.name ?? 'the club'}`,
      link: `/groups/placeholder?id=${groupId}`,
    })
  }

  return ok({ rsvp: 'going', booking_id: booking.id, qr_token: qrToken })
}
