'use client'

import { useEffect, useState } from 'react'

interface Suggestion {
  id:            string
  place_id:      string
  name:          string
  address:       string
  rating:        number | null
  ratings_total: number
  photos:        string[]
  google_types:  string[]
  ai_confidence: number
  ai_reasoning:  string
  ai_tags:       string[]
  status:        string
  created_at:    string
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct  = Math.round(score * 100)
  const color = score >= 0.75 ? 'text-green-400 border-green-500/30 bg-green-500/10'
              : score >= 0.5  ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
              :                 'text-red-400 border-red-500/30 bg-red-500/10'
  return (
    <span className={`text-[11px] font-bold px-xs py-[2px] rounded-full border uppercase tracking-widest ${color}`}>
      {pct}% match
    </span>
  )
}

export default function AdminDiscoverPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading,     setLoading]     = useState(true)
  const [scanning,    setScanning]    = useState(false)
  const [acting,      setActing]      = useState<string | null>(null)
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [filter,      setFilter]      = useState<'pending' | 'approved' | 'rejected'>('pending')

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function load() {
    setLoading(true)
    const res  = await fetch(`/api/admin/discover/list?status=${filter}`)
    const data = await res.json()
    setSuggestions(data.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function scan() {
    setScanning(true)
    try {
      const res  = await fetch('/api/admin/discover?manual=1')
      const data = await res.json()
      showToast(`Scan complete — ${data.queued} new venues queued`, true)
      await load()
    } catch {
      showToast('Scan failed', false)
    } finally {
      setScanning(false)
    }
  }

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id)
    try {
      const res  = await fetch(`/api/admin/discover/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'Failed', false)
      } else {
        showToast(action === 'approve' ? '✓ Club added!' : 'Rejected', action === 'approve')
        setSuggestions(prev => prev.filter(s => s.id !== id))
      }
    } catch {
      showToast('Something went wrong', false)
    } finally {
      setActing(null)
    }
  }

  const pending = suggestions.filter(s => s.status === 'pending')

  return (
    <div className="px-container-padding pt-base pb-lg">
      <div className="flex items-center justify-between mb-md">
        <div>
          <h2 className="font-h1 text-h1 text-on-surface">AI Discovery</h2>
          <p className="font-body-md text-on-surface-variant/60 text-sm">
            Gemini analyses Barcelona venues and flags nightlife spots for your review
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-xs px-md py-sm bg-primary-container text-on-primary-container rounded-xl font-label-sm uppercase tracking-widest active:scale-95 disabled:opacity-50 ignite-glow">
          <span className="material-symbols-outlined text-[16px]">{scanning ? 'hourglass_empty' : 'travel_explore'}</span>
          {scanning ? 'Scanning…' : 'Scan now'}
        </button>
      </div>

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-md py-sm rounded-xl text-sm font-semibold shadow-lg
          ${toast.ok ? 'bg-primary-container text-on-primary-container' : 'bg-error-container text-on-error-container'}`}>
          {toast.msg}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-sm mb-lg">
        {(['pending','approved','rejected'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-md py-xs rounded-full font-label-sm text-label-sm uppercase tracking-widest transition-all
              ${filter === f
                ? 'bg-primary-container text-on-primary-container'
                : 'bg-surface-container text-on-surface-variant/60'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-md">
          {[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-xl h-40 animate-pulse" />)}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] mb-md text-primary bloom-glow">auto_awesome</span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">
            {filter === 'pending' ? 'No pending venues' : `No ${filter} venues`}
          </p>
          <p className="font-body-md text-center max-w-[240px]">
            {filter === 'pending' ? 'Tap "Scan now" to discover new Barcelona nightlife spots' : ''}
          </p>
        </div>
      ) : (
        <div className="space-y-md">
          {suggestions.map(s => (
            <div key={s.id} className="glass-card rounded-xl overflow-hidden neon-glow">
              {/* Photo strip */}
              {s.photos.length > 0 && (
                <div className="h-32 relative">
                  <img src={s.photos[0]} alt={s.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute bottom-xs left-md right-md flex items-end justify-between">
                    <div>
                      <h3 className="font-h2 text-white text-[16px] leading-tight">{s.name}</h3>
                      <p className="font-body-md text-white/60 text-xs truncate">{s.address}</p>
                    </div>
                    {s.rating && (
                      <div className="flex items-center gap-xs">
                        <span className="text-yellow-400 text-xs">★</span>
                        <span className="text-white text-xs font-bold">{s.rating}</span>
                        <span className="text-white/40 text-[10px]">({s.ratings_total})</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-md">
                {/* AI analysis */}
                <div className="flex items-start gap-sm mb-md">
                  <div className="flex-shrink-0 w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      psychology
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-xs mb-xs flex-wrap">
                      <ConfidenceBadge score={s.ai_confidence} />
                      <span className="font-body-md text-on-surface-variant/50 text-[11px]">Gemini</span>
                    </div>
                    <p className="font-body-md text-on-surface-variant text-sm italic">
                      "{s.ai_reasoning}"
                    </p>
                  </div>
                </div>

                {/* Tags */}
                {s.ai_tags.length > 0 && (
                  <div className="flex flex-wrap gap-xs mb-md">
                    {s.ai_tags.map(tag => (
                      <span key={tag}
                        className="px-xs py-[2px] bg-primary/10 border border-primary/20 text-primary text-[10px] font-semibold rounded-full uppercase tracking-widest">
                        {tag.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                {s.status === 'pending' && (
                  <div className="flex gap-sm">
                    <button
                      onClick={() => act(s.id, 'reject')}
                      disabled={acting === s.id}
                      className="flex-1 py-sm rounded-xl font-h2 text-[14px] bg-surface-container text-on-surface-variant border border-outline-variant/20 active:scale-95 disabled:opacity-50">
                      ✕ Skip
                    </button>
                    <button
                      onClick={() => act(s.id, 'approve')}
                      disabled={acting === s.id}
                      className="flex-1 py-sm rounded-xl font-h2 text-[14px] bg-primary-container text-on-primary-container ignite-glow active:scale-95 disabled:opacity-50">
                      {acting === s.id ? 'Adding…' : '✓ Add to app'}
                    </button>
                  </div>
                )}

                {s.status !== 'pending' && (
                  <p className={`text-center font-label-sm text-label-sm uppercase tracking-widest
                    ${s.status === 'approved' ? 'text-green-400' : 'text-on-surface-variant/40'}`}>
                    {s.status}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
