'use client'

import { BottomNav } from '@/components/ui/BottomNav'
import PresenceTracker from '@/components/PresenceTracker'
import { useAuth } from '@/contexts/AuthContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Guests can browse — login is only required for account-based actions
  // (saving venues, booking, membership). The auth-gated pages handle their
  // own redirect; the shell here renders for everyone.
  const { user, accountType, loading } = useAuth()
  if (loading) return null

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#F8F5EE' }}>
      {/* Scrollable content */}
      <div
        id="app-scroll"
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: '#F8F5EE',
        } as React.CSSProperties}
      >
        {children}
      </div>

      {/* Bottom nav — floats over content */}
      <BottomNav accountType={accountType} />

      {/* Passive venue-presence tracking only runs for signed-in users */}
      {user && <PresenceTracker />}
    </div>
  )
}
