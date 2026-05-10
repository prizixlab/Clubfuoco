'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface TopNavProps {
  showBack?: boolean
  showNotification?: boolean
  title?: string
}

export function TopNav({ showBack = false, showNotification = true, title }: TopNavProps) {
  const router = useRouter()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!showNotification) return
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => {
        const count = (d.data ?? []).filter((n: any) => !n.is_read).length
        setUnread(count)
      })
      .catch(() => {})
  }, [showNotification])

  return (
    <header style={{
      position: 'fixed', top: 0, width: '100%', zIndex: 50,
      backgroundColor: 'rgba(248,245,238,0.92)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid #E8E2D8',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', height: '56px',
    }}>
      {/* Left */}
      <div style={{ width: 32 }}>
        {showBack && (
          <button onClick={() => router.back()} style={{ color: '#221E1A', display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
          </button>
        )}
      </div>

      {/* Centre — wordmark or page title */}
      {title ? (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#221E1A' }}>
          {title}
        </span>
      ) : (
        <Link href="/explore" style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: '#221E1A', letterSpacing: '-0.01em', textDecoration: 'none' }}>
          fuoco.
        </Link>
      )}

      {/* Right */}
      <div style={{ width: 32, display: 'flex', justifyContent: 'flex-end' }}>
        {showNotification && (
          <button onClick={() => router.push('/notifications')} style={{ position: 'relative', color: '#221E1A', display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: unread > 0 ? "'FILL' 1" : "'FILL' 0" }}>
              notifications
            </span>
            {unread > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, backgroundColor: '#8C2A2A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#fff' }}>{unread > 9 ? '9+' : unread}</span>
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  )
}
