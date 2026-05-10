'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AccountType = 'user' | 'club' | 'dj'

const TAB_SETS: Record<AccountType, { href: string; icon: string; label: string }[]> = {
  user: [
    { href: '/explore',   icon: 'explore',             label: 'Explore'  },
    { href: '/bookings',  icon: 'confirmation_number', label: 'Bookings' },
    { href: '/saved',     icon: 'favorite_border',     label: 'Saved'    },
    { href: '/profile',   icon: 'person_outline',      label: 'Profile'  },
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
    <nav style={{
      position: 'fixed', bottom: 0, width: '100%', zIndex: 50,
      backgroundColor: 'rgba(248,245,238,0.95)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderTop: '1px solid #E8E2D8',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      height: 60, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {tabs.map(({ href, icon, label }) => {
        const [hrefPath] = href.split('?')
        const active = pathname === hrefPath || pathname.startsWith(hrefPath + '/')
        return (
          <Link key={href} href={href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, textDecoration: 'none', color: active ? '#8C2A2A' : '#9F9486',
            transition: 'color 0.15s',
          }}>
            <span className="material-symbols-outlined" style={{
              fontSize: 22,
              fontVariationSettings: active ? "'FILL' 1, 'wght' 500" : "'FILL' 0, 'wght' 300",
            }}>
              {icon}
            </span>
            <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
