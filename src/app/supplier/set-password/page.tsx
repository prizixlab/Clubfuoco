'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// Landing page for the "create your password" link a supplier receives when the
// operator provisions their access (Supabase invite/recovery email → here).
//
// It uses its OWN supabase-js client (implicit flow, no cookie persistence) so
// it cleanly parses the token from the URL hash without touching the main app's
// cookie session or the middleware. Once a session is present the supplier
// picks a password; then they sign in to the FuocoPromoters app with it.

type Phase = 'loading' | 'ready' | 'invalid' | 'done'

export default function SetPasswordPage() {
  const supabase = useMemo(
    () => createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: true, persistSession: false, autoRefreshToken: false, flowType: 'implicit' } },
    ),
    [],
  )

  const [phase, setPhase]   = useState<Phase>('loading')
  const [email, setEmail]   = useState<string | null>(null)
  const [pw, setPw]         = useState('')
  const [pw2, setPw2]       = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    let done = false
    // The invite/recovery link drops tokens in the URL hash; detectSessionInUrl
    // parses them asynchronously. Fires PASSWORD_RECOVERY (reset) or SIGNED_IN
    // (invite); either way we then have a session to updateUser against.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (done || !session) return
      done = true
      setEmail(session.user.email ?? null)
      setPhase('ready')
    })
    // Fallback: if the event already fired before we subscribed, poll once.
    supabase.auth.getSession().then(({ data }) => {
      if (done) return
      if (data.session) {
        done = true
        setEmail(data.session.user.email ?? null)
        setPhase('ready')
      } else {
        // Give detectSessionInUrl a beat, then give up.
        setTimeout(() => { if (!done) setPhase('invalid') }, 1500)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== pw2)    { setError('Passwords don’t match.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) { setError(error.message); setBusy(false); return }
    setPhase('done')
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.brand}>
          <span style={S.wordmark}>Club Fuoco</span>
          <span style={S.kicker}>Partner access</span>
        </div>

        {phase === 'loading' && <p style={S.dim}>Checking your link…</p>}

        {phase === 'invalid' && (
          <>
            <h1 style={S.h1}>Link expired</h1>
            <p style={S.dim}>
              This set-password link is invalid or has already been used. Ask your
              Club Fuoco contact to resend it from the portal.
            </p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <h1 style={S.h1}>Create your password</h1>
            <p style={S.dim}>{email ? <>For <strong style={{ color: '#F5F5F7' }}>{email}</strong>.</> : null} You’ll use this to sign in to the Fuoco for Promoters app.</p>
            <form onSubmit={submit}>
              <label style={S.label}>New password
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus
                  autoComplete="new-password" placeholder="At least 8 characters" style={S.input} />
              </label>
              <label style={S.label}>Confirm password
                <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                  autoComplete="new-password" placeholder="Repeat it" style={S.input} />
              </label>
              {error && <p style={S.err}>{error}</p>}
              <button type="submit" disabled={busy || !pw || !pw2} style={{ ...S.btn, opacity: busy || !pw || !pw2 ? 0.5 : 1 }}>
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>
          </>
        )}

        {phase === 'done' && (
          <>
            <h1 style={S.h1}>You’re all set</h1>
            <p style={S.dim}>
              Your password is saved. Open the <strong style={{ color: '#F5F5F7' }}>Fuoco for Promoters</strong> app
              and sign in with {email ? <strong style={{ color: '#F5F5F7' }}>{email}</strong> : 'your email'} and the
              password you just chose.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const gold = '#C09950'
const S: Record<string, React.CSSProperties> = {
  page:  { minHeight: '100vh', background: '#0A0A0A', color: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' },
  card:  { width: '100%', maxWidth: 400, background: '#141416', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: 28 },
  brand: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 24 },
  wordmark: { fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: '#EBC073' },
  kicker: { fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: gold, fontWeight: 600 },
  h1:    { margin: '0 0 8px', fontSize: 20, fontWeight: 700 },
  dim:   { margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: 'rgba(245,245,247,0.6)' },
  label: { display: 'block', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,245,247,0.6)', marginBottom: 14, fontWeight: 600 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 7, background: 'rgba(0,0,0,0.35)', color: '#F5F5F7', WebkitTextFillColor: '#F5F5F7', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '11px 12px', fontSize: 15, fontFamily: 'inherit', outline: 'none' },
  err:   { margin: '0 0 12px', fontSize: 13, color: '#FFB4A2' },
  btn:   { width: '100%', height: 48, background: gold, color: '#141416', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', marginTop: 4 },
}
