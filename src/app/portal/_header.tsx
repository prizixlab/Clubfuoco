'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { C, font, serif } from './_ui'

export default function PortalHeader() {
  const pathname = usePathname()
  const onLogin = pathname === '/portal/login'

  async function logout() {
    await fetch('/api/portal/auth', { method: 'DELETE' })
    window.location.href = '/portal/login'
  }

  return (
    <header style={{
      borderBottom: `1px solid ${C.line}`,
      background: 'rgba(10,10,10,0.9)', backdropFilter: 'blur(8px)',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{
        maxWidth: 960, margin: '0 auto', padding: '14px 20px',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
      }}>
        <Link href="/portal" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 21, color: C.text }}>Club Fuoco</span>
          <span style={{ fontFamily: font, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: C.gold }}>
            Partner Portal
          </span>
        </Link>
        {!onLogin && (
          <button onClick={logout} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: font, fontSize: 12, color: C.dim, padding: 4,
          }}>
            Log out
          </button>
        )}
      </div>
    </header>
  )
}
