'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AccountType = 'user' | 'club' | 'dj'

const TAB_SETS: Record<AccountType, { href: string; icon: string; label: string }[]> = {
  user: [
    { href: '/explore',  icon: 'explore',             label: 'Explore' },
    { href: '/bookings', icon: 'confirmation_number', label: 'Tickets' },
    { href: '/profile',  icon: 'person',              label: 'You'     },
  ],
  club: [
    { href: '/club-dashboard',              icon: 'dashboard',            label: 'Dashboard' },
    { href: '/admin/guest-lists',           icon: 'format_list_bulleted', label: 'Lists'     },
    { href: '/club-dashboard?tab=openings', icon: 'work_outline',         label: 'Openings'  },
    { href: '/profile',                     icon: 'person_outline',       label: 'Profile'   },
  ],
  dj: [
    { href: '/dj-dashboard',  icon: 'dashboard',     label: 'Dashboard' },
    { href: '/dj/gigs',       icon: 'music_note',    label: 'Gigs'      },
    { href: '/dj/openings',   icon: 'work_outline',  label: 'Openings'  },
    { href: '/profile',       icon: 'person_outline', label: 'Profile'  },
  ],
}

export function BottomNav({ accountType = 'user' }: { accountType?: AccountType }) {
  const pathname = usePathname()
  const tabs = TAB_SETS[accountType] ?? TAB_SETS.user

  return (
    <div style={{
      position: 'absolute',
      bottom: 8,
      left: 0, right: 0,
      zIndex: 50,
      pointerEvents: 'none',
    }}>
    <nav style={{
      margin: '0 16px',
      backgroundColor: '#FFFFFF',
      borderRadius: '24px',
      boxShadow: '0 4px 24px rgba(34,30,26,0.12), 0 1px 4px rgba(34,30,26,0.06)',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      height: 60,
      pointerEvents: 'auto',
    }}>
      {tabs.map(({ href, icon, label }) => {
        const [hrefPath] = href.split('?')
        const active = pathname === hrefPath || pathname.startsWith(hrefPath + '/')
        return (
          <Link key={href} href={href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, textDecoration: 'none',
            color: active ? '#221E1A' : '#B0A898',
            minWidth: 56,
          }}>
            <span className="material-symbols-outlined" style={{
              fontSize: 24,
              fontVariationSettings: active ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300",
            }}>
              {icon}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 400,
              fontFamily: 'Inter, sans-serif',
              color: active ? '#221E1A' : '#B0A898',
            }}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
    </div>
  )
}
