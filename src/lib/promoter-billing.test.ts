import { describe, expect, it, vi } from 'vitest'
import {
  buildCardVerificationSession,
  applyCardVerification,
  failureNotification,
} from './promoter-billing'

// These cover the promoter card-on-file logic without touching Stripe — the
// routes run against LIVE Stripe keys, so real end-to-end runs must use Stripe
// test mode (see docs), never this suite.

describe('buildCardVerificationSession', () => {
  const s = buildCardVerificationSession('cus_123', 'user-abc', 'https://clubfuoco.com')

  it('is a €2 authorization, not a captured charge', () => {
    expect(s.mode).toBe('payment')
    expect(s.line_items?.[0]?.price_data?.unit_amount).toBe(200)
    expect(s.line_items?.[0]?.price_data?.currency).toBe('eur')
    // capture_method manual = authorize only; the webhook voids it.
    expect(s.payment_intent_data?.capture_method).toBe('manual')
  })

  it('saves the card for later off-session billing', () => {
    expect(s.payment_intent_data?.setup_future_usage).toBe('off_session')
  })

  it('tags the session so the webhook can route it', () => {
    expect(s.metadata).toMatchObject({ promoter_id: 'user-abc', purpose: 'card_verification' })
    expect(s.payment_intent_data?.metadata).toMatchObject({ purpose: 'card_verification' })
  })
})

// ── applyCardVerification: fakes shaped like the calls it makes ───────────────

function fakeStripe(piStatus: string) {
  const cancel = vi.fn(async (id: string) => ({ id, status: 'canceled' }))
  const customersUpdate = vi.fn(async () => ({}))
  const stripe = {
    paymentIntents: {
      retrieve: async (id: string) => ({ id, status: piStatus, payment_method: 'pm_1' }),
      cancel,
    },
    paymentMethods: {
      retrieve: async () => ({ card: { brand: 'visa', last4: '4242' } }),
    },
    customers: { update: customersUpdate },
  }
  return { stripe, cancel, customersUpdate }
}

function fakeSb() {
  const upserts: Record<string, unknown>[] = []
  const sb = {
    from() {
      return { upsert: (row: Record<string, unknown>) => { upserts.push(row); return Promise.resolve({ error: null }) } }
    },
  }
  return { sb, upserts }
}

const session = (over: Record<string, unknown> = {}) => ({
  payment_intent: 'pi_1', customer: 'cus_1', metadata: { promoter_id: 'u1' }, ...over,
}) as never

describe('applyCardVerification', () => {
  it('saves the card as default and releases the €2 hold', async () => {
    const { stripe, cancel, customersUpdate } = fakeStripe('requires_capture')
    const { sb, upserts } = fakeSb()

    await applyCardVerification(sb as never, stripe as never, session())

    // Card saved + marked verified.
    expect(upserts[0]).toMatchObject({
      user_id: 'u1', default_payment_method_id: 'pm_1', card_verified: true,
      card_brand: 'visa', card_last4: '4242',
    })
    // Made the customer's default for off-session charges.
    expect(customersUpdate).toHaveBeenCalledWith('cus_1', { invoice_settings: { default_payment_method: 'pm_1' } })
    // The €2 hold is voided, so no money is ever taken.
    expect(cancel).toHaveBeenCalledWith('pi_1')
  })

  it('does not cancel a PI that is not an open authorization', async () => {
    const { stripe, cancel } = fakeStripe('succeeded')
    const { sb } = fakeSb()
    await applyCardVerification(sb as never, stripe as never, session())
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('failureNotification', () => {
  it('notifies once — only on the transition into a gated state', () => {
    expect(failureNotification('charge_failed', 'active')).not.toBeNull()
    // Already past_due: a later failed night must not fire another push.
    expect(failureNotification('charge_failed', 'past_due')).toBeNull()
    expect(failureNotification('charge_failed', 'blocked')).toBeNull()
  })

  it('tailors the message to why it failed', () => {
    expect(failureNotification('no_card_on_file', 'active')?.body).toMatch(/Add a card/)
    expect(failureNotification('card_declined', 'active')?.body).toMatch(/didn’t go through/)
  })
})
