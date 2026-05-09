'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface DJProfile {
  id: string
  stage_name: string
  avatar_url?: string
  genres?: string[]
  is_verified: boolean
}

interface GuestList {
  id: string
  club_id: string
  event_name: string
  event_date: string
  cutoff_time: string
  capacity: number
  signups_count: number
  free_entry_label: string
  is_active: boolean
  tier?: string
  price_cents?: number
  clubs?: { id: string; name: string; neighborhood: string }
  dj_profiles?: DJProfile | null
}

export default function GuestListSignupPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [list, setList] = useState<GuestList | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [fullName, setFullName] = useState('')
  const [partySize, setPartySize] = useState(1)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [selectedTier, setSelectedTier] = useState<'standard' | 'vip'>('standard')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ waitlisted: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/guest-lists/${id}`)
      .then(r => r.json())
      .then(d => {
        setList(d.data ?? null)
        setLoadingList(false)
      })
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const res = await fetch(`/api/guest-lists/${id}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, party_size: partySize, email, phone, tier: selectedTier }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setSubmitting(false)
    } else {
      setResult({ waitlisted: data.data?.waitlisted ?? false })
    }
  }

  if (loadingList) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">music_note</span>
      </div>
    )
  }

  if (!list) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-container-padding">
        <p className="font-body-md text-on-surface-variant">Guest list not found.</p>
        <button onClick={() => router.back()} className="text-primary mt-sm">Go back</button>
      </div>
    )
  }

  const spotsLeft = list.capacity - list.signups_count
  const isFull = spotsLeft <= 0
  const hasVip = list.tier === 'vip' || (list.price_cents && list.price_cents > 0)
  const dj = list.dj_profiles
  const vipPrice = list.price_cents ? (list.price_cents / 100).toFixed(0) : null

  // Confirmation screens
  if (result) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-container-padding text-center">
        <div className="bloom-glow mb-lg">
          <span
            className="material-symbols-outlined text-[80px] text-primary"
            style={{ fontVariationSettings: `'FILL' 1` }}
          >
            {result.waitlisted ? 'hourglass_top' : 'check_circle'}
          </span>
        </div>

        {result.waitlisted ? (
          <>
            <h1 className="font-h1 text-h1 text-on-surface mb-sm">You're on the waitlist</h1>
            <p className="font-body-lg text-on-surface-variant mb-xl max-w-[280px]">
              We'll notify you if a spot opens up. Check your email for updates.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-h1 text-h1 text-on-surface mb-sm">You're on the list!</h1>
            <p className="font-body-lg text-on-surface-variant mb-xs max-w-[280px]">
              Show this screen at the door. Arrive before{' '}
              <span className="text-primary font-bold">{list.cutoff_time?.slice(0, 5) ?? '01:00'}</span>.
            </p>
            <p className="font-body-md text-on-surface-variant mb-xl">
              Tell them you're with <span className="text-primary font-bold">Club Fuoco</span>.
            </p>
          </>
        )}

        <div className="glass-card p-md rounded-xl w-full max-w-sm mb-lg neon-glow">
          <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Your Details</p>
          <div className="space-y-xs">
            <div className="flex justify-between">
              <span className="font-body-md text-on-surface-variant">Name</span>
              <span className="font-body-md text-on-surface font-bold">{fullName}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-body-md text-on-surface-variant">Party</span>
              <span className="font-body-md text-on-surface font-bold">{partySize} {partySize === 1 ? 'person' : 'people'}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-body-md text-on-surface-variant">Event</span>
              <span className="font-body-md text-on-surface font-bold">{list.event_name}</span>
            </div>
            {hasVip && selectedTier === 'vip' && (
              <div className="flex justify-between">
                <span className="font-body-md text-on-surface-variant">Tier</span>
                <span className="font-body-md text-primary font-bold">VIP</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => router.push('/explore')}
          className="w-full max-w-sm h-12 bg-surface-container border border-outline-variant/20 text-on-surface font-h2 rounded-xl"
        >
          Back to Explore
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 flex items-center justify-between px-container-padding h-16">
        <button onClick={() => router.back()} className="active:scale-95">
          <span className="material-symbols-outlined text-primary">arrow_back</span>
        </button>
        <h1 className="font-display text-h2 font-extrabold text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
        <div className="w-8" />
      </header>

      <main className="mt-16 px-container-padding pt-md space-y-md pb-8">
        {/* DJ Branding */}
        {dj && (
          <Link href={`/dj/${dj.id}`}>
            <div className="glass-card p-md rounded-xl flex items-center gap-md active:opacity-70">
              <div className="w-16 h-16 rounded-full border-2 border-primary-container overflow-hidden bg-surface-container-high flex-shrink-0">
                {dj.avatar_url ? (
                  <img src={dj.avatar_url} alt={dj.stage_name} className="w-full h-full object-cover" />
                ) : (
                  <span className="material-symbols-outlined text-[28px] text-on-surface-variant/30 block text-center mt-3">person</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-xs">Tonight's DJ</p>
                <div className="flex items-center gap-xs">
                  <p className="font-h2 text-h2 text-on-surface truncate">{dj.stage_name}</p>
                  {dj.is_verified && (
                    <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: `'FILL' 1` }}>verified</span>
                  )}
                </div>
                {dj.genres && dj.genres.length > 0 && (
                  <div className="flex gap-xs flex-wrap mt-xs">
                    {dj.genres.slice(0, 3).map(g => (
                      <span key={g} className="chip-default text-[10px] py-[2px] px-xs">{g}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/40">chevron_right</span>
            </div>
          </Link>
        )}

        {/* Event header */}
        <div className="text-center py-sm">
          <div className="flex items-center justify-center gap-sm mb-sm">
            {isFull ? (
              <span className="chip-default">LIST FULL — WAITLIST OPEN</span>
            ) : (
              <span className="chip-live">{list.free_entry_label ?? 'FREE ENTRY'}</span>
            )}
          </div>
          <h2 className="font-h1 text-h1 text-on-surface">{list.event_name}</h2>
          {list.clubs && (
            <p className="font-body-md text-on-surface-variant mt-xs">{list.clubs.name} · {list.clubs.neighborhood}</p>
          )}
          <p className="font-body-md text-on-surface-variant mt-xs">
            {new Date(list.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="font-body-md text-primary mt-xs">
            Arrive before <span className="font-bold">{list.cutoff_time?.slice(0, 5) ?? '01:00'}</span>
          </p>
        </div>

        {/* Capacity bar */}
        <div className="glass-card p-md rounded-xl">
          <div className="flex justify-between items-center mb-sm">
            <span className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Spots</span>
            <span className={`font-body-md font-bold ${isFull ? 'text-error' : spotsLeft < 10 ? 'text-primary' : 'text-on-surface'}`}>
              {isFull ? 'Full' : `${spotsLeft} left`}
            </span>
          </div>
          <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(100, (list.signups_count / list.capacity) * 100)}%` }}
            />
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant/40 mt-xs">
            {list.signups_count} / {list.capacity} confirmed
          </p>
        </div>

        {/* VIP tier selector */}
        {hasVip && !isFull && (
          <div className="glass-card p-md rounded-xl">
            <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Entry Type</p>
            <div className="grid grid-cols-2 gap-gutter">
              <button
                type="button"
                onClick={() => setSelectedTier('standard')}
                className={`p-sm rounded-xl border-2 text-center transition-all ${
                  selectedTier === 'standard'
                    ? 'border-primary bg-primary/10'
                    : 'border-outline-variant/20 bg-surface-container'
                }`}
              >
                <p className="font-h2 text-h2 text-on-surface">Free</p>
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">Standard</p>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTier('vip')}
                className={`p-sm rounded-xl border-2 text-center transition-all ${
                  selectedTier === 'vip'
                    ? 'border-primary bg-primary/10'
                    : 'border-outline-variant/20 bg-surface-container'
                }`}
              >
                <p className="font-h2 text-h2 text-primary">{vipPrice ? `€${vipPrice}` : 'VIP'}</p>
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">VIP Entry</p>
              </button>
            </div>
          </div>
        )}

        {/* Sign-up form */}
        <form onSubmit={handleSubmit} className="space-y-gutter">
          <div className="glass-card p-md rounded-xl space-y-gutter">
            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                className="vibe-input w-full"
                placeholder="Your name"
              />
            </div>

            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Party Size</label>
              <div className="flex items-center justify-between py-xs">
                <span className="font-h2 text-h2 text-on-surface">{String(partySize).padStart(2, '0')}</span>
                <div className="flex items-center gap-md">
                  <button
                    type="button"
                    onClick={() => setPartySize(p => Math.max(1, p - 1))}
                    className="w-10 h-10 rounded-full border border-outline-variant/30 flex items-center justify-center active:scale-90"
                  >
                    <span className="material-symbols-outlined">remove</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartySize(p => Math.min(10, p + 1))}
                    className="w-10 h-10 rounded-full border border-primary-container bg-primary-container/20 flex items-center justify-center active:scale-90"
                  >
                    <span className="material-symbols-outlined text-primary">add</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="vibe-input w-full"
                placeholder="For confirmation"
              />
            </div>

            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="vibe-input w-full"
                placeholder="+34 600 000 000"
              />
            </div>
          </div>

          {error && <p className="font-body-md text-error text-center">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !fullName}
            className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {submitting
              ? 'Securing your spot…'
              : isFull
              ? 'Join Waitlist'
              : selectedTier === 'vip' && vipPrice
              ? `Reserve VIP — €${vipPrice} at door`
              : 'Join Guest List — Free'}
          </button>

          <p className="text-center font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest">
            {isFull
              ? 'You will be notified if a spot opens.'
              : 'Free entry subject to availability. Must arrive before cutoff.'}
          </p>
        </form>
      </main>
    </div>
  )
}
