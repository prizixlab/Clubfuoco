import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { sendTicketConfirmation, sendAdminTicketAlert } from '@/lib/email'
import { pushWalletUpdate } from '@/lib/wallet/push'
import { applyCardVerification } from '@/lib/promoter-billing'
import { syncAccount } from '@/lib/connect'
import type Stripe from 'stripe'

// Uses Postgres sequence to give each new paid member a unique sequential number
async function nextMemberNumber(supabase: Awaited<ReturnType<typeof createServiceClient>>) {
  const { data } = await supabase.rpc('next_member_number')
  return (data as number) ?? null
}

// POST /api/webhooks/stripe
// Handles all Stripe events — payment confirmations, subscription lifecycle
// Must be excluded from CSRF protection (raw body required)
export async function POST(request: NextRequest) {
  const body      = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Two secrets, because Connect events arrive from a SEPARATE endpoint.
  //
  // account.updated for a connected account is only delivered to a
  // Connect-enabled webhook endpoint, and Stripe gives that endpoint its own
  // signing secret. Verifying against one secret only would mean every Connect
  // event failed signature verification and was silently dropped — which is
  // exactly what was happening to syncAccount.
  //
  // Try each in turn; the event is genuine if either verifies.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter(Boolean) as string[]

  let event: Stripe.Event | null = null
  let lastError = 'no webhook secret configured'
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret)
      break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  if (!event) {
    console.error('Stripe webhook signature verification failed:', lastError)
    return NextResponse.json({ error: lastError }, { status: 400 })
  }

  // Service client bypasses RLS — needed for cross-user updates
  const supabase = await createServiceClient()

  try {
    switch (event.type) {
      // ---- One-time booking payments ----

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const m = session.metadata

        // ---- A paid spot on a promoter's event ----
        //
        // THIS is where a spot becomes real. Not the success_url — a guest who
        // closes the tab, loses signal, or never gets redirected has still paid,
        // and the money landing is the only fact that counts.
        //
        // Idempotent on payment_status: Stripe retries this event, and marking
        // an already-paid row paid again must stay a no-op.
        if (session.mode === 'payment' && m?.purpose === 'event_spot' && m?.guest_id) {
          // Its own try, deliberately OUTSIDE the handler's catch-all below.
          // That catch logs and returns 200, so Stripe never retries — which is
          // survivable for a subscription tidy-up and not survivable here: a
          // guest has been charged, and if we fail to record it we need Stripe
          // to keep asking until we get it right.
          try {
            const { error: payErr } = await supabase
              .from('promoter_guests')
              .update({
                payment_status: 'paid',
                paid_at: new Date().toISOString(),
                hold_expires_at: null,        // it is theirs now; nothing to expire
                stripe_payment_intent_id: (session.payment_intent as string) ?? null,
              })
              .eq('id', m.guest_id)
              .neq('payment_status', 'paid')  // idempotent: retries are no-ops
            if (payErr) throw new Error(payErr.message)
          } catch (e) {
            console.error('[webhook] event_spot: could not mark paid —',
              m.guest_id, e instanceof Error ? e.message : e)
            return NextResponse.json({ error: 'could not record payment' }, { status: 500 })
          }
          break
        }

        // ---- Promoter card-on-file (€2 verification hold, then released) ----
        if (session.mode === 'payment' && m?.purpose === 'card_verification' && m?.promoter_id) {
          await applyCardVerification(supabase, stripe, session)
          break
        }

        // ---- Promoter card-on-file (legacy €0 setup mode) ----
        // Kept so any in-flight setup-mode session still lands its card; new
        // sessions use the €2 verification path above.
        if (session.mode === 'setup' && m?.promoter_id) {
          const si = await stripe.setupIntents.retrieve(session.setup_intent as string)
          const pmId = si.payment_method as string | null
          if (pmId && session.customer) {
            const pm = await stripe.paymentMethods.retrieve(pmId)
            // Make it the customer's default for off-session charges.
            await stripe.customers.update(session.customer as string, {
              invoice_settings: { default_payment_method: pmId },
            })
            await supabase.from('promoter_billing_accounts').upsert({
              user_id: m.promoter_id,
              stripe_customer_id: session.customer as string,
              default_payment_method_id: pmId,
              card_verified: true,
              card_brand: pm.card?.brand ?? null,
              card_last4: pm.card?.last4 ?? null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })
          }
          break
        }

        // ---- Membership subscription checkout ----
        if (m?.tier && !m?.booking_type && session.mode === 'subscription') {
          const userId = m.user_id
          const tier   = m.tier as 'gold' | 'sapphire' | 'black'
          const subId  = session.subscription as string | null

          if (userId && subId) {
            await supabase
              .from('memberships')
              .upsert(
                {
                  user_id:                userId,
                  tier,
                  stripe_subscription_id: subId,
                  status:                 'active',
                  valid_from:             new Date().toISOString(),
                },
                { onConflict: 'user_id' }
              )

            // Assign sequential member number on first paid membership (never overwrite)
            const { data: existing } = await supabase
              .from('users')
              .select('member_number')
              .eq('id', userId)
              .single()

            const needsNumber = !existing?.member_number
            await supabase
              .from('users')
              .update({
                membership_tier: tier,
                ...(needsNumber
                  ? { member_number: await nextMemberNumber(supabase) }
                  : {}),
              })
              .eq('id', userId)

            // Push pass update to any registered Apple Wallet devices
            void pushWalletUpdate(userId)
          }
          break
        }

        // ---- Gig / ticket payment checkout ----
        if (!m?.booking_type) break  // not a gig payment

        // Mark payment as paid
        await supabase
          .from('gig_payments')
          .update({ status: 'paid', stripe_payment_intent_id: session.payment_intent as string })
          .eq('stripe_session_id', session.id)

        // Update booking payment_status
        const table = m.booking_type === 'request' ? 'gig_requests' : 'gig_applications'
        await supabase
          .from(table)
          .update({ payment_status: 'paid' })
          .eq('id', m.booking_id)

        // Notify DJ
        if (m.dj_user_id) {
          const { data: club } = await supabase.from('clubs').select('name').eq('id', m.club_id).single()
          await supabase.from('notifications').insert({
            user_id: m.dj_user_id,
            type: 'gig_paid',
            title: `Payment received — €${(+m.net_cents / 100).toFixed(2)}`,
            body: `${club?.name} paid your booking fee via Club Fuoco`,
            is_read: false,
          })
        }
        break
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.qr_token) {
          await supabase
            .from('bookings')
            .update({
              status:          'confirmed',
              stripe_charge_id: pi.latest_charge as string,
            })
            .eq('stripe_payment_intent_id', pi.id)
            .eq('status', 'pending')
        }
        // Ticket order payment
        if (pi.metadata?.event_name) {
          // Mark order paid and fetch full order details
          const { data: order } = await supabase
            .from('ticket_orders')
            .update({ status: 'paid' })
            .eq('stripe_payment_intent', pi.id)
            .select()
            .single()

          // In-app notification
          if (pi.metadata.user_id) {
            await supabase.from('notifications').insert({
              user_id: pi.metadata.user_id,
              type:    'ticket_paid',
              title:   'Tickets confirmed!',
              body:    `Your tickets for ${pi.metadata.event_name} at ${pi.metadata.venue_name} are confirmed. Check your email — we're sending them now.`,
              is_read: false,
            })

            // Look up user's email
            const { data: userData } = await supabase
              .from('users')
              .select('email')
              .eq('id', pi.metadata.user_id)
              .single()

            if (userData?.email && order) {
              // Send confirmation to customer
              await sendTicketConfirmation({
                to:             userData.email,
                orderId:        order.id,
                eventName:      order.event_name,
                venueName:      order.venue_name,
                eventDate:      order.event_date,
                quantity:       order.quantity,
                basePriceCents: order.base_price_cents,
                markupCents:    order.markup_cents,
                totalCents:     order.total_cents,
                currency:       pi.currency.toUpperCase(),
                platform:       order.platform,
              })

              // Alert admin to fulfil the order
              await sendAdminTicketAlert({
                orderId:         order.id,
                userEmail:       userData.email,
                eventName:       order.event_name,
                venueName:       order.venue_name,
                eventDate:       order.event_date,
                quantity:        order.quantity,
                totalCents:      order.total_cents,
                currency:        pi.currency.toUpperCase(),
                platform:        order.platform,
                platformEventId: order.platform_event_id,
              })
            }
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.qr_token) {
          await supabase
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('stripe_payment_intent_id', pi.id)
        }
        if (pi.metadata?.event_name) {
          await supabase
            .from('ticket_orders')
            .update({ status: 'payment_failed' })
            .eq('stripe_payment_intent', pi.id)
        }
        break
      }

      // ---- Subscription lifecycle ----

      case 'customer.subscription.updated': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        if (!userId) break

        const isActive  = sub.status === 'active'
        const newStatus = isActive ? 'active' : 'past_due'
        const tier      = sub.metadata?.tier as 'gold' | 'sapphire' | 'black' | undefined

        // Upsert so this also handles the native Payment Sheet path
        // (subscription goes directly from incomplete → active without a checkout session)
        await supabase
          .from('memberships')
          .upsert(
            {
              user_id:                userId,
              tier:                   tier ?? 'gold',
              stripe_subscription_id: sub.id,
              status:                 newStatus,
              valid_from:             new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )

        if (isActive && tier) {
          // Assign member number if not yet assigned (idempotent — never overwrites)
          const { data: existing } = await supabase
            .from('users')
            .select('member_number')
            .eq('id', userId)
            .single()

          const needsNumber = !existing?.member_number
          await supabase
            .from('users')
            .update({
              membership_tier: tier,
              ...(needsNumber
                ? { member_number: await nextMemberNumber(supabase) }
                : {}),
            })
            .eq('id', userId)
        }

        // Push updated pass (reflects new status / tier)
        void pushWalletUpdate(userId)
        break
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        if (!userId) break

        await supabase
          .from('memberships')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id)

        await supabase
          .from('users')
          .update({ membership_tier: 'free' })
          .eq('id', userId)

        // Push to registered devices — they'll get a 410 Gone and remove the pass
        void pushWalletUpdate(userId)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = (invoice as any).subscription as string | null
        if (subId) {
          await supabase
            .from('memberships')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subId)
        }
        break
      }

      // ---- A promoter's Connect account changed ----
      //
      // Stripe owns the truth about whether someone can be paid; this mirrors
      // it so the app can gate pricing on charges_enabled without calling the
      // API on every screen. Fires throughout onboarding and again whenever
      // Stripe later demands more (a document expiring, a threshold crossed).
      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        await syncAccount(supabase, account)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = (invoice as any).subscription as string | null
        if (subId) {
          await supabase
            .from('memberships')
            .update({ status: 'active' })
            .eq('stripe_subscription_id', subId)
        }
        break
      }
    }
  } catch (err) {
    console.error('Error processing Stripe webhook event:', event.type, err)
    // Return 200 anyway — Stripe will retry on 5xx
  }

  return NextResponse.json({ received: true })
}
