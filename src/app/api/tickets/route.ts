import { NextRequest } from 'next/server'
import { stripe }        from '@/lib/stripe'
import { requireAuth }   from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err }       from '@/lib/utils'
import { TICKET_MARKUP } from '@/lib/tickets'

// POST /api/tickets
// Body: { platform, platform_event_id, event_name, venue_name, venue_place_id,
//         event_date, quantity, base_price_cents, currency, lat, lng }
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json()
  const {
    platform,
    platform_event_id,
    event_name,
    venue_name,
    venue_place_id,
    event_date,
    quantity    = 1,
    base_price_cents,
    currency    = 'EUR',
  } = body

  if (!event_name || base_price_cents === undefined || base_price_cents === null) return err('Missing required fields')

  const markup_cents = Math.ceil(base_price_cents * TICKET_MARKUP)
  const unit_total   = base_price_cents + markup_cents
  const total_cents  = unit_total * quantity

  const supabase = await createServiceClient()

  // Free events — just record RSVP, no payment required
  if (base_price_cents === 0) {
    const { data: order, error } = await supabase
      .from('ticket_orders')
      .insert({
        user_id:           user!.id,
        platform:          platform ?? 'manual',
        platform_event_id: platform_event_id ?? null,
        event_name,
        venue_name,
        venue_place_id:    venue_place_id ?? null,
        event_date:        event_date ?? null,
        quantity,
        base_price_cents:  0,
        markup_cents:      0,
        total_cents:       0,
        status:            'paid',
      })
      .select()
      .single()
    if (error) return err(error.message)
    return ok({ order_id: order.id, total_cents: 0, markup_cents: 0 })
  }

  // Create Stripe payment intent
  const intent = await stripe.paymentIntents.create({
    amount:   total_cents,
    currency: currency.toLowerCase(),
    metadata: {
      user_id:           user!.id,
      platform:          platform ?? 'manual',
      platform_event_id: platform_event_id ?? '',
      event_name,
      venue_name,
      venue_place_id:    venue_place_id ?? '',
      quantity:          String(quantity),
    },
  })

  // Store pending order
  const { data: order, error } = await supabase
    .from('ticket_orders')
    .insert({
      user_id:             user!.id,
      platform:            platform ?? 'manual',
      platform_event_id:   platform_event_id ?? null,
      event_name,
      venue_name,
      venue_place_id:      venue_place_id ?? null,
      event_date:          event_date ?? null,
      quantity,
      base_price_cents,
      markup_cents,
      total_cents,
      stripe_payment_intent: intent.id,
      status:              'pending',
    })
    .select()
    .single()

  if (error) return err(error.message)

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
