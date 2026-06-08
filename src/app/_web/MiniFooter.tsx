// Minimal centered footer used by every marketing page.

export default function MiniFooter() {
  return (
    <footer className="mini-footer">
      <div className="wrap">
        <a href="/" className="mf-mark">fuoco.</a>
        <p className="mf-tag">Barcelona nightlife, curated.</p>
        <nav className="mf-links" aria-label="Footer">
          <a href="#">Privacy</a><span className="dot" aria-hidden="true">·</span>
          <a href="#">Terms</a><span className="dot" aria-hidden="true">·</span>
          <a href="/press">Press</a><span className="dot" aria-hidden="true">·</span>
          <a href="#">Careers</a><span className="dot" aria-hidden="true">·</span>
          <a href="mailto:hello@clubfuoco.com">hello@clubfuoco.com</a>
        </nav>
        <div className="mf-social">
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </a>
          <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="X">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.5 3h3l-7 8 8.2 10h-6.4l-5-6.1L8 21H5l7.5-8.6L4.6 3H11l4.5 5.6L17.5 3zm-1.1 16h1.7L8 4.8H6.2L16.4 19z" />
            </svg>
          </a>
        </div>
        <p className="mf-copy">© 2026 Club Fuoco · Made in Barcelona</p>
      </div>
    </footer>
  )
}
