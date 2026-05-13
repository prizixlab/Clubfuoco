'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'

export default function DJGigsPage() {
  const [gigs, setGigs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/dj-dashboard')
      .then(r => r.json())
      .then(d => {
        const all = d.data?.dj_gigs ?? []
        setGigs(all.filter((g: any) => new Date(g.gig_date) >= new Date()))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="px-container-padding pt-base pb-8">
      <h2 className="font-h2 text-h2 text-on-surface mb-md">Upcoming Gigs</h2>

      {loading && (
        <div className="space-y-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && gigs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] mb-md text-primary bloom-glow">event</span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">No upcoming gigs</p>
          <p className="font-body-md text-on-surface-variant text-center max-w-[240px]">
            Your gig schedule will appear here once clubs book you.
          </p>
        </div>
      )}

      <div className="space-y-gutter">
        {gigs.map(gig => (
          <div key={gig.id} className="glass-card p-md rounded-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-h2 text-h2 text-on-surface">{gig.event_name}</p>
                <p className="font-body-md text-on-surface-variant">{gig.clubs?.name}</p>
                <p className="font-body-md text-primary mt-xs">
                  {new Date(gig.gig_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {gig.start_time && ` · ${gig.start_time.slice(0, 5)}`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-xs">
                <span className="chip-default capitalize">{gig.set_type}</span>
                {gig.is_confirmed
                  ? <span className="chip-live">Confirmed</span>
                  : <span className="chip-default">Pending</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
