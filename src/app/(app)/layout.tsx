'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/ui/BottomNav'
import PresenceTracker from '@/components/PresenceTracker'
import { useAuth } from '@/contexts/AuthContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, accountType, loading } = useAuth()
  const router = useRouter()

  // Client-side auth guard — replaces middleware redirect
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  // Show nothing while resolving session (avoids flash of protected content)
  if (loading || !user) return null

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

      {/* Passive venue-presence tracking + "Were you at X?" prompts */}
      <PresenceTracker />
    </div>
  )
}
