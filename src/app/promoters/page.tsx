import Script from 'next/script'
import '../_web/site.css'
import '../_web/partners.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'

// Promoters — the pitch for Fuoco For Promoters (ios-promoters/, ASC id
// 6793301729). Replaced the old /partners hub and its venue / ticketing /
// operator sub-pages. Every feature named below exists in the shipped app;
// keep it that way — don't list anything that hasn't landed.

const PROMOTER_APP_URL = 'https://apps.apple.com/app/fuoco-for-promoters/id6793301729'

const FEATURES: [string, string][] = [
  ['Guestlists in seconds',
   'Create a one-off night or a weekly series, set capacity, and share it. Edit, skip a week, or close the list from your phone.'],
  ['Share anywhere',
   'Every night gets its own invite link and a ready-made Instagram card. Guests claim their spot in the Club Fuoco app.'],
  ['Ticket releases',
   'Sell in waves: early bird, second release, final. Each wave ends when its cut-off passes or it sells out, whichever comes first.'],
  ['Your team, tracked',
   'Give each member of your staff their own link. Every guest they bring is counted to them, so you see who actually fills the room.'],
  ['Reach the whole city',
   'Publish a public offer and it appears on the club’s page in Club Fuoco, in front of everyone planning their night.'],
  ['Know who’s coming',
   'Live guest lists with arrivals as they happen, plus stats on bookings, attendance, and earnings across every night you run.'],
  ['Get paid in the app',
   'Set up payouts once, inside the app, and track what you’re owed night by night — no chasing anyone.'],
  ['Your brand at the door',
   'Guests get an Apple Wallet pass in your colours and with your logo — the thing the bouncer actually sees.'],
  ['Built for the night',
   'Everything refreshes live while you’re working the door. No laptop, no spreadsheet, no group chat.'],
]

export default function PromotersPage() {
  return (
    <div className="cf-site promoters-page">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="promoters" />

      <header className="page-hero">
        <div className="page-glow" aria-hidden="true" />
        <div className="wrap">
          <p className="eyebrow">Fuoco For Promoters</p>
          <h1>
            Run your nights <span className="gold">from your phone.</span>
          </h1>
          <p className="lead">
            Guestlists, tickets, tables, your team, and your payouts — in one
            app built for the people who fill Barcelona&rsquo;s rooms.
          </p>
          <div className="hero-actions">
            <a href={PROMOTER_APP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Download on the App Store →
            </a>
            <a href="#features" className="btn btn-secondary">See what it does ↓</a>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="positioning">
            <p className="big">
              You bring the crowd.{' '}
              <span className="gold">Club Fuoco brings the rest of the city.</span>
            </p>
            <p className="sub">
              Your nights sit inside the Club Fuoco app, where Barcelona decides
              where to go. Your regulars still come through your links — and
              everyone else can find you too.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="features" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="perks-head">
            <p className="eyebrow">What&rsquo;s in the app</p>
            <h2 className="serif-title" style={{ marginTop: 16, fontSize: 'clamp(30px, 4.4vw, 46px)', color: 'var(--ink)' }}>
              Everything a night needs.
            </h2>
          </div>
          <div className="perks">
            {FEATURES.map(([title, body]) => (
              <div className="perk" key={title}>
                <div className="pk-rule" />
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="closing">
            <span className="eyebrow">How to join</span>
            <h2>
              Download, sign up, verify.{' '}
              <span className="gold">We review every promoter.</span>
            </h2>
            <p>
              Sign up with your email and verify your Instagram. We check every
              account by hand before it goes live, so the app stays the
              city&rsquo;s best nights only.
            </p>
            <div className="actions">
              <a href={PROMOTER_APP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Get Fuoco For Promoters →
              </a>
            </div>
            <span className="mailto">
              Questions? Write to <a href="mailto:hello@clubfuoco.com">hello@clubfuoco.com</a>
            </span>
          </div>
        </div>
      </section>

      <MiniFooter />
      <Script src="/motion.js" strategy="afterInteractive" />
    </div>
  )
}
