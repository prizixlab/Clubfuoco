// Shared top nav for every marketing page (clubfuoco.com surface only).

type Active = '' | 'about' | 'partners' | 'press' | 'staff'

export default function SiteNav({ active }: { active: Active }) {
  return (
    <nav className="site-nav">
      <input type="checkbox" id="navtoggle" className="nav-toggle" defaultChecked={false} />
      <div className="nav-inner">
        <a href="/" className="nav-brand">Club Fuoco</a>
        <label htmlFor="navtoggle" className="nav-burger" aria-label="Menu"><span /></label>
        <div className="nav-links">
          <a href="/about"    className={active === 'about'    ? 'active' : ''}>About</a>
          <a href="/partners" className={active === 'partners' ? 'active' : ''}>For Partners</a>
          <a href="/press"    className={active === 'press'    ? 'active' : ''}>Press</a>
          <a
            href="https://apps.apple.com/us/app/club-fuoco/id6770632084"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-cta"
          >
            Get the App →
          </a>
        </div>
      </div>
    </nav>
  )
}
