/** Landing page after the promoter completes (or cancels) Stripe card setup. */
export default async function BillingSaved({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; cancelled?: string }>
}) {
  const sp = await searchParams
  const ok = sp.ok === '1'
  return (
    <div style={{
      minHeight: '100vh', background: '#0A0807', color: '#F4ECDD',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', padding: 24,
      fontFamily: 'var(--font-geist-sans, system-ui)',
    }}>
      <div style={{ fontSize: 44, marginBottom: 8 }}>{ok ? '✓' : '—'}</div>
      <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 32, margin: 0 }}>
        {ok ? 'Card saved' : 'Card not saved'}
      </h1>
      <p style={{ color: 'rgba(244,236,221,0.7)', maxWidth: 320, marginTop: 12 }}>
        {ok
          ? 'You can close this and return to Fuoco For Promoters — your card is verified and on file.'
          : 'No card was saved. You can try again from the app whenever you like.'}
      </p>
    </div>
  )
}
