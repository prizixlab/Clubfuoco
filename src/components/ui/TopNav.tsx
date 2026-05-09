'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface TopNavProps {
  showBack?: boolean
  showNotification?: boolean
}

export function TopNav({ showBack = false, showNotification = true }: TopNavProps) {
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
    <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 shadow-[0_0_15px_rgba(255,76,47,0.1)] flex items-center justify-between px-container-padding h-16">
      <div className="flex items-center w-8">
        {showBack && (
          <button onClick={() => router.back()} className="active:scale-95 duration-200">
            <span className="material-symbols-outlined text-primary">arrow_back</span>
          </button>
        )}
      </div>
      <h1 className="font-display text-h2 font-extrabold text-primary tracking-[0.2em] uppercase">
        CLUB FUOCO
      </h1>
      <div className="flex items-center w-8">
        {showNotification && (
          <button onClick={() => router.push('/notifications')} className="relative active:scale-95 duration-200">
            <span className="material-symbols-outlined text-primary"
              style={unread > 0 ? { fontVariationSettings: `'FILL' 1` } : undefined}>
              notifications
            </span>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                <span className="text-[9px] font-bold text-on-primary">{unread > 9 ? '9+' : unread}</span>
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  )
}
