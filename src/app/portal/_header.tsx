'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { api, C, caps, font, serif } from './_ui'

const TABS = [
  { href: '/portal',           label: 'Promoters', match: (p: string) => p === '/portal' || p.startsWith('/portal/brands') },
  { href: '/portal/clubs',     label: 'Clubs',    match: (p: string) => p.startsWith('/portal/clubs') },
  { href: '/portal/reviews',   label: 'Changes',  match: (p: string) => p.startsWith('/portal/reviews') },
  { href: '/portal/calendar',  label: 'Calendar', match: (p: string) => p.startsWith('/portal/calendar') },
  { href: '/portal/conflicts', label: 'Conflicts', match: (p: string) => p.startsWith('/portal/conflicts') },
  { href: '/portal/insights',  label: 'Insights', match: (p: string) => p.startsWith('/portal/insights') },
  { href: '/portal/activity',  label: 'Activity', match: (p: string) => p.startsWith('/portal/activity') },
  { href: '/portal/notifications', label: 'Notify', match: (p: string) => p.startsWith('/portal/notifications') },
]

export default function PortalHeader() {
  const pathname = usePathname()
  const onLogin = pathname === '/portal/login'
  // Per-tab pending counts: change approvals (Changes) and promoter
  // applications (Promoters), each badged on its own tab.
  const [pendingChanges, setPendingChanges] = useState(0)
  const [pendingPromoters, setPendingPromoters] = useState(0)
  useEffect(() => {
    if (onLogin) return
    api<{ id: string }[]>('/api/portal/reviews').then(r => setPendingChanges(r.length)).catch(() => {})
    api<{ pending: { id: string }[] }>('/api/portal/promoters').then(r => setPendingPromoters(r.pending.length)).catch(() => {})
  }, [onLogin, pathname])

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
        maxWidth: 1180, margin: '0 auto', padding: '15px 24px 0',
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

      {/* Tab nav — underline marks the active section */}
      <nav style={{ maxWidth: 1180, margin: '0 auto', padding: '10px 24px 0', display: 'flex', gap: 4 }}>
        {TABS.map(t => {
          const active = t.match(pathname)
          return (
            <Link key={t.href} href={t.href} style={{
              ...caps, textDecoration: 'none', letterSpacing: '0.14em',
              color: active ? C.goldHi : C.dim,
              padding: '8px 12px 12px',
              borderBottom: `2px solid ${active ? C.gold : 'transparent'}`,
              marginBottom: -1,
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}>
              {t.label}
              {(() => {
                const n = t.label === 'Changes' ? pendingChanges : t.label === 'Promoters' ? pendingPromoters : 0
                return n > 0 && (
                  <span style={{
                    ...caps, fontSize: 9.5, letterSpacing: 0, color: '#141416', background: C.gold,
                    borderRadius: 999, minWidth: 17, height: 17, padding: '0 5px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{n}</span>
                )
              })()}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
