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
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F5F5F7' }}>
      <PortalHeader />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px 80px' }}>
        {children}
      </main>
    </div>
  )
}
