'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@/types'

const TIER_COLORS: Record<string, string> = {
  free: 'text-on-surface-variant',
  gold: 'text-primary',
  sapphire: 'text-primary',
}

const TIER_ICONS: Record<string, string> = {
  free: 'person',
  gold: 'workspace_premium',
  sapphire: 'diamond',
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { setProfile(d.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const tier = profile?.membership_tier ?? 'free'

  return (
    <div className="px-container-padding pt-base pb-gutter">
      {/* Avatar & name */}
      <div className="flex flex-col items-center mb-lg">
        <div className="relative mb-md">
          <div className="w-24 h-24 rounded-full bg-primary-container/20 border-2 border-primary-container flex items-center justify-center">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-[48px] text-primary">person</span>
            )}
          </div>
          {tier !== 'free' && (
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
              <span
                className="material-symbols-outlined text-[18px] text-on-primary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {TIER_ICONS[tier]}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-8 w-40 bg-surface-container rounded-lg animate-pulse" />
        ) : (
          <>
            <h2 className="font-h1 text-h1 text-on-surface text-center">{profile?.full_name ?? 'Guest'}</h2>
            <p className="font-body-md text-on-surface-variant">{profile?.email}</p>
            <div className={`flex items-center gap-xs mt-xs ${TIER_COLORS[tier]}`}>
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {TIER_ICONS[tier]}
              </span>
              <span className="font-label-sm text-label-sm uppercase tracking-widest">
                {tier.charAt(0).toUpperCase() + tier.slice(1)} Member
              </span>
            </div>
          </>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-gutter mb-lg">
        {[
          { label: 'Nights Out', value: (profile as any)?.booking_count ?? '—' },
          { label: 'Saved Clubs', value: (profile as any)?.favorites_count ?? '—' },
          { label: 'Member Since', value: profile?.created_at ? new Date(profile.created_at).getFullYear() : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="glass-card p-sm rounded-xl text-center">
            <p className="font-h2 text-h2 text-primary">{value}</p>
            <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Menu items */}
      <div className="glass-card rounded-xl overflow-hidden mb-gutter">
        {[
          { icon: 'confirmation_number', label: 'My Bookings',   href: '/bookings'   },
          { icon: 'favorite',            label: 'Saved Clubs',   href: '/saved'      },
          { icon: 'workspace_premium',   label: 'Membership',    href: '/membership' },
          { icon: 'settings',            label: 'Settings',      href: '/settings'   },
          { icon: 'help',                label: 'Help & Support', href: '#'          },
        ].map(({ icon, label, href }, i, arr) => (
          <Link
            key={label}
            href={href}
            className={`flex items-center gap-md px-md py-sm hover:bg-surface-container/50 transition-colors ${
              i < arr.length - 1 ? 'border-b border-outline-variant/10' : ''
            }`}
          >
            <span className="material-symbols-outlined text-primary">{icon}</span>
            <span className="font-body-md text-on-surface flex-1">{label}</span>
            <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px]">
              chevron_right
            </span>
          </Link>
        ))}
      </div>

      <button
        onClick={signOut}
        className="w-full h-12 rounded-xl border border-error/30 text-error font-h2 text-h2 flex items-center justify-center gap-sm active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">logout</span>
        Sign Out
      </button>
    </div>
  )
}
