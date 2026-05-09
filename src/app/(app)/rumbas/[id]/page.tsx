'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { Rumba, RumbaSignup } from '@/types'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed',  cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  arrived:   { label: 'Checked In', cls: 'bg-primary/20 text-primary border-primary/30' },
  denied:    { label: 'Denied',     cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
}

export default function RumbaDetailPage() {
  const params    = useParams()
  const id        = params.id as string
  const [rumba,   setRumba]   = useState<Rumba | null>(null)
  const [mySignup, setMySignup] = useState<(RumbaSignup & { position?: number }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [name,    setName]    = useState('')
  const [plusOnes, setPlusOnes] = useState(0)
  const [error,   setError]   = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`/api/rumbas/${id}`).then(r => r.json()),
      fetch(`/api/rumbas/${id}/signups/mine`).then(r => r.json()).catch(() => ({ data: null })),
    ]).then(([rumbaData, signupData]) => {
      if (rumbaData.data) setRumba(rumbaData.data)
      if (signupData.data) setMySignup(signupData.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Please enter your name'); return }
    setJoining(true)
    setError('')

    const res  = await fetch(`/api/rumbas/${id}/signups`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name.trim(), plus_ones: plusOnes }),
    })
    const data = await res.json()
    setJoining(false)

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      return
    }

    setMySignup(data.data)
    setShowForm(false)
    if (rumba) {
      setRumba({ ...rumba, signup_count: (rumba.signup_count ?? 0) + 1 })
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <span className="material-symbols-outlined text-[48px] text-primary block mb-md animate-pulse"
          style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
        <p className="font-body-md text-on-surface-variant">Loading rumba…</p>
      </div>
    )
  }

  if (!rumba) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-container-padding">
        <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 block mb-md">event_busy</span>
        <p className="font-h2 text-h2 text-on-surface mb-xs">Rumba not found</p>
        <p className="font-body-md text-on-surface-variant">This event may no longer be active.</p>
      </div>
    )
  }

  const spotsLeft = Math.max(0, rumba.capacity - (rumba.signup_count ?? 0))
  const isFull    = spotsLeft === 0
  const statusCfg = mySignup ? STATUS_LABELS[mySignup.status] ?? STATUS_LABELS.confirmed : null

  return (
    <div className="pb-12">
      {/* Hero */}
      <div className="relative w-full h-72 overflow-hidden">
        {rumba.cover_image
          ? <img src={rumba.cover_image} alt={rumba.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
              <span className="material-symbols-outlined text-[80px] text-primary/20"
                style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
            </div>
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        {/* Spots badge */}
        <div className="absolute top-sm right-sm">
          {isFull
            ? <span className="bg-red-500/90 text-white text-xs font-bold px-sm py-xs rounded-full">List Full</span>
            : <span className="bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-sm py-xs rounded-full border border-primary/30">
                {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left
              </span>
          }
        </div>

        {/* Fire badge */}
        <div className="absolute top-sm left-sm">
          <div className="flex items-center gap-xs bg-primary/90 backdrop-blur-sm rounded-full px-sm py-xs">
            <span className="material-symbols-outlined text-[14px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
            <span className="text-white text-xs font-bold uppercase tracking-widest">Rumba</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-container-padding pt-lg">
        <h1 className="font-h1 text-h1 text-on-surface font-bold mb-xs">{rumba.title}</h1>

        {/* Meta row */}
        <div className="flex flex-col gap-xs mb-lg">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-[18px] text-primary">location_on</span>
            <p className="font-body-md text-on-surface-variant">{rumba.venue_name}</p>
          </div>
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-[18px] text-primary">calendar_today</span>
            <p className="font-body-md text-on-surface-variant">{fmtDate(rumba.event_date)}</p>
          </div>
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-[18px] text-primary">schedule</span>
            <p className="font-body-md text-on-surface-variant">{fmtTime(rumba.event_date)}</p>
          </div>
          {rumba.dress_code && (
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-[18px] text-primary">checkroom</span>
              <p className="font-body-md text-on-surface-variant">Dress code: {rumba.dress_code}</p>
            </div>
          )}
        </div>

        {/* Capacity bar */}
        <div className="glass-card rounded-xl p-md mb-lg">
          <div className="flex items-center justify-between mb-xs">
            <span className="font-body-md text-on-surface-variant text-sm">Spots filled</span>
            <span className="font-body-md text-on-surface font-bold text-sm">
              {rumba.signup_count ?? 0} / {rumba.capacity}
            </span>
          </div>
          <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(100, ((rumba.signup_count ?? 0) / rumba.capacity) * 100)}%` }}
            />
          </div>
        </div>

        {/* Description */}
        {rumba.description && (
          <p className="font-body-md text-on-surface-variant mb-lg leading-relaxed">{rumba.description}</p>
        )}

        {/* My signup status */}
        {mySignup && statusCfg && (
          <div className={`rounded-xl p-md mb-lg border ${statusCfg.cls} bg-opacity-10`}>
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                {mySignup.status === 'arrived' ? 'check_circle' : mySignup.status === 'denied' ? 'cancel' : 'how_to_reg'}
              </span>
              <div>
                <p className="font-body-md font-bold">{statusCfg.label}</p>
                <p className="font-body-md text-sm opacity-70">
                  {mySignup.status === 'confirmed' && mySignup.position && `Position #${mySignup.position} on the list`}
                  {mySignup.status === 'arrived' && 'Welcome! You have been checked in.'}
                  {mySignup.status === 'denied' && 'Unfortunately your entry was denied.'}
                </p>
                {mySignup.plus_ones > 0 && (
                  <p className="font-body-md text-sm opacity-60 mt-xs">+{mySignup.plus_ones} guest{mySignup.plus_ones > 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Join CTA */}
        {!mySignup && (
          <>
            {isFull ? (
              <div className="glass-card rounded-xl p-md text-center border border-red-500/20">
                <span className="material-symbols-outlined text-[32px] text-red-400 block mb-xs">event_busy</span>
                <p className="font-body-md font-bold text-on-surface">List is Full</p>
                <p className="font-body-md text-on-surface-variant text-sm mt-xs">All spots have been taken for this event.</p>
              </div>
            ) : (
              <>
                {!showForm ? (
                  <button
                    onClick={() => setShowForm(true)}
                    className="w-full py-md rounded-xl font-bold text-on-primary bg-primary flex items-center justify-center gap-sm ignite-glow transition-all active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                    Join the List
                  </button>
                ) : (
                  <form onSubmit={handleJoin} className="glass-card rounded-xl p-md space-y-md">
                    <h3 className="font-h2 text-h2 text-on-surface font-bold">Join the List</h3>

                    {error && (
                      <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-sm py-xs border border-red-500/20">{error}</p>
                    )}

                    {/* Name */}
                    <div>
                      <label className="font-body-md text-sm text-on-surface-variant block mb-xs">Name on the list</label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-sm py-sm font-body-md text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60"
                        required
                      />
                    </div>

                    {/* Plus ones */}
                    <div>
                      <label className="font-body-md text-sm text-on-surface-variant block mb-xs">Plus ones (0-3)</label>
                      <div className="flex gap-sm">
                        {[0, 1, 2, 3].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPlusOnes(n)}
                            className={`flex-1 py-sm rounded-xl font-bold transition-all ${plusOnes === n ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant border border-outline-variant/30'}`}
                          >
                            {n === 0 ? 'Just me' : `+${n}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-sm">
                      <button
                        type="button"
                        onClick={() => { setShowForm(false); setError('') }}
                        className="flex-1 py-sm rounded-xl font-bold bg-surface-container text-on-surface-variant border border-outline-variant/30"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={joining}
                        className="flex-1 py-sm rounded-xl font-bold bg-primary text-on-primary ignite-glow transition-all disabled:opacity-50 flex items-center justify-center gap-xs"
                      >
                        {joining
                          ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Joining…</>
                          : <><span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span> Confirm</>
                        }
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
