'use client'

import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Script from 'next/script'

// The locked half of /investors. This is the ONLY part of the page that ships
// to a visitor who hasn't unlocked — the gated content is a separate server
// component, so it is never in this bundle. The code is verified by
// POST /api/investors/unlock; nothing here knows what it is.

// Dev-only crib so nobody working on this page has to dig the code out of an
// intro email. Set NEXT_PUBLIC_INVESTOR_PREVIEW_CODE in .env.local; the
// NODE_ENV guard compiles the hint out of production builds regardless.
const PREVIEW_HINT =
  process.env.NODE_ENV !== 'production'
    ? process.env.NEXT_PUBLIC_INVESTOR_PREVIEW_CODE ?? null
    : null

export default function InvestorsGate() {
  const router = useRouter()
  const [code,    setCode]    = useState('')
  const [err,     setErr]     = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSending(true)
    setErr(null)
    try {
      const res = await fetch('/api/investors/unlock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      })
      if (!res.ok) {
        setErr('That code didn’t match. Check the intro email or request access.')
        return
      }
      // The cookie is set; re-render the server page, which will now pass the
      // gate and send down the real content.
      router.refresh()
    } catch {
      setErr('Couldn’t reach the server. Try again in a moment.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="" />
      <main className="auth-wrap">
        <div className="page-glow" aria-hidden="true" />
        <form className="auth-card" onSubmit={unlock} autoComplete="off">
          <span className="eyebrow">For Investors</span>
          <h1>Enter access code</h1>
          <p className="hint">
            This area is private. Enter the code from your intro email to view
            metrics and materials.
          </p>
          <div className="field">
            <label htmlFor="code">Access code</label>
            <input
              type="text"
              id="code"
              name="code"
              placeholder="••••••••"
              value={code}
              onChange={e => setCode(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? 'Checking…' : 'Unlock →'}
          </button>
          {err && <p className="error-msg" style={{ marginTop: 10 }}>{err}</p>}
          {PREVIEW_HINT && (
            <p className="auth-note">Preview code — {PREVIEW_HINT}</p>
          )}
          <p className="auth-foot">
            No code?{' '}
            <a href="mailto:invest@clubfuoco.com">Request access</a>
          </p>
        </form>
      </main>
      <MiniFooter />
      <Script src="/motion.js" strategy="afterInteractive" />
    </div>
  )
}
