import { NextRequest } from 'next/server'
import { z } from 'zod'
import { stripe }        from '@/lib/stripe'
import { requireAuth }   from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err }       from '@/lib/utils'
import { TICKET_MARKUP } from '@/lib/tickets'

// POST /api/tickets
// Body: { platform_event_id, quantity, venue_place_id? }
//
// The price, name, venue and date come from OUR `events` row for that event —
// never from the body. This route used to take base_price_cents from the
// client: sending 0 wrote a 'paid' order for anything, and any figure was
// charged as sent. Older clients still send the display fields; they are
// ignored.
const schema = z.object({
  platform_event_id: z.string().min(1),
  quantity:          z.number().int().min(1).max(10).default(1),
  venue_place_id:    z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return err('Missing or invalid fields')
  const { platform_event_id, quantity, venue_place_id } = parsed.data

  const supabase = await createServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('source_ref, origin, title, venue_name, date, base_price, currency, sold_out')
    .eq('source_ref', platform_event_id)
    .maybeSingle()
  if (!event) return err('This event isn’t on sale here.', 404)
  if (event.sold_out) return err('This event has sold out.', 409)

  const base_price_cents = Math.round(Number(event.base_price ?? 0))
  // A price we don't know reads as 0 in `events` (the RA listing query doesn't
  // expose one) — that is "unknown", not "free", so it is not sold here.
  if (!(base_price_cents > 0)) return err('This event isn’t on sale here.', 409)

  const markup_cents = Math.ceil(base_price_cents * TICKET_MARKUP)
  const unit_total   = base_price_cents + markup_cents
  const total_cents  = unit_total * quantity
  const currency     = String(event.currency || 'EUR').toLowerCase()
  const platform     = String(event.origin ?? 'manual')

  let intent
  try {
    intent = await stripe.paymentIntents.create({
      amount:   total_cents,
      currency,
      metadata: {
        user_id:           user!.id,
        platform,
        platform_event_id,
        event_name:        event.title ?? '',
        venue_name:        event.venue_name ?? '',
        venue_place_id:    venue_place_id ?? '',
        quantity:          String(quantity),
      },
    })
  } catch (e) {
    console.error('[tickets] stripe:', e instanceof Error ? e.message : e)
    return err('We couldn’t start the payment. You haven’t been charged.', 502)
  }

  const { data: order, error } = await supabase
    .from('ticket_orders')
    .insert({
      user_id:             user!.id,
      platform,
      platform_event_id,
      event_name:          event.title,
      venue_name:          event.venue_name,
      venue_place_id:      venue_place_id ?? null,
      event_date:          event.date ?? null,
      quantity,
      base_price_cents,
      markup_cents,
      total_cents,
      stripe_payment_intent: intent.id,
      status:              'pending',
    })
    .select()
    .single()

  if (error) {
    // No order to attach a payment to — make sure it can't be paid.
    await stripe.paymentIntents.cancel(intent.id).catch(() => {})
    console.error('[tickets] order insert:', error.message)
    return err('We couldn’t start the payment. You haven’t been charged.', 500)
  }

  return ok({
    client_secret: intent.client_secret,
    order_id:      order.id,
    total_cents,
    markup_cents,
  })
}

// GET /api/tickets — list user's ticket orders
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('ticket_orders')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  return ok(data ?? [])
}
