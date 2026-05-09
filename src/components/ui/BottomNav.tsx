'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AccountType = 'user' | 'club' | 'dj'

const TAB_SETS: Record<AccountType, { href: string; icon: string; label: string }[]> = {
  user: [
    { href: '/explore',    icon: 'explore',              label: 'Explore'  },
    { href: '/bookings',   icon: 'confirmation_number',  label: 'Bookings' },
    { href: '/saved',      icon: 'favorite',             label: 'Saved'    },
    { href: '/membership', icon: 'workspace_premium',    label: 'Members'  },
    { href: '/profile',    icon: 'person',               label: 'Profile'  },
  ],
  club: [
    { href: '/club-dashboard',              icon: 'dashboard',            label: 'Dashboard'   },
    { href: '/admin/guest-lists',           icon: 'format_list_bulleted', label: 'Lists'       },
    { href: '/club-dashboard?tab=openings', icon: 'work_outline',         label: 'Openings'    },
    { href: '/club-dashboard?tab=djs',      icon: 'headphones',           label: 'DJs'         },
    { href: '/profile',                     icon: 'person',               label: 'Profile'     },
  ],
  dj: [
    { href: '/dj-dashboard',  icon: 'dashboard',    label: 'Dashboard' },
    { href: '/dj/gigs',       icon: 'music_note',   label: 'Gigs'      },
    { href: '/dj/openings',   icon: 'work_outline', label: 'Openings'  },
    { href: '/notifications', icon: 'notifications', label: 'Alerts'   },
    { href: '/profile',       icon: 'person',       label: 'Profile'   },
  ],
}

export function BottomNav({ accountType = 'user' }: { accountType?: AccountType }) {
  const pathname = usePathname()
  const tabs = TAB_SETS[accountType] ?? TAB_SETS.user

  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl bg-surface/80 backdrop-blur-xl border-t border-outline-variant/20 shadow-[0_-5px_20px_rgba(255,76,47,0.15)] flex justify-around items-center h-20 px-gutter pb-safe">
      {tabs.map(({ href, icon, label }) => {
        const [hrefPath, hrefQuery] = href.split('?')
        const active = hrefQuery
          ? pathname === hrefPath // query-param tabs: exact path match (query handled by dashboard)
          : pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center justify-center transition-colors active:scale-90 duration-200 ${
              active ? 'text-primary scale-110' : 'text-on-surface-variant/60 hover:text-primary/80'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {icon}
            </span>
            <span className="font-label-sm text-label-sm uppercase tracking-wide mt-1 text-[9px]">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
