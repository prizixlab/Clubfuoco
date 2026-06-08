'use client'

import '../_web/site.css'
import '../_web/investors.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'
import { useEffect, useState } from 'react'

// Hand-shared code distributed in intro emails. Not a real auth surface —
// the assets behind it (deck, model) are protected separately. The point of
// the gate is to discourage casual public traffic from poking at the page.
const ACCESS_CODE = 'FUOCO2026'
const STORAGE_KEY = 'cf:inv-unlocked'

export default function InvestorsPage() {
  if (process.env.BUILD_TARGET === 'ios') return null
  return <InvestorsClient />
}

function InvestorsClient() {
  const [unlocked, setUnlocked] = useState<boolean>(false)
  const [code,     setCode]     = useState('')
  const [err,      setErr]      = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(STORAGE_KEY) === '1') setUnlocked(true)
  }, [])

  function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (code.trim().toUpperCase() === ACCESS_CODE) {
      window.sessionStorage.setItem(STORAGE_KEY, '1')
      setUnlocked(true)
      return
    }
    setErr('That code didn&rsquo;t match. Check the intro email or request access.')
  }

  if (!unlocked) {
    return (
      <div className="cf-site">
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
            <button type="submit" className="btn btn-primary">Unlock →</button>
            {err && <p className="error-msg" style={{ marginTop: 10 }}>{err}</p>}
            <p className="auth-foot">
              No code?{' '}
              <a href="mailto:invest@clubfuoco.com">Request access</a>
            </p>
          </form>
        </main>
        <MiniFooter />
      </div>
    )
  }

  return (
    <div className="cf-site">
      <div className="grain" aria-hidden="true" />
      <SiteNav active="" />

      <header className="page-hero">
        <div className="page-glow" aria-hidden="true" />
        <p className="eyebrow">For Investors</p>
        <h1>The night is a <span className="gold">market.</span></h1>
        <p className="lead">
          Barcelona is one of Europe&rsquo;s great nightlife cities, run on
          group chats and clipboards. Club Fuoco is the curated layer on top —
          and we&rsquo;re just getting started.
        </p>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">At a glance</span>
            <h2 className="serif-title">Where we are today.</h2>
          </div>
          <div className="metrics">
            <div className="metric"><div className="val">11</div><div className="lbl">Partner venues</div></div>
            <div className="metric"><div className="val small">Barcelona</div><div className="lbl">Launch city</div></div>
            <div className="metric"><div className="val small">Live</div><div className="lbl">App Store status</div></div>
            <div className="metric"><div className="val">2026</div><div className="lbl">Founded</div></div>
            <div className="metric locked"><div className="val small">In deck</div><div className="lbl">MAU</div></div>
            <div className="metric locked"><div className="val small">In deck</div><div className="lbl">GMV run-rate</div></div>
            <div className="metric locked"><div className="val small">In deck</div><div className="lbl">Take rate</div></div>
            <div className="metric locked"><div className="val small">In deck</div><div className="lbl">Retention</div></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="opp-grid">
            <div className="prose">
              <span className="eyebrow" style={{ display: 'block', marginBottom: 16 }}>
                About the opportunity
              </span>
              <p className="lead-p">
                Nightlife is a multi-billion-euro market that almost no software
                touches well. The incumbents are generic event listings; the
                reality runs on relationships.
              </p>
              <p>
                Club Fuoco wins by going deep before going wide — locking
                curated, exclusive inventory in one city through direct operator
                partnerships, then becoming the default way locals plan a night
                out. The same playbook travels to every major nightlife capital
                in Europe.
              </p>
              <p>
                We&rsquo;re raising to deepen Barcelona, expand the partner
                network, and prove the model is repeatable. Full metrics, model,
                and roadmap are in the deck.
              </p>
            </div>
            <div className="opp-actions">
              <h3>Go deeper</h3>
              <p>Materials and time with the founder.</p>
              <a href="mailto:invest@clubfuoco.com?subject=Club%20Fuoco%20deck" className="btn btn-primary">
                Request the deck →
              </a>
              <a href="https://cal.com/" target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Book a meeting →
              </a>
              <p className="auth-note" style={{ marginTop: 18, textAlign: 'left' }}>
                Contact — invest@clubfuoco.com
              </p>
            </div>
          </div>
        </div>
      </section>

      <MiniFooter />
    </div>
  )
}
