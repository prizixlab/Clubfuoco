'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'

export default function DJOpeningsPage() {
  const [openings, setOpenings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyMessage, setApplyMessage] = useState('')

  useEffect(() => {
    apiFetch('/api/gig-openings')
      .then(r => r.json())
      .then(d => { setOpenings(d.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function applyToOpening(openingId: string) {
    const res = await apiFetch(`/api/gig-openings/${openingId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: applyMessage }),
    })
    if (res.ok) {
      setAppliedIds(prev => new Set([...prev, openingId]))
      setApplyingId(null)
      setApplyMessage('')
    }
  }

  return (
    <div className="px-container-padding pt-base pb-8">
      <div className="mb-md">
        <h2 className="font-h2 text-h2 text-on-surface">Gig Openings</h2>
        <p className="font-body-md text-on-surface-variant mt-xs">Open bookings posted by clubs — apply directly.</p>
      </div>

      {loading && (
        <div className="space-y-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && openings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] mb-md text-primary bloom-glow">work_outline</span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">No openings right now</p>
          <p className="font-body-md text-on-surface-variant text-center max-w-[240px]">
            Check back soon — clubs post gig openings here when they're looking for DJs.
          </p>
        </div>
      )}

      <div className="space-y-gutter">
        {openings.map((o: any) => {
          const applied = appliedIds.has(o.id)
          return (
            <div key={o.id} className="glass-card p-md rounded-xl border border-outline-variant/20">
              {/* Club + title */}
              <div className="flex items-start justify-between mb-sm">
                <div className="flex items-center gap-sm">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-surface-container-high flex-shrink-0">
                    {o.clubs?.cover_image_url
                      ? <img src={o.clubs.cover_image_url} alt={o.clubs.name} className="w-full h-full object-cover" />
                      : <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-2">nightlife</span>
                    }
                  </div>
                  <div>
                    <p className="font-body-md text-primary font-bold">{o.clubs?.name}</p>
                    <p className="font-h2 text-h2 text-on-surface">{o.title}</p>
                  </div>
                </div>
                {o.pay_range && (
                  <span className="chip-live flex-shrink-0">{o.pay_range}</span>
                )}
              </div>

              {/* Date */}
              {o.event_date && (
                <div className="flex items-center gap-xs mb-sm">
                  <span className="material-symbols-outlined text-on-surface-variant/40 text-[16px]">calendar_today</span>
                  <p className="font-body-md text-on-surface-variant text-sm">
                    {new Date(o.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              )}

              {/* Description */}
              {o.description && (
                <p className="font-body-md text-on-surface-variant/80 text-sm mb-sm leading-relaxed">{o.description}</p>
              )}

              {/* Genres */}
              {o.genres?.length > 0 && (
                <div className="flex gap-xs flex-wrap mb-sm">
                  {o.genres.map((g: string) => <span key={g} className="chip-default">{g}</span>)}
                </div>
              )}

              {/* Apply flow */}
              {applyingId === o.id ? (
                <div className="space-y-sm mt-sm pt-sm border-t border-outline-variant/10">
                  <textarea
                    value={applyMessage}
                    onChange={e => setApplyMessage(e.target.value)}
                    rows={3}
                    className="vibe-input w-full resize-none"
                    placeholder="Tell the club why you're a great fit (optional)…"
                  />
                  <div className="flex gap-sm">
                    <button
                      onClick={() => { setApplyingId(null); setApplyMessage('') }}
                      className="flex-1 h-11 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">
                      Cancel
                    </button>
                    <button
                      onClick={() => applyToOpening(o.id)}
                      className="flex-1 h-11 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98]">
                      Send Application
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { if (!applied) setApplyingId(o.id) }}
                  disabled={applied}
                  className={`w-full h-11 rounded-xl font-h2 transition-all active:scale-[0.98] mt-sm ${
                    applied
                      ? 'border border-primary text-primary'
                      : 'bg-primary-container text-on-primary-container ignite-glow'
                  }`}>
                  {applied ? '✓ Application Sent' : 'Apply for This Gig'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
