// Where Stripe returns a promoter after hosted onboarding.
//
// Onboarding opens in a browser, so this page's only real job is to send them
// back to the app. It deliberately does NOT claim they are approved: Stripe
// returns here whether they finished, gave up, or were left pending review, and
// the truthful answer lives in the app, which reads charges_enabled from Stripe
// itself.

export const dynamic = 'force-dynamic'

export default async function PayoutsDone({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const expired = state === 'expired'

  return (
    <div style={{
      minHeight: '100vh', background: '#0A0807', color: '#F4ECDD',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-geist-sans, system-ui)', padding: 24,
    }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
          fontSize: 12, color: '#E8B65B', letterSpacing: 2, textTransform: 'uppercase',
        }}>
          Club Fuoco
        </div>
        <h1 style={{
          fontFamily: 'var(--font-instrument-serif, Georgia, serif)',
          fontSize: 34, lineHeight: 1.1, margin: '10px 0 0',
        }}>
          {expired ? 'That link expired' : 'All set on Stripe'}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(244,236,221,0.75)', marginTop: 12 }}>
          {expired
            ? 'Stripe’s setup links only work once. Open payouts in the app again and it’ll give you a fresh one — nothing you already entered is lost.'
            : 'Head back to Fuoco For Promoters. If Stripe still needs anything from you, the payouts screen will say exactly what.'}
        </p>
        <a
          href="fuocopromoters://payouts"
          style={{
            display: 'inline-block', marginTop: 22, padding: '13px 26px',
            borderRadius: 999, background: '#C2562D', color: '#FFF6E5',
            fontWeight: 600, fontSize: 15, textDecoration: 'none',
          }}
        >
          Back to the app
        </a>
      </div>
    </div>
  )
}
