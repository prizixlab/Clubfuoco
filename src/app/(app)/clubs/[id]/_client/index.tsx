'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Club, LiveStatus, DrinkSpecial } from '@/types'

interface GuestList {
  id: string
  event_name: string
  event_date: string
  cutoff_time: string
  capacity: number
  signups_count: number
  free_entry_label: string
}

interface DJGig {
  id: string
  event_name: string
  gig_date: string
  start_time?: string
  end_time?: string
  set_type?: string
  dj_profiles: {
    id: string
    stage_name: string
    avatar_url?: string
    genres?: string[]
    is_verified: boolean
    instagram_handle?: string
  }
}

type ClubDetail = Club & {
  live_status: LiveStatus | null
  drink_specials: DrinkSpecial[]
}

const CROWD_STROKE = (pct: number) => `${(pct / 100) * 163.36} 163.36`

export default function ClubDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [club, setClub] = useState<ClubDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [favorited, setFavorited] = useState(false)
  const [guestList, setGuestList] = useState<GuestList | null>(null)
  const [upcomingGigs, setUpcomingGigs] = useState<DJGig[]>([])

  useEffect(() => {
    Promise.all([
      fetch(`/api/clubs/${id}`).then(r => r.json()),
      fetch(`/api/clubs/${id}/specials`).then(r => r.json()),
      fetch(`/api/guest-lists?club_id=${id}`).then(r => r.json()),
      fetch(`/api/clubs/${id}/gigs`).then(r => r.json()),
    ]).then(([clubData, specialsData, glData, gigsData]) => {
      setClub({ ...clubData.data, drink_specials: specialsData.data ?? [] })
      setGuestList((glData.data ?? [])[0] ?? null)
      setUpcomingGigs(gigsData.data ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  async function toggleFavorite() {
    setFavorited(f => !f)
    await apiFetch('/api/favorites', {
      method: favorited ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ club_id: id }),
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">local_fire_department</span>
      </div>
    )
  }

  if (!club) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-container-padding">
        <p className="font-body-md text-on-surface-variant">Club not found.</p>
        <button onClick={() => router.back()} className="text-primary mt-sm">Go back</button>
      </div>
    )
  }

  const live = club.live_status
  const crowdPct = live?.crowd_percentage ?? 0
  const isOpen = live?.is_open ?? false
  const tonightGig = upcomingGigs[0] ?? null

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 flex items-center justify-between px-container-padding h-16">
        <button onClick={() => router.back()} className="active:scale-95 duration-200">
          <span className="material-symbols-outlined text-primary">arrow_back</span>
        </button>
        <h1 className="font-display text-h2 font-extrabold text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
        <button onClick={toggleFavorite} className="active:scale-95 duration-200">
          <span
            className="material-symbols-outlined text-primary"
            style={favorited ? { fontVariationSettings: `'FILL' 1` } : undefined}
          >
            favorite
          </span>
        </button>
      </header>

      <div className="mt-16">
        {/* Hero image */}
        <div className="relative w-full h-56 overflow-hidden">
          {club.cover_image_url ? (
            <img src={club.cover_image_url} alt={club.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-surface-container-high" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
          <div className="absolute bottom-sm left-container-padding">
            {isOpen && <span className="chip-live mb-xs inline-block">LIVE NOW</span>}
            <h2 className="font-h1 text-h1 text-on-surface">{club.name}</h2>
            <p className="font-body-md text-on-surface-variant">{club.neighborhood}</p>
          </div>
        </div>

        <div className="px-container-padding pt-md space-y-md">
          {/* Live status card */}
          {isOpen && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-gutter">
                Live Vibe
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-h2 text-h2 text-on-surface capitalize">{live?.crowd_label ?? '—'}</p>
                  <p className="font-body-md text-on-surface-variant">{crowdPct}% capacity</p>
                  {live?.current_dj && (
                    tonightGig ? (
                      <Link href={`/dj/${tonightGig.dj_profiles.id}`} className="flex items-center gap-xs mt-xs active:opacity-70">
                        <span className="material-symbols-outlined text-primary text-[14px]">music_note</span>
                        <span className="font-body-md text-primary">{live.current_dj}</span>
                        <span className="material-symbols-outlined text-primary text-[12px]">chevron_right</span>
                      </Link>
                    ) : (
                      <p className="font-body-md text-primary mt-xs flex items-center gap-xs">
                        <span className="material-symbols-outlined text-[14px]">music_note</span>
                        {live.current_dj}
                      </p>
                    )
                  )}
                  {live?.queue_wait_minutes && live.queue_wait_minutes > 0 && (
                    <p className="font-body-md text-on-surface-variant mt-xs">
                      <span className="material-symbols-outlined text-[14px] align-middle mr-xs">schedule</span>
                      ~{live.queue_wait_minutes} min queue
                    </p>
                  )}
                </div>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r="26"
                    fill="none" stroke="#ff5539" strokeWidth="8"
                    strokeDasharray={CROWD_STROKE(crowdPct)}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                  />
                  <text x="40" y="45" textAnchor="middle" fill="#ffb4a6" fontSize="14" fontWeight="700">
                    {crowdPct}%
                  </text>
                </svg>
              </div>
            </div>
          )}

          {/* Playing Tonight — DJ card */}
          {tonightGig && (
            <Link href={`/dj/${tonightGig.dj_profiles.id}`}>
              <div className="glass-card p-md rounded-xl flex items-center gap-md active:opacity-70">
                <div className="w-14 h-14 rounded-full border-2 border-primary-container overflow-hidden bg-surface-container-high flex-shrink-0">
                  {tonightGig.dj_profiles.avatar_url ? (
                    <img src={tonightGig.dj_profiles.avatar_url} alt={tonightGig.dj_profiles.stage_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-[24px] text-on-surface-variant/30 block text-center mt-2">person</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-xs">
                    {new Date(tonightGig.gig_date).toDateString() === new Date().toDateString() ? 'Playing Tonight' : 'Next Up'}
                  </p>
                  <div className="flex items-center gap-xs">
                    <p className="font-h2 text-h2 text-on-surface truncate">{tonightGig.dj_profiles.stage_name}</p>
                    {tonightGig.dj_profiles.is_verified && (
                      <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: `'FILL' 1` }}>verified</span>
                    )}
                  </div>
                  {tonightGig.start_time && (
                    <p className="font-body-md text-primary text-sm mt-xs">
                      {tonightGig.start_time.slice(0, 5)}{tonightGig.end_time ? ` – ${tonightGig.end_time.slice(0, 5)}` : ''}
                      {tonightGig.set_type && ` · ${tonightGig.set_type}`}
                    </p>
                  )}
                  {tonightGig.dj_profiles.genres && tonightGig.dj_profiles.genres.length > 0 && (
                    <div className="flex gap-xs flex-wrap mt-xs">
                      {tonightGig.dj_profiles.genres.slice(0, 3).map(g => (
                        <span key={g} className="chip-default text-[10px] py-[2px] px-xs">{g}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="material-symbols-outlined text-on-surface-variant/40">chevron_right</span>
              </div>
            </Link>
          )}

          {/* About */}
          {club.description && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">About</h3>
              <p className="font-body-md text-on-surface-variant">{club.description}</p>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-gutter">
            <div className="glass-card p-sm rounded-xl">
              <span className="material-symbols-outlined text-primary text-[20px]">euro</span>
              <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">Entry</p>
              <p className="font-h2 text-h2 text-on-surface">€{(club.general_entry_price ?? 0).toFixed(0)}+</p>
            </div>
            <div className="glass-card p-sm rounded-xl">
              <span className="material-symbols-outlined text-primary text-[20px]">schedule</span>
              <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">Opens</p>
              <p className="font-h2 text-h2 text-on-surface">23:00</p>
            </div>
          </div>

          {/* Genres */}
          {club.music_genres && club.music_genres.length > 0 && (
            <div className="flex gap-xs flex-wrap">
              {club.music_genres.map(g => <span key={g} className="chip-default">{g}</span>)}
            </div>
          )}

          {/* Upcoming lineup (if more than one gig) */}
          {upcomingGigs.length > 1 && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Upcoming Lineup</h3>
              <div className="space-y-sm">
                {upcomingGigs.slice(1).map(gig => (
                  <Link key={gig.id} href={`/dj/${gig.dj_profiles.id}`}>
                    <div className="flex items-center gap-sm py-xs border-b border-outline-variant/10 last:border-0 active:opacity-70">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                        {gig.dj_profiles.avatar_url ? (
                          <img src={gig.dj_profiles.avatar_url} alt={gig.dj_profiles.stage_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-1">person</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-body-md text-on-surface font-bold">{gig.dj_profiles.stage_name}</p>
                        <p className="font-body-md text-on-surface-variant text-sm">
                          {new Date(gig.gig_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {gig.start_time && ` · ${gig.start_time.slice(0, 5)}`}
                        </p>
                      </div>
                      {gig.set_type && <span className="chip-default capitalize">{gig.set_type}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Drink specials */}
          {club.drink_specials?.length > 0 && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Tonight's Specials</h3>
              <div className="space-y-sm">
                {club.drink_specials.map(s => (
                  <div key={s.id} className="flex justify-between items-center">
                    <span className="font-body-md text-on-surface">{s.description ?? s.name}</span>
                    <span className="font-body-md text-primary font-bold">
                      €{(s.special_price ?? s.original_price ?? 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 w-full px-container-padding pb-safe pt-sm bg-surface/90 backdrop-blur-xl border-t border-outline-variant/20 space-y-xs">
        {guestList && (
          <Link
            href={`/guestlist/${guestList.id}`}
            className="w-full h-12 bg-surface-container border border-primary/40 text-primary font-h2 text-h2 rounded-xl flex items-center justify-center gap-sm active:scale-[0.98] transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: `'FILL' 1` }}>stars</span>
            <span>{guestList.free_entry_label ?? 'Free Entry Tonight'}</span>
          </Link>
        )}
        <Link
          href={`/clubs/${id}/book`}
          className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl flex items-center justify-center ignite-glow active:scale-[0.98] transition-transform gap-sm"
        >
          <span>Book Your Night</span>
          <span className="material-symbols-outlined">chevron_right</span>
        </Link>
      </div>
    </div>
  )
}
