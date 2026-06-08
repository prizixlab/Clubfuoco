import '../_web/site.css'
import '../_web/partners.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'

// Partners landing — the "magazine table of contents" version. Three audience
// rows reading like a luxury index, no buttons, no boxes. Each row links to a
// dedicated sub-page (/partners/venues, /partners/ticketing, /partners/operators).
export default function PartnersLanding() {
  if (process.env.BUILD_TARGET === 'ios') return null

  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="partners" />

      <header className="page-hero left">
        <div className="page-glow" aria-hidden="true" />
        <div className="wrap">
          <p className="eyebrow">For Partners</p>
          <h1>
            Put your room where <span className="gold">the city is looking.</span>
          </h1>
          <p className="lead">
            Club Fuoco works with the venues, ticketers, and operators who run
            Barcelona&rsquo;s best nights. Three ways in — each one its own
            conversation.
          </p>
          <span className="scroll-cue" aria-hidden="true">↓</span>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="positioning">
            <p className="big">
              Every weekend, thousands of people open Club Fuoco to decide
              where the night goes.{' '}
              <span className="gold">We&rsquo;d like it to go to you.</span>
            </p>
            <p className="sub">
              We don&rsquo;t replace how you run your nights — we feed them.
              Curated, high-intent local guests, confirmed and paid before they
              arrive, with you in control of the door. Pick the door below that
              fits how you work.
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="directory">
            <div className="dir-head">
              <h2>Three ways to partner</h2>
              <span className="count">01 — 03</span>
            </div>

            <a className="prow" href="/partners/venues">
              <div className="pnum">01</div>
              <div className="pmain">
                <div className="ptop">
                  <span className="picon" aria-hidden="true">
                    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="5" y="9" width="30" height="24" rx="1.5" />
                      <path d="M5 9 L20 19 L35 9" />
                      <line x1="20" y1="19" x2="20" y2="33" />
                    </svg>
                  </span>
                  <span className="peyebrow">Venues</span>
                </div>
                <h3>For Venues</h3>
              </div>
              <div className="pside">
                <p>
                  Bars, clubs, lounges, rooftops. Fill the right rooms on the
                  right nights with guests who actually show — and keep your
                  door, your rules, your house.
                </p>
                <div className="ptags">
                  <span>Real demand</span><span className="sep">·</span>
                  <span>Confirmed bookings</span><span className="sep">·</span>
                  <span>You keep the door</span>
                </div>
                <span className="pgo">
                  Explore venues <span className="arr">→</span>
                </span>
              </div>
            </a>

            <a className="prow" href="/partners/ticketing">
              <div className="pnum">02</div>
              <div className="pmain">
                <div className="ptop">
                  <span className="picon" aria-hidden="true">
                    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="M6 12 a3 3 0 0 1 3 -3 h22 a3 3 0 0 1 3 3 a3 3 0 0 0 0 6 a3 3 0 0 0 0 6 a3 3 0 0 1 -3 3 h-22 a3 3 0 0 1 -3 -3 a3 3 0 0 0 0 -6 a3 3 0 0 0 0 -6 z" />
                      <line x1="24" y1="9" x2="24" y2="33" strokeDasharray="2 3" />
                    </svg>
                  </span>
                  <span className="peyebrow">Ticketing</span>
                </div>
                <h3>For Ticketing Platforms</h3>
              </div>
              <div className="pside">
                <p>
                  List your Barcelona events on a discovery surface built for
                  nightlife. We drive real buyers; you keep fulfilment,
                  checkout, and your existing flow.
                </p>
                <div className="ptags">
                  <span>Focused distribution</span><span className="sep">·</span>
                  <span>Real attribution</span><span className="sep">·</span>
                  <span>Your checkout</span>
                </div>
                <span className="pgo">
                  Explore ticketing <span className="arr">→</span>
                </span>
              </div>
            </a>

            <a className="prow" href="/partners/operators">
              <div className="pnum">03</div>
              <div className="pmain">
                <div className="ptop">
                  <span className="picon" aria-hidden="true">
                    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
                      <circle cx="9" cy="20" r="1.6" fill="currentColor" stroke="none" />
                      <circle cx="9" cy="28" r="1.6" fill="currentColor" stroke="none" />
                      <line x1="15" y1="12" x2="34" y2="12" />
                      <line x1="15" y1="20" x2="34" y2="20" />
                      <line x1="15" y1="28" x2="28" y2="28" />
                    </svg>
                  </span>
                  <span className="peyebrow">Operators</span>
                </div>
                <h3>For Operators</h3>
              </div>
              <div className="pside">
                <p>
                  Promoters and table operators who own these nights: manage
                  guest lists and VIP tables across venues in one dashboard,
                  and reach guests who repeat.
                </p>
                <div className="ptags">
                  <span>One dashboard</span><span className="sep">·</span>
                  <span>Repeat guests</span><span className="sep">·</span>
                  <span>Clean settlement</span>
                </div>
                <span className="pgo">
                  Explore operators <span className="arr">→</span>
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="perks-head">
            <p className="eyebrow">Whichever door you take</p>
            <h2 className="serif-title" style={{ marginTop: 16, fontSize: 'clamp(30px, 4.4vw, 46px)', color: 'var(--ink)' }}>
              What every partner gets.
            </h2>
          </div>
          <div className="perks">
            <div className="perk">
              <div className="pk-rule" />
              <h3>A curated audience</h3>
              <p>Not tourists and not the whole internet — locals who plan their night the same week, shown what fits them.</p>
            </div>
            <div className="perk">
              <div className="pk-rule" />
              <h3>Bookings that hold</h3>
              <p>Guests commit and pay inside the app before they arrive. Fewer no-shows, cleaner doors, predictable nights.</p>
            </div>
            <div className="perk">
              <div className="pk-rule" />
              <h3>One feed to settle</h3>
              <p>Bookings, fees, and payouts in a single dashboard. Audit-ready every Sunday, no spreadsheets.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section integrate">
        <div className="wrap">
          <p>Designed to sit alongside the tools operators already use — not replace them.</p>
          <div className="names" aria-label="Compatible platforms">
            <span>Dice</span><span className="sep">·</span>
            <span>Resident Advisor</span><span className="sep">·</span>
            <span>Xceed</span><span className="sep">·</span>
            <span>Fourvenues</span><span className="sep">·</span>
            <span>Cover</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="closing">
            <span className="eyebrow">Not sure which door?</span>
            <h2>
              Tell us how you run your nights.{' '}
              <span className="gold">We&rsquo;ll find the fit.</span>
            </h2>
            <p>One message, two working days, a real reply. No decks to download, no forms to wrestle.</p>
            <div className="actions">
              <a href="/partners/venues" className="btn btn-primary">Start with venues →</a>
              <a href="/partners/operators" className="btn btn-secondary">I run nights →</a>
            </div>
            <span className="mailto">
              Or write to <a href="mailto:partners@clubfuoco.com">partners@clubfuoco.com</a>
            </span>
          </div>
        </div>
      </section>

      <MiniFooter />
    </div>
  )
}
