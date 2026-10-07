import Script from 'next/script'
import './site.css'
import './home.css'
import SiteNav from './SiteNav'
import MiniFooter from './MiniFooter'
import {
  NETWORK_VENUES,
  NETWORK_VENUE_COUNT,
} from '@/lib/network-venues'
import { getLiveAvailability, type BookableClub, type WayIn } from '@/lib/live-availability'

// Shown when the live lookup fails — the mockup must never render empty.
const FALLBACK_ROWS: { name: string; label: string }[] = [
  { name: 'Opium Barcelona',     label: 'Free guestlist' },
  { name: 'Ku (formerly Pacha)', label: 'Free guestlist · VIP table' },
  { name: 'Jamboree',            label: 'Free guestlist' },
  { name: 'Shôko Club',          label: 'VIP table' },
  { name: 'CDLC Barcelona',      label: 'Free guestlist · VIP table' },
]

const THUMB_GRADIENTS = [
  'linear-gradient(135deg,#3a2a4a,#160f22)',
  'linear-gradient(135deg,#4a2a32,#1d1014)',
  'linear-gradient(135deg,#2a3a4a,#101824)',
  'linear-gradient(135deg,#4a3c2a,#211a0e)',
  'linear-gradient(135deg,#2a4a3a,#0f211a)',
]

const WAY_LABEL: Record<WayIn, string> = {
  guestlist: 'Free guestlist',
  tickets:   'Tickets',
  vip:       'VIP table',
}

const NETWORK_CAP = 11

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven']

/** "Opium Barcelona Restaurant and Club" → "Opium", "Ku (formerly Pacha)" → "Ku". */
function shortClubName(name: string): string {
  const short = name
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\b(restaurant and club|barcelona|bcn|club)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return short || name
}

function clubRows(clubs: BookableClub[]) {
  return clubs.map(c => ({
    key:   c.id,
    name:  c.name,
    cover: c.cover,
    label: c.ways.map(w => WAY_LABEL[w]).join(' · '),
  }))
}

export default async function WebHome() {
  const live = await getLiveAvailability()
  const tonight = live?.tonight ?? 0
  const rows = live && live.clubs.length > 0
    ? clubRows(live.clubs)
    : FALLBACK_ROWS.map(r => ({ key: r.name, name: r.name, cover: null as string | null, label: r.label }))
  // Long lists scroll on their own inside the phone; the list is rendered
  // twice so the loop is seamless.
  const scrolling = rows.length > 5
  // "The network": clubs bookable in the app right now, at most eleven, and
  // the copy's count follows. Static list only if the live lookup fails.
  const network = live && live.clubs.length > 0
    ? live.clubs.slice(0, NETWORK_CAP).map(c => shortClubName(c.name))
    : [...NETWORK_VENUES]
  const countWord = COUNT_WORDS[network.length] ?? String(network.length)

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
          {countWord[0].toUpperCase() + countWord.slice(1)} of Barcelona&rsquo;s best venues,
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
          {tonight > 0 ? (
            <div className="hstat">
              <div className="num">{tonight}</div>
              <div className="lbl">
                <span className="live-dot" aria-hidden="true" />
                Offers available tonight
              </div>
            </div>
          ) : (
            <div className="hstat"><div className="num">{NETWORK_VENUE_COUNT}</div><div className="lbl">Venues available</div></div>
          )}
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
              <div className="app-title">CLUB FUOCO</div>
              <div className={scrolling ? 'venue-viewport scrolling' : 'venue-viewport'}>
                <div
                  className="venue-list"
                  style={scrolling ? { animationDuration: `${rows.length * 3}s` } : undefined}
                >
                  {(scrolling ? [0, 1] : [0]).flatMap(copy => rows.map((r, i) => (
                    <div className="venue-row" key={`${copy}-${r.key}`} aria-hidden={copy === 1 || undefined}>
                      <div
                        className="venue-thumb"
                        style={{
                          background: r.cover
                            ? `center / cover no-repeat url("${r.cover}")`
                            : THUMB_GRADIENTS[i % THUMB_GRADIENTS.length],
                        }}
                      />
                      <div className="venue-meta">
                        <div className="venue-name">{r.name}</div>
                        <div className="venue-label">{r.label}</div>
                      </div>
                    </div>
                  )))}
                </div>
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
            Built around {countWord} of Barcelona&rsquo;s best rooms.
          </h2>
          <p className="sub">
            Guest lists, VIP tables, and direct entry at {countWord} of
            the city&rsquo;s best venues.
          </p>
          <div className="venues" aria-label="Featured venues">
            {network.map((name, i, arr) => (
              <span key={name}>
                <span className="vname">{name}</span>
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
          <a href="/promoters">For Promoters →</a>
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
