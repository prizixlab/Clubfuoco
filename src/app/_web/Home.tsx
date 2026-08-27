import Script from 'next/script'
import './site.css'
import './home.css'
import SiteNav from './SiteNav'
import MiniFooter from './MiniFooter'
import {
  NETWORK_VENUES,
  NETWORK_VENUE_COUNT,
  NETWORK_VENUE_COUNT_WORD,
  NETWORK_VENUE_COUNT_WORD_CAP,
} from '@/lib/network-venues'

export default function WebHome() {
  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <SiteNav active="" />

      {/* ===== HERO ===== */}
      <header className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="glimmer-layer" aria-hidden="true" />
        <p className="eyebrow">EST · MMXXVI · BARCELONA</p>
        <h1 className="hero-mark">Club Fuoco</h1>
        <p className="hero-tag">Barcelona nightlife, curated.</p>
        <hr className="divider" />
        <p className="hero-lede">
          {NETWORK_VENUE_COUNT_WORD_CAP} of Barcelona&rsquo;s best venues,
          end-to-end inside one app. Booked, paid, and on your phone before you
          leave the house.
        </p>
        <div className="hero-cta">
          <a
            href="https://apps.apple.com/us/app/club-fuoco/id6770632084"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Get the App →
          </a>
          <a href="#how" className="btn btn-secondary">How it works ↓</a>
        </div>
        <div className="hero-stats">
          <div className="hstat"><div className="num">{NETWORK_VENUE_COUNT}</div><div className="lbl">Venues available</div></div>
          <div className="hstat"><div className="num">1,700+</div><div className="lbl">Barcelona venues catalogued</div></div>
          <div className="hstat"><div className="num">May 2026</div><div className="lbl">App Store launch</div></div>
          <div className="hstat"><div className="num">Apple Pay</div><div className="lbl">Native payments</div></div>
        </div>
      </header>

      {/* ===== APP SHOWCASE ===== */}
      <section className="showcase">
        <div className="showcase-glow" aria-hidden="true" />
        <div className="iphone">
          <div className="iphone-screen">
            <div className="notch" aria-hidden="true" />
            <div className="statusbar">
              <span className="time">22:14</span>
              <span className="sb" aria-hidden="true">
                <span className="bars" />
                <span className="batt" />
              </span>
            </div>
            <div className="app-body">
              <p className="app-eyebrow">Tonight, curated by</p>
              <div className="app-title">CLUB FUOCO</div>
              <div className="venue-list">
                {[
                  ['Opium Barcelona',  'Free guestlist',            'linear-gradient(135deg,#3a2a4a,#160f22)'],
                  ['Ku (formerly Pacha)', 'Free guestlist · VIP table', 'linear-gradient(135deg,#4a2a32,#1d1014)'],
                  ['Jamboree',         'Free guestlist',            'linear-gradient(135deg,#2a3a4a,#101824)'],
                  ['Shôko Club',       'VIP table',                 'linear-gradient(135deg,#4a3c2a,#211a0e)'],
                  ['CDLC Barcelona',   'Free guestlist · VIP table', 'linear-gradient(135deg,#2a4a3a,#0f211a)'],
                ].map(([name, label, gradient]) => (
                  <div className="venue-row" key={name}>
                    <div className="venue-thumb" style={{ background: gradient }} />
                    <div className="venue-meta">
                      <div className="venue-name">{name}</div>
                      <div className="venue-label">{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="section" id="how">
        <div className="wrap">
          <div className="how-head">
            <p className="eyebrow">How it works</p>
            <h2 className="serif-title" style={{ marginTop: 18 }}>
              Three steps. <span className="gold">That&rsquo;s it.</span>
            </h2>
          </div>
          <div className="steps">
            {[
              ['01', 'Find tonight’s room',      'Browse what’s actually open tonight — rooms, line-ups, and tables, ranked for the night you’re after.'],
              ['02', 'Book in two taps',               'Entry, guest list, or a table — confirmed and paid inside the app before you leave the house.'],
              ['03', 'Walk straight to the door',      'Your pass lives on your phone. Skip the queue, show the door, and you’re in.'],
            ].map(([n, title, body]) => (
              <div className="step" key={n}>
                <div className="step-num">{n}</div>
                <div className="step-body">
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== VENUE NETWORK ===== */}
      <section className="section venue-network">
        <div className="wrap">
          <p className="eyebrow" style={{ textAlign: 'center' }}>The network</p>
          <h2 className="serif-title" style={{ marginTop: 18 }}>
            Built around {NETWORK_VENUE_COUNT_WORD} of Barcelona&rsquo;s best rooms.
          </h2>
          <p className="sub">
            Guest lists, VIP tables, and direct entry at {NETWORK_VENUE_COUNT_WORD} of
            the city&rsquo;s best venues.
          </p>
          <div className="venues" aria-label="Featured venues">
            {NETWORK_VENUES.map((name, i, arr) => (
              <span key={name}>
                <span>{name}</span>
                {i < arr.length - 1 && <span className="sep">·</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== EDITORIAL QUOTE ===== */}
      <section className="section">
        <div className="wrap">
          <div className="founder-grid">
            <blockquote className="founder-quote">
              <span className="q">&ldquo;</span>
              Most nightlife apps treat Barcelona like Times Square. Club Fuoco
              is the opposite — built by locals, curated for the night, designed
              to disappear once you&rsquo;re at the door.
              <span className="q">&rdquo;</span>
            </blockquote>
            <div className="founder-attr">
              <div className="role">Club Fuoco — Barcelona</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ROUTE HANDOFF ===== */}
      <section className="route-strip">
        <nav className="route-links" aria-label="Secondary">
          <a href="/partners">For Partners →</a>
          <span className="dot" aria-hidden="true">·</span>
          <a href="/investors">For Investors →</a>
        </nav>
      </section>

      <MiniFooter />

      <Script src="/motion.js" strategy="afterInteractive" />
      <Script src="/glimmer.js" strategy="afterInteractive" />
    </div>
  )
}
