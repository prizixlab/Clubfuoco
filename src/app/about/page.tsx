import Script from 'next/script'
import '../_web/site.css'
import '../_web/about.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'
import { NETWORK_VENUE_COUNT_WORD } from '@/lib/network-venues'

export default function AboutPage() {
  if (process.env.BUILD_TARGET === 'ios') return null

  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="about" />

      <header className="page-hero left">
        <div className="page-glow" aria-hidden="true" />
        <div className="wrap">
          <p className="eyebrow">About</p>
          <h1>
            Built by locals,
            <br />
            <span className="gold">for the night.</span>
          </h1>
          <p className="lead">
            Club Fuoco started with a simple frustration: the best nights in
            Barcelona were impossible to plan, and the apps that promised to help
            treated the city like a tourist trap.
          </p>
          <span className="scroll-cue" aria-hidden="true">↓</span>
        </div>
      </header>

      {/* Mission */}
      <section className="section">
        <div className="wrap">
          <blockquote className="mission-quote">
            Our mission is to make a great night out{' '}
            <span className="gold">effortless</span> — to put the city&rsquo;s
            best rooms, tables, and line-ups one tap away, and then get out of
            the way.
          </blockquote>
        </div>
      </section>

      {/* Our story */}
      <section className="section">
        <div className="wrap">
          <div className="prose">
            <p className="lead-p">
              We&rsquo;ve gone out in this city for years. The pattern was
              always the same — a dozen group chats, a promoter who may or
              may not answer, and a queue at the door regardless.
            </p>
            <p>
              Club Fuoco is the app we wanted to exist. It&rsquo;s built around
              the venues that actually run Barcelona nights, so what you see is
              real: open rooms tonight, tables you can actually book, guest
              lists that actually clear you at the door.
            </p>
            <p>
              We&rsquo;re deliberately small and deliberately local.
              We&rsquo;d rather cover {NETWORK_VENUE_COUNT_WORD} venues
              perfectly than five hundred badly. Every venue on Club Fuoco is
              one we&rsquo;d send a friend to.
            </p>
          </div>
        </div>
      </section>

      {/* What we believe */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What we believe</span>
            <h2 className="serif-title">Three things, non-negotiable.</h2>
          </div>
          <div className="belief-grid">
            <div className="belief">
              <h3>Curation over coverage</h3>
              <p>
                A short list you can trust beats an endless feed you can&rsquo;t.
                We only list rooms we&rsquo;d walk into ourselves.
              </p>
            </div>
            <div className="belief">
              <h3>The app should disappear</h3>
              <p>
                The point isn&rsquo;t screen time. Book in two taps, pocket
                your phone, and enjoy the night — the product did its job.
              </p>
            </div>
            <div className="belief">
              <h3>Built with operators, not around them</h3>
              <p>
                The venues and promoters who own these nights should be part of
                how the product works, never an afterthought.
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
