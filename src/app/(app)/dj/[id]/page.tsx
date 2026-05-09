'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface DJProfile {
  id: string
  stage_name: string
  bio?: string
  avatar_url?: string
  genres?: string[]
  soundcloud_url?: string
  mixcloud_url?: string
  spotify_url?: string
  instagram_handle?: string
  is_verified: boolean
  follower_count: number
  dj_gigs?: any[]
}

export default function DJProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [dj, setDJ] = useState<DJProfile | null>(null)
  const [following, setFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState<any[]>([])
  const [samplers, setSamplers] = useState<any[]>([])

  useEffect(() => {
    fetch(`/api/dj/${id}`)
      .then(r => r.json())
      .then(d => { setDJ(d.data); setLoading(false) })
    // Load media
    fetch(`/api/dj/${id}/media`)
      .then(r => r.json())
      .then(d => { setPhotos(d.data?.photos ?? []); setSamplers(d.data?.samplers ?? []) })
      .catch(() => {})
  }, [id])

  async function toggleFollow() {
    const wasFollowing = following
    setFollowing(!wasFollowing)
    if (dj) setDJ(prev => prev ? { ...prev, follower_count: prev.follower_count + (wasFollowing ? -1 : 1) } : prev)
    await fetch(`/api/dj/${id}/follow`, { method: wasFollowing ? 'DELETE' : 'POST' })
  }

  const upcomingGigs = dj?.dj_gigs?.filter(g => new Date(g.gig_date) >= new Date()) ?? []

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">music_note</span>
    </div>
  )

  if (!dj) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-container-padding">
      <p className="font-body-md text-on-surface-variant">DJ not found.</p>
      <button onClick={() => router.back()} className="text-primary mt-sm">Go back</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 flex items-center justify-between px-container-padding h-16">
        <button onClick={() => router.back()} className="active:scale-95">
          <span className="material-symbols-outlined text-primary">arrow_back</span>
        </button>
        <h1 className="font-display text-h2 font-extrabold text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
        <div className="w-8" />
      </header>

      <div className="mt-16">
        {/* Hero */}
        <div className="relative px-container-padding pt-lg pb-md flex flex-col items-center text-center">
          <div className="relative mb-md">
            <div className="w-28 h-28 rounded-full border-2 border-primary-container overflow-hidden bg-surface-container-high flex items-center justify-center">
              {dj.avatar_url ? (
                <img src={dj.avatar_url} alt={dj.stage_name} className="w-full h-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30">person</span>
              )}
            </div>
            {dj.is_verified && (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
                <span className="material-symbols-outlined text-[16px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              </div>
            )}
          </div>

          <h2 className="font-h1 text-h1 text-on-surface">{dj.stage_name}</h2>

          <div className="flex items-center gap-xs mt-xs mb-sm">
            <span className="material-symbols-outlined text-primary text-[16px]">group</span>
            <span className="font-body-md text-on-surface-variant">{dj.follower_count.toLocaleString()} followers</span>
          </div>

          {dj.genres && dj.genres.length > 0 && (
            <div className="flex gap-xs flex-wrap justify-center mb-md">
              {dj.genres.map(g => <span key={g} className="chip-default">{g}</span>)}
            </div>
          )}

          {dj.bio && (
            <p className="font-body-md text-on-surface-variant max-w-[300px] leading-relaxed mb-md">{dj.bio}</p>
          )}

          {/* Social links */}
          <div className="flex gap-md mb-md">
            {dj.soundcloud_url && (
              <a href={dj.soundcloud_url} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-xs text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">cloud</span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest">SoundCloud</span>
              </a>
            )}
            {dj.mixcloud_url && (
              <a href={dj.mixcloud_url} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-xs text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">radio</span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest">Mixcloud</span>
              </a>
            )}
            {dj.spotify_url && (
              <a href={dj.spotify_url} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-xs text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">music_note</span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest">Spotify</span>
              </a>
            )}
            {dj.instagram_handle && (
              <a href={`https://instagram.com/${dj.instagram_handle}`} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-xs text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">photo_camera</span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest">Instagram</span>
              </a>
            )}
          </div>

          {/* Follow button */}
          <button
            onClick={toggleFollow}
            className={`w-full max-w-xs h-12 rounded-xl font-h2 text-h2 flex items-center justify-center gap-sm transition-all active:scale-95 ${
              following
                ? 'border border-primary text-primary bg-transparent'
                : 'bg-primary-container text-on-primary-container ignite-glow'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]" style={following ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {following ? 'favorite' : 'favorite_border'}
            </span>
            {following ? 'Following' : 'Follow'}
          </button>
        </div>

        <div className="px-container-padding space-y-md">
          {/* Upcoming gigs */}
          {upcomingGigs.length > 0 && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-md">
                Upcoming Gigs
              </h3>
              <div className="space-y-sm">
                {upcomingGigs.map(gig => (
                  <Link key={gig.id} href={`/clubs/${gig.clubs?.id}`}>
                    <div className="flex items-center gap-sm py-xs border-b border-outline-variant/10 last:border-0 active:opacity-70">
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0">
                        {gig.clubs?.cover_image_url ? (
                          <img src={gig.clubs.cover_image_url} alt={gig.clubs.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-on-surface-variant/30 m-auto block mt-3 text-center">nightlife</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-body-md text-on-surface font-bold">{gig.clubs?.name}</p>
                        <p className="font-body-md text-on-surface-variant text-sm">
                          {new Date(gig.gig_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {gig.start_time && ` · ${gig.start_time.slice(0, 5)}`}
                        </p>
                      </div>
                      <span className="chip-default capitalize">{gig.set_type}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {upcomingGigs.length === 0 && (
            <div className="glass-card p-md rounded-xl text-center">
              <span className="material-symbols-outlined text-[32px] text-on-surface-variant/30 mb-xs block">event_busy</span>
              <p className="font-body-md text-on-surface-variant">No upcoming gigs scheduled</p>
            </div>
          )}

          {/* Samplers */}
          {samplers.length > 0 && (
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-md">Mixes & Tracks</h3>
              <div className="space-y-sm">
                {samplers.map((s: any) => {
                  const icons: Record<string, string> = { soundcloud: 'cloud', mixcloud: 'radio', youtube: 'play_circle', link: 'link' }
                  return (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-sm py-xs border-b border-outline-variant/10 last:border-0 active:opacity-70">
                      <div className="w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-primary text-[18px]">{icons[s.type] ?? 'music_note'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-body-md text-on-surface font-bold truncate">{s.title}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest capitalize">{s.type}</p>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px]">open_in_new</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}

          {/* Photo gallery */}
          {photos.length > 0 && (
            <div>
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Photos</h3>
              <div className="grid grid-cols-3 gap-xs">
                {photos.map((p: any) => (
                  <div key={p.id} className="aspect-square rounded-xl overflow-hidden">
                    <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
