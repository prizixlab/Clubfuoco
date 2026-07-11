'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { C, caps, font, serif } from './_ui'

export default function PortalHeader() {
  const pathname = usePathname()
  const onLogin = pathname === '/portal/login'

  async function logout() {
    await fetch('/api/portal/auth', { method: 'DELETE' })
    window.location.href = '/portal/login'
  }

  // The login screen carries its own centered lockup — no chrome behind it.
  if (onLogin) return null

  return (
    <header style={{
      borderBottom: `1px solid ${C.line}`,
      background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(12px)',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{
        maxWidth: 1180, margin: '0 auto', padding: '15px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Link href="/portal" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 20, color: C.goldHi }}>Club Fuoco</span>
          <span style={{ color: C.faint, fontFamily: font, fontSize: 13 }}>/</span>
          <span style={{ ...caps, color: C.gold, letterSpacing: '0.18em' }}>Partner Portal</span>
        </Link>
        <button onClick={logout} style={{
          ...caps, background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
          cursor: 'pointer', color: C.dim, padding: '8px 14px', letterSpacing: '0.12em',
        }}>
          Log out
        </button>
      </div>
    </header>
  )
}
