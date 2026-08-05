# Testing the promoter card-on-file flow (no real cards)

The €2 verification hold, the card-save, the in-app declined-card hint, and the
failed-charge push all touch Stripe. **Production uses LIVE Stripe keys**
(`sk_live_…` in `.env.local`), so the real flow must NEVER be exercised against
them — a live run would need a real card and move real money. Two safe layers:

## 1. Always-on: unit tests (no Stripe, no keys, no cards)

`src/lib/promoter-billing.test.ts` covers the logic with hand-built fakes:
- the €2 session is an **authorization** (`capture_method: 'manual'`, €2), not a
  captured charge, and saves the card (`setup_future_usage: 'off_session'`);
- `applyCardVerification` saves the card as default **and cancels the PI**
  (releases the hold), and does *not* cancel a non-authorization PI;
- `failureNotification` fires **once**, only on the transition into a gated
  state, with the message tailored to the reason.

```bash
npx vitest run src/lib/promoter-billing.test.ts
```

These run in CI and are the everyday regression guard.

## 2. Real end-to-end: Stripe TEST MODE + test cards

Exercises the actual hosted Checkout and webhook. Isolated from production —
test-mode money is fake and never settles.

### One-time setup (needs a human — interactive)
1. In the Stripe Dashboard, flip to **Test mode**, then Developers → API keys.
   Copy the **test** secret + publishable keys (`sk_test_…`, `pk_test_…`).
2. Put them (and the test webhook secret from step 4) in a **gitignored**
   `.env.test.local`, and run the dev server with that env — NOT `.env.local`.
   Never commit test keys; never paste secret keys into chat.
3. Install the Stripe CLI: `brew install stripe/stripe-cli/stripe`.
4. `stripe login`, then forward webhooks to the local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Use the `whsec_…` it prints as `STRIPE_WEBHOOK_SECRET` in `.env.test.local`.

### Test cards (Stripe's fakes — not real numbers)
| Card | What it exercises |
| --- | --- |
| `4242 4242 4242 4242` | Happy path: €2 auth → webhook cancels it (hold released) → card saved, `card_verified: true`. |
| `4000 0000 0000 0002` | Declined at authorization → Checkout errors inline, session never completes → back in the app, **Gap A** hint: "That card wasn't added…". |
| `4000 0000 0000 9995` | Insufficient funds at auth → same declined path. |
| `4000 0000 0000 0341` | Attaches at setup but **fails on the later off-session charge** → run the billing job to hit **Gap B** (`recordFailure` → push). |
Any future expiry, any CVC, any postcode.

### Scenarios
- **€2 hold + release + save:** open the app → an offer → Front-screen promotion
  → Add a payment method → complete Checkout with `4242…`. Confirm in the Stripe
  test dashboard: a €2 PaymentIntent goes `requires_capture` → `canceled`, and a
  card is attached to the customer as default. App shows "card ending 4242 on
  file".
- **Declined card (Gap A):** same, but `4000…0002`. Confirm the app shows the
  wine "Try another card" hint on return and nothing is charged.
- **Failed off-session charge (Gap B):** save `4000…0341`, then invoke the
  billing cron locally:
  ```bash
  curl -X POST localhost:3000/api/admin/promoter-billing/charge-due \
    -H "authorization: Bearer $CRON_SECRET"
  ```
  Confirm the account goes `past_due` and a single push is delivered (needs the
  APNs test env + a registered device token — see the push notes).

## Note on production APNs
The Gap B push, like all pushes, is gated on the `APNS_*` env vars in Vercel and
a registered `device_tokens` row. Verify delivery during the test-mode run.
