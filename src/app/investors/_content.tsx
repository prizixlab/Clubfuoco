import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'
import { NETWORK_VENUE_COUNT } from '@/lib/network-venues'
import Script from 'next/script'

// The unlocked half of /investors. A server component on purpose: it is only
// rendered once the cookie check in page.tsx passes, so none of this markup
// reaches a locked visitor.

export default function InvestorsContent() {
  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
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
            <div className="metric"><div className="val">{NETWORK_VENUE_COUNT}</div><div className="lbl">Featured venues</div></div>
            <div className="metric"><div className="val small">Barcelona</div><div className="lbl">Launch city</div></div>
            <div className="metric"><div className="val small">May 2026</div><div className="lbl">App Store launch</div></div>
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
                Club Fuoco wins by going deep before going wide — working
                directly with operators to bring curated inventory into one
                city, then becoming the default way locals plan a night out.
                The same playbook travels to every major nightlife capital in
                Europe.
              </p>
              <p>
                We&rsquo;re raising to deepen Barcelona, widen the venue
                network, and prove the model is repeatable. Full metrics, model,
                and roadmap are in the deck.
              </p>
            </div>
            <div className="opp-actions">
              <h3>Go deeper</h3>
              <p>Materials and time with the team.</p>
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
      <Script src="/motion.js" strategy="afterInteractive" />
    </div>
  )
}
