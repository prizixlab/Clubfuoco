'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useLocale } from '@/contexts/LocaleContext'
import { apiFetch } from '@/lib/api'
import type { MessageKey } from '@/messages/en'

type AccountType = 'user' | 'club' | 'dj'

const TAB_SETS: Record<AccountType, { href: string; icon: string; labelKey: MessageKey }[]> = {
  user: [
    { href: '/explore',  icon: 'explore',             labelKey: 'nav.explore'   },
    { href: '/bookings', icon: 'confirmation_number',  labelKey: 'nav.tickets'   },
    { href: '/profile',  icon: 'person',               labelKey: 'nav.you'       },
  ],
  club: [
    { href: '/club-dashboard',              icon: 'dashboard',            labelKey: 'nav.dashboard' },
    { href: '/admin/guest-lists',           icon: 'format_list_bulleted', labelKey: 'nav.lists'     },
    { href: '/club-dashboard?tab=openings', icon: 'work_outline',         labelKey: 'nav.openings'  },
    { href: '/profile',                     icon: 'person_outline',       labelKey: 'nav.profile'   },
  ],
  dj: [
    { href: '/dj-dashboard',  icon: 'dashboard',      labelKey: 'nav.dashboard' },
    { href: '/dj/gigs',       icon: 'music_note',     labelKey: 'nav.gigs'      },
    { href: '/dj/openings',   icon: 'work_outline',   labelKey: 'nav.openings'  },
    { href: '/profile',       icon: 'person_outline', labelKey: 'nav.profile'   },
  ],
}

// Full-screen flows that own the whole viewport — the floating nav pill would
// just get in the way (e.g. the onboarding survey's Continue / Skip buttons).
const HIDE_NAV_ON = ['/onboarding']

export function BottomNav({ accountType = 'user' }: { accountType?: AccountType }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const tabs     = TAB_SETS[accountType] ?? TAB_SETS.user

  // Pending friend requests → dot on "You"; group nights awaiting my RSVP → dot
  // on "Tickets". Re-checked on every navigation so they clear once handled.
  const [alerts, setAlerts] = useState(0)
  const [ticketAlerts, setTicketAlerts] = useState(0)
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/friends')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.data) setAlerts(d.data.incoming?.length ?? 0) })
      .catch(() => {})
    apiFetch('/api/groups')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !Array.isArray(d?.data)) return
        const todo = d.data.filter((g: any) => g.status === 'open' && g.my_rsvp === 'invited').length
        setTicketAlerts(todo)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pathname])

  const dotFor = (href: string) =>
    href === '/profile' ? alerts : href === '/bookings' ? ticketAlerts : 0

  if (HIDE_NAV_ON.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return null
  }

  // Index of the tab matching the current route. -1 if nothing matches —
  // in that case we hide the indicator instead of stranding it on tab 0.
  const activeIdx = tabs.findIndex(({ href }) => {
    const [hrefPath] = href.split('?')
    return pathname === hrefPath || pathname.startsWith(hrefPath + '/')
  })

  // Inner padding inside the nav pill. The sliding indicator sits inside this
  // padded box, so each tab's slot width is (100% - 12px) / nTabs.
  const PAD = 6

  return (
    <div style={{
      position: 'absolute',
      bottom: 8,
      left: 0, right: 0,
      zIndex: 50,
      pointerEvents: 'none',
    }}>
      <nav style={{
        position: 'relative',
        margin: '0 16px',
        backgroundColor: '#FFFFFF',
        borderRadius: '24px',
        boxShadow: '0 4px 24px rgba(34,30,26,0.12), 0 1px 4px rgba(34,30,26,0.06)',
        display: 'flex', alignItems: 'center',
        height: 60,
        padding: `0 ${PAD}px`,
        pointerEvents: 'auto',
      }}>
        {/* Sliding highlight pill — sits behind the tab content. Width is one
            tab-slot. We translate it horizontally by activeIdx × 100% (where
            100% is the indicator's own width) so it lands exactly on the
            active tab and slides smoothly between them. Falls invisible when
            the route doesn't match any tab. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: PAD,
            bottom: PAD,
            left: PAD,
            width: `calc((100% - ${PAD * 2}px) / ${tabs.length})`,
            transform: `translateX(${Math.max(0, activeIdx) * 100}%)`,
            background: 'rgba(192, 153, 80, 0.10)',
            borderRadius: 18,
            transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
            opacity: activeIdx >= 0 ? 1 : 0,
            pointerEvents: 'none',
            boxShadow: 'inset 0 0 0 1px rgba(192, 153, 80, 0.14)',
          }}
        />

        {tabs.map(({ href, icon, labelKey }, i) => {
          const active = i === activeIdx
          return (
            <Link
              key={href}
              href={href}
              style={{
                flex: 1,
                position: 'relative',
                zIndex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 3, textDecoration: 'none',
                color: active ? '#221E1A' : '#B0A898',
                minWidth: 56,
                transition: 'color 0.2s ease',
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <span className="material-symbols-outlined" style={{
                  fontSize: 24,
                  fontVariationSettings: active ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300",
                }}>
                  {icon}
                </span>
                {dotFor(href) > 0 && (
                  <span style={{
                    position: 'absolute', top: -2, right: -4,
                    minWidth: 15, height: 15, padding: '0 4px', boxSizing: 'border-box',
                    borderRadius: 99, background: 'rgb(140,42,42)', color: '#fff',
                    fontSize: 9, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
                    boxShadow: '0 0 0 2px #fff',
                  }}>{dotFor(href)}</span>
                )}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 400,
                fontFamily: 'Inter, sans-serif',
                color: active ? '#221E1A' : '#B0A898',
              }}>
                {t(labelKey)}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
