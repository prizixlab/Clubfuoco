'use client'

import { BottomNav } from '@/components/ui/BottomNav'
import PresenceTracker from '@/components/PresenceTracker'
import SwipeBack from '@/components/SwipeBack'
import { useAuth } from '@/contexts/AuthContext'
import { PlanProvider } from '@/contexts/PlanContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Guests can browse — login is only required for account-based actions
  // (saving venues, booking, membership). The auth-gated pages handle their
  // own redirect; the shell here renders for everyone.
  const { user, accountType, loading } = useAuth()
  if (loading) return null

  return (
    <PlanProvider>
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#F8F5EE' }}>
      {/* Global keyframes for the Rumbalist wordmark's gloss sweep. Defined at
          the (app) layout so it's available everywhere the mark renders, not
          just inside the booking-sheet portal. */}
      <style>{`@keyframes rumbaGloss {
        0%   { background-position: 100% 0; }
        55%  { background-position: -60% 0; }
        100% { background-position: -60% 0; }
      }`}</style>
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

      {/* iOS-style edge-swipe-back gesture */}
      <SwipeBack />
    </div>
    </PlanProvider>
  )
}
