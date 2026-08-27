// Minimal centered footer used by every marketing page.

export default function MiniFooter() {
  return (
    <footer className="mini-footer">
      <div className="wrap">
        <a href="/" className="mf-mark">fuoco.</a>
        <p className="mf-tag">Barcelona nightlife, curated.</p>
        <nav className="mf-links" aria-label="Footer">
          <a href="/legal/privacy">Privacy</a><span className="dot" aria-hidden="true">·</span>
          <a href="/legal/terms">Terms</a><span className="dot" aria-hidden="true">·</span>
          <a href="/press">Press</a><span className="dot" aria-hidden="true">·</span>
          {/* Careers still points nowhere — there is no /careers page yet. */}
          <a href="#">Careers</a><span className="dot" aria-hidden="true">·</span>
          <a href="mailto:hello@clubfuoco.com">hello@clubfuoco.com</a>
        </nav>
        {/* Social icons removed: they pointed at instagram.com / x.com — the
            platforms' own homepages, not Club Fuoco profiles. Restore the
            .mf-social block (CSS is still in site.css) once real profile URLs
            exist; never link a bare platform homepage. */}
        <p className="mf-copy">© 2026 Club Fuoco · Made in Barcelona</p>
      </div>
    </footer>
  )
}
