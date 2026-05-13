'use client'
import { getNotifications, markNotificationsRead } from '@/lib/supabase/queries'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import NavSpacer from '@/components/NavSpacer'

interface Notification {
  id: string
  type: string
  title: string
  body?: string
  link?: string
  is_read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, string> = {
  guestlist_confirmed: 'stars',
  guestlist_checkin:   'check_circle',
  booking_confirmed:   'confirmation_number',
  new_follower:        'person_add',
  gig_confirmed:       'music_note',
  gig_rejected:        'cancel',
  gig_request:         'mail',
  gig_application:     'person_search',
  waitlist_promoted:   'arrow_upward',
  default:             'notifications',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getNotifications()
      .then(d => {
        setNotifications(d as Notification[])
        setLoading(false)
        markNotificationsRead().catch(() => {})
      })
      .catch(() => setLoading(false))
  }, [])

  function handleTap(n: Notification) {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    if (n.link) router.push(n.link)
  }

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div className="px-container-padding pt-base pb-8">
      <div className="flex items-center justify-between mb-md">
        <h2 className="font-h2 text-h2 text-on-surface">Notifications</h2>
        {unread > 0 && (
          <span className="chip-live">{unread} new</span>
        )}
      </div>

      {loading && (
        <div className="space-y-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] mb-md text-primary bloom-glow">
            notifications
          </span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">All caught up</p>
          <p className="font-body-md text-on-surface-variant text-center max-w-[240px]">
            Guest list confirmations, new followers and gig updates will appear here.
          </p>
        </div>
      )}

      <div className="space-y-xs">
        {notifications.map(n => (
          <button
            key={n.id}
            onClick={() => handleTap(n)}
            className={`w-full text-left flex items-start gap-sm p-sm rounded-xl transition-all active:scale-[0.98] ${
              n.is_read ? 'bg-transparent' : 'glass-card border border-primary-container/20'
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              n.is_read ? 'bg-surface-container' : 'bg-primary-container/20'
            }`}>
              <span className={`material-symbols-outlined text-[20px] ${n.is_read ? 'text-on-surface-variant/40' : 'text-primary'}`}
                style={n.is_read ? undefined : { fontVariationSettings: `'FILL' 1` }}>
                {TYPE_ICON[n.type] ?? TYPE_ICON.default}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-body-md ${n.is_read ? 'text-on-surface-variant' : 'text-on-surface font-bold'}`}>
                {n.title}
              </p>
              {n.body && (
                <p className="font-body-md text-on-surface-variant/60 text-sm mt-xs leading-snug">{n.body}</p>
              )}
              <p className="font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest mt-xs">
                {timeAgo(n.created_at)}
              </p>
            </div>
            {!n.is_read && (
              <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
            )}
          </button>
        ))}
      </div>
      <NavSpacer />
    </div>
  )
}
