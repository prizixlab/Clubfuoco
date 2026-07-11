import type { Metadata } from 'next'
import PortalHeader from './_header'

// Operator-only surface — password-gated by the middleware and never indexed
// (belt: metadata here; braces: X-Robots-Tag set by the middleware).
export const metadata: Metadata = {
  title: 'Partner Portal — Club Fuoco',
  robots: { index: false, follow: false },
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cfp" style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F5F5F7', colorScheme: 'dark' }}>
      {/* Ember & Onyx interaction states — focus rings are a sharp ember ring
          with offset; hairlines brighten on hover; motion is subtle and honors
          prefers-reduced-motion. Scoped under .cfp so nothing leaks out. */}
      <style>{`
        .cfp *:focus-visible {
          outline: 2px solid #C09950;
          outline-offset: 3px;
          border-radius: 4px;
        }
        /* globals.css forces every input/select/textarea to dark ink via
           -webkit-text-fill-color (to keep the consumer app's cream forms
           legible). That wins over inline color, so re-assert light text on the
           portal's dark controls — text-fill-color AND color, plus placeholder,
           which inherits the ink fill too. Scoped to .cfp only. */
        .cfp input, .cfp select, .cfp textarea {
          color: #F5F5F7 !important;
          -webkit-text-fill-color: #F5F5F7 !important;
          caret-color: #C09950 !important;
        }
        .cfp .cfp-input::placeholder {
          color: rgba(245,245,247,0.4) !important;
          -webkit-text-fill-color: rgba(245,245,247,0.4) !important;
        }
        .cfp select option { color: #F5F5F7; background: #1C1C1E; }
        .cfp .cfp-input:focus { border-color: rgba(192,153,80,0.55) !important; outline: none; }
        .cfp .cfp-btn-primary:hover:not(:disabled) { background: #EBC073 !important; }
        .cfp .cfp-btn-default:hover:not(:disabled) { background: rgba(255,255,255,0.13) !important; }
        .cfp .cfp-btn-ghost:hover:not(:disabled) { border-color: rgba(255,255,255,0.22) !important; color: #F5F5F7 !important; }
        .cfp .cfp-btn-danger:hover:not(:disabled) { border-color: rgba(255,180,166,0.55) !important; }
        .cfp .cfp-hover-lift { transition: border-color 0.18s, background 0.18s, transform 0.18s; }
        .cfp .cfp-hover-lift:hover { border-color: rgba(255,255,255,0.2) !important; transform: translateY(-1px); }
        @media (prefers-reduced-motion: reduce) {
          .cfp * { transition: none !important; animation: none !important; }
          .cfp .cfp-hover-lift:hover { transform: none; }
        }
      `}</style>
      <PortalHeader />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 96px' }}>
        {children}
      </main>
    </div>
  )
}
