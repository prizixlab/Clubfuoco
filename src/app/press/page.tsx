import Script from 'next/script'
import '../_web/site.css'
import '../_web/press.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'

export default function PressPage() {
  if (process.env.BUILD_TARGET === 'ios') return null

  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="press" />

      <header className="page-hero left">
        <div className="page-glow" aria-hidden="true" />
        <div className="wrap">
          <p className="eyebrow">Press</p>
          <h1>News from the <span className="gold">night.</span></h1>
          <p className="lead">
            Announcements, coverage, and assets. For interviews and anything not
            listed here, reach the team directly.
          </p>
          <span className="scroll-cue" aria-hidden="true">↓</span>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Releases</span>
            <h2 className="serif-title">The latest.</h2>
          </div>
          <div className="press-grid">
            <article className="release">
              <span className="date">June 2026</span>
              <h3>Club Fuoco launches on the App Store</h3>
              <p>
                The curated nightlife app goes live across Spain, opening with
                eleven partner venues in Barcelona.
              </p>
            </article>
            <article className="release">
              <span className="date">May 2026</span>
              <h3>Club Fuoco partners with Rumbalist</h3>
              <p>
                A network partnership brings guest lists, VIP tables, and direct
                entry at the city&rsquo;s best rooms into one app.
              </p>
            </article>
          </div>

          <p className="press-note">
            Coverage and mentions will appear here as they happen. For
            interviews, reviews, or assets, write to{' '}
            <a href="mailto:press@clubfuoco.com">press@clubfuoco.com</a>.
          </p>

          <div className="press-cta">
            <h2>Press inquiries</h2>
            <a href="mailto:press@clubfuoco.com">press@clubfuoco.com →</a>
          </div>
        </div>
      </section>

      <MiniFooter />
      <Script src="/motion.js" strategy="afterInteractive" />
    </div>
  )
}
