'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface DJDashboard {
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

const GENRE_OPTIONS = ['House', 'Techno', 'Electronic', 'Hip-Hop', 'Latin', 'R&B', 'Reggaeton', 'Drum & Bass', 'Afrobeats', 'Commercial']

type Tab = 'overview' | 'gigs' | 'media' | 'opportunities' | 'requests' | 'profile'

export default function DJDashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<DJDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [noProfile, setNoProfile] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Photos
  const [photos, setPhotos] = useState<any[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Samplers
  const [samplers, setSamplers] = useState<any[]>([])
  const [samplerForm, setSamplerForm] = useState({ title: '', url: '', type: 'soundcloud' })
  const [addingSampler, setAddingSampler] = useState(false)

  // Opportunities
  const [openings, setOpenings] = useState<any[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyMessage, setApplyMessage] = useState('')

  // Requests
  const [requests, setRequests] = useState<any[]>([])
  // Earnings
  const [earnings, setEarnings] = useState<any[]>([])

  const [form, setForm] = useState({
    stage_name: '', bio: '', genres: [] as string[],
    soundcloud_url: '', mixcloud_url: '', spotify_url: '', instagram_handle: '',
  })

  useEffect(() => {
    fetch('/api/dj-dashboard')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setNoProfile(true); setLoading(false); return }
        setProfile(d.data)
        setForm({
          stage_name: d.data.stage_name ?? '',
          bio: d.data.bio ?? '',
          genres: d.data.genres ?? [],
          soundcloud_url: d.data.soundcloud_url ?? '',
          mixcloud_url: d.data.mixcloud_url ?? '',
          spotify_url: d.data.spotify_url ?? '',
          instagram_handle: d.data.instagram_handle ?? '',
        })
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (activeTab === 'media') {
      fetch('/api/dj-dashboard/photos').then(r => r.json()).then(d => setPhotos(d.data ?? []))
      fetch('/api/dj-dashboard/samplers').then(r => r.json()).then(d => setSamplers(d.data ?? []))
    }
    if (activeTab === 'opportunities') {
      fetch('/api/gig-openings').then(r => r.json()).then(d => setOpenings(d.data ?? []))
    }
    if (activeTab === 'requests') {
      fetch('/api/gig-requests').then(r => r.json()).then(d => setRequests(d.data ?? []))
    }
    if (activeTab === 'overview') {
      fetch('/api/gig-payments').then(r => r.json()).then(d => setEarnings(d.data ?? []))
    }
  }, [activeTab])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/dj-dashboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.data) { setProfile(prev => prev ? { ...prev, ...form } : data.data); setNoProfile(false); setEditMode(false) }
    setSaving(false)
  }

  function toggleGenre(g: string) {
    setForm(f => ({ ...f, genres: f.genres.includes(g) ? f.genres.filter(x => x !== g) : [...f.genres, g] }))
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/dj-dashboard/photos', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.data) setPhotos(prev => [data.data, ...prev])
    setPhotoUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function deletePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id))
    await fetch(`/api/dj-dashboard/photos/${id}`, { method: 'DELETE' })
  }

  async function addSampler(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/dj-dashboard/samplers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(samplerForm),
    })
    const data = await res.json()
    if (data.data) { setSamplers(prev => [data.data, ...prev]); setSamplerForm({ title: '', url: '', type: 'soundcloud' }); setAddingSampler(false) }
  }

  async function deleteSampler(id: string) {
    setSamplers(prev => prev.filter(s => s.id !== id))
    await fetch(`/api/dj-dashboard/samplers/${id}`, { method: 'DELETE' })
  }

  async function applyToOpening(openingId: string) {
    const res = await fetch(`/api/gig-openings/${openingId}/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: applyMessage }),
    })
    if (res.ok) { setAppliedIds(prev => new Set([...prev, openingId])); setApplyingId(null); setApplyMessage('') }
  }

  async function respondToRequest(id: string, status: 'accepted' | 'rejected') {
    const res = await fetch(`/api/gig-requests/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (res.ok) setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  const upcomingGigs = profile?.dj_gigs?.filter(g => new Date(g.gig_date) >= new Date()) ?? []

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">music_note</span>
    </div>
  )

  if (noProfile || editMode) return (
    <div className="px-container-padding pt-md pb-xl">
      <div className="flex items-center justify-between mb-lg">
        <div>
          <h1 className="font-h1 text-h1 text-primary uppercase tracking-[0.1em]">DJ Dashboard</h1>
          <p className="font-body-md text-on-surface-variant">{noProfile ? 'Set up your profile' : 'Edit profile'}</p>
        </div>
        {!noProfile && (
          <button onClick={() => setEditMode(false)} className="active:scale-95">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        )}
      </div>
      <form onSubmit={saveProfile} className="space-y-gutter">
        <div className="glass-card p-md rounded-xl space-y-gutter">
          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Stage Name *</label>
            <input value={form.stage_name} onChange={e => setForm(f => ({ ...f, stage_name: e.target.value }))}
              required className="vibe-input w-full" placeholder="Your DJ name" />
          </div>
          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Bio</label>
            <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              rows={3} className="vibe-input w-full resize-none" placeholder="Tell people about your sound…" />
          </div>
        </div>
        <div className="glass-card p-md rounded-xl">
          <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm block">Genres</label>
          <div className="flex flex-wrap gap-xs">
            {GENRE_OPTIONS.map(g => (
              <button key={g} type="button" onClick={() => toggleGenre(g)}
                className={`px-sm py-xs rounded-full font-label-sm text-label-sm transition-all ${form.genres.includes(g) ? 'bg-primary-container text-on-primary-container' : 'chip-default'}`}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="glass-card p-md rounded-xl space-y-gutter">
          <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Links</p>
          {[
            { key: 'soundcloud_url', label: 'SoundCloud URL', placeholder: 'soundcloud.com/yourname' },
            { key: 'mixcloud_url', label: 'Mixcloud URL', placeholder: 'mixcloud.com/yourname' },
            { key: 'spotify_url', label: 'Spotify URL', placeholder: 'open.spotify.com/artist/...' },
            { key: 'instagram_handle', label: 'Instagram Handle', placeholder: '@yourname' },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">{label}</label>
              <input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="vibe-input w-full" placeholder={placeholder} />
            </div>
          ))}
        </div>
        <button type="submit" disabled={saving}
          className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow disabled:opacity-50">
          {saving ? 'Saving…' : noProfile ? 'Create DJ Profile' : 'Save Changes'}
        </button>
      </form>
    </div>
  )

  return (
    <div className="pb-8">
      <div className="px-container-padding pt-md pb-sm">
        <div className="flex items-center justify-between mb-md">
          <div className="flex items-center gap-sm">
            <div className="w-14 h-14 rounded-full border-2 border-primary-container overflow-hidden bg-surface-container-high">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.stage_name} className="w-full h-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-[28px] text-on-surface-variant/30 block text-center mt-3">person</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <h1 className="font-h2 text-h2 text-on-surface">{profile?.stage_name}</h1>
                {profile?.is_verified && (
                  <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                )}
              </div>
              <p className="font-body-md text-on-surface-variant">{(profile?.follower_count ?? 0).toLocaleString()} followers</p>
            </div>
          </div>
          <button onClick={() => setEditMode(true)} className="active:scale-95">
            <span className="material-symbols-outlined text-primary">edit</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-gutter mb-md">
          {[
            { label: 'Followers', value: profile?.follower_count ?? 0 },
            { label: 'Gigs', value: profile?.dj_gigs?.length ?? 0 },
            { label: 'Upcoming', value: upcomingGigs.length },
          ].map(({ label, value }) => (
            <div key={label} className="glass-card p-sm rounded-xl text-center">
              <p className="font-h2 text-h2 text-primary">{value}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-xs overflow-x-auto no-scrollbar border-b border-outline-variant/20">
          {([
            { key: 'overview', label: 'Overview' },
            { key: 'gigs', label: 'Gigs' },
            { key: 'media', label: 'Media' },
            { key: 'opportunities', label: 'Openings' },
            { key: 'requests', label: 'Requests' },
            { key: 'profile', label: 'Profile' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-shrink-0 pb-sm px-xs font-label-sm text-label-sm uppercase tracking-widest transition-colors border-b-2 ${
                activeTab === key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant/60'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-container-padding space-y-gutter">

        {activeTab === 'overview' && (
          <>
            <div className="glass-card p-md rounded-xl">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Your Links</h3>
              <div className="space-y-sm">
                {[
                  { url: profile?.soundcloud_url, icon: 'cloud', label: 'SoundCloud' },
                  { url: profile?.mixcloud_url, icon: 'radio', label: 'Mixcloud' },
                  { url: profile?.spotify_url, icon: 'music_note', label: 'Spotify' },
                  { url: profile?.instagram_handle ? `https://instagram.com/${profile.instagram_handle}` : null, icon: 'photo_camera', label: 'Instagram' },
                ].filter(l => l.url).map(link => (
                  <a key={link.label} href={link.url!} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-sm py-xs border-b border-outline-variant/10 last:border-0 active:opacity-70">
                    <span className="material-symbols-outlined text-primary text-[20px]">{link.icon}</span>
                    <span className="font-body-md text-on-surface">{link.label}</span>
                    <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px] ml-auto">open_in_new</span>
                  </a>
                ))}
              </div>
            </div>
            {profile?.genres && profile.genres.length > 0 && (
              <div className="flex gap-xs flex-wrap">
                {profile.genres.map(g => <span key={g} className="chip-default">{g}</span>)}
              </div>
            )}
            <button onClick={() => router.push(`/dj/${profile?.id}`)}
              className="w-full h-12 border border-outline-variant/30 text-on-surface font-h2 rounded-xl flex items-center justify-center gap-sm active:scale-95">
              <span className="material-symbols-outlined text-[20px]">person</span>
              View Public Profile
            </button>

            {/* Earnings */}
            {earnings.length > 0 && (() => {
              const paid = earnings.filter(e => e.status === 'paid')
              const pending = earnings.filter(e => e.status === 'pending')
              const totalPaid = paid.reduce((s: number, e: any) => s + e.net_cents, 0)
              const totalPending = pending.reduce((s: number, e: any) => s + e.net_cents, 0)
              return (
                <div className="glass-card p-md rounded-xl">
                  <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Earnings</h3>
                  <div className="grid grid-cols-2 gap-sm mb-md">
                    <div className="bg-primary-container/10 rounded-xl p-sm text-center">
                      <p className="font-h2 text-h2 text-primary">€{(totalPaid / 100).toFixed(0)}</p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">Received</p>
                    </div>
                    <div className="bg-surface-container rounded-xl p-sm text-center">
                      <p className="font-h2 text-h2 text-on-surface">€{(totalPending / 100).toFixed(0)}</p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mt-xs">Pending</p>
                    </div>
                  </div>
                  <div className="space-y-xs">
                    {earnings.slice(0, 4).map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between py-xs border-b border-outline-variant/10 last:border-0">
                        <p className="font-body-md text-on-surface-variant">{e.clubs?.name ?? 'Club'}</p>
                        <div className="flex items-center gap-sm">
                          <p className="font-body-md text-on-surface font-bold">€{(e.net_cents / 100).toFixed(0)}</p>
                          <span className={e.status === 'paid' ? 'chip-live' : 'chip-default'}>{e.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {activeTab === 'gigs' && (
          <div className="space-y-gutter">
            {upcomingGigs.length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">event</span>
                <p className="font-h2 text-h2 text-on-surface mb-xs">No upcoming gigs</p>
                <p className="font-body-md">Your gig schedule will appear here once clubs add you to their lineup.</p>
              </div>
            )}
            {upcomingGigs.map(gig => (
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
                    {gig.is_confirmed ? <span className="chip-live">Confirmed</span> : <span className="chip-default">Pending</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'media' && (
          <div className="space-y-lg">
            {/* Photos section */}
            <div>
              <div className="flex items-center justify-between mb-sm">
                <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Photos</h3>
                <button onClick={() => fileInputRef.current?.click()} disabled={photoUploading}
                  className="flex items-center gap-xs text-primary font-label-sm text-label-sm uppercase tracking-widest active:scale-95 disabled:opacity-50">
                  <span className="material-symbols-outlined text-[18px]">{photoUploading ? 'hourglass_empty' : 'add_photo_alternate'}</span>
                  {photoUploading ? 'Uploading…' : 'Add Photo'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
              </div>
              {photos.length === 0 && !photoUploading && (
                <div className="glass-card rounded-xl p-lg text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[48px] block mb-sm text-primary bloom-glow">photo_library</span>
                  <p className="font-body-md">No photos yet. Tap Add Photo to upload.</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-xs">
                {photoUploading && <div className="aspect-square rounded-xl bg-surface-container-high animate-pulse" />}
                {photos.map(photo => (
                  <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={photo.url} alt={photo.caption ?? ''} className="w-full h-full object-cover" />
                    <button onClick={() => deletePhoto(photo.id)}
                      className="absolute top-1 right-1 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center active:scale-95">
                      <span className="material-symbols-outlined text-white text-[16px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Samplers section */}
            <div>
              <div className="flex items-center justify-between mb-sm">
                <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Audio Samplers</h3>
                <button onClick={() => setAddingSampler(true)}
                  className="flex items-center gap-xs text-primary font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Add
                </button>
              </div>
              {addingSampler && (
                <form onSubmit={addSampler} className="glass-card p-md rounded-xl space-y-sm mb-sm">
                  <div className="space-y-xs">
                    <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Title</label>
                    <input value={samplerForm.title} onChange={e => setSamplerForm(f => ({ ...f, title: e.target.value }))}
                      required className="vibe-input w-full" placeholder="e.g. Summer Mix 2024" />
                  </div>
                  <div className="space-y-xs">
                    <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Platform</label>
                    <select value={samplerForm.type} onChange={e => setSamplerForm(f => ({ ...f, type: e.target.value }))}
                      className="vibe-input w-full">
                      <option value="soundcloud">SoundCloud</option>
                      <option value="mixcloud">Mixcloud</option>
                      <option value="youtube">YouTube</option>
                      <option value="link">Other Link</option>
                    </select>
                  </div>
                  <div className="space-y-xs">
                    <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">URL</label>
                    <input value={samplerForm.url} onChange={e => setSamplerForm(f => ({ ...f, url: e.target.value }))}
                      required className="vibe-input w-full" placeholder="https://soundcloud.com/yourname/track" />
                  </div>
                  <div className="flex gap-sm">
                    <button type="button" onClick={() => setAddingSampler(false)}
                      className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Cancel</button>
                    <button type="submit"
                      className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">Add</button>
                  </div>
                </form>
              )}
              {samplers.length === 0 && !addingSampler && (
                <div className="glass-card rounded-xl p-lg text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[48px] block mb-sm text-primary bloom-glow">headphones</span>
                  <p className="font-body-md">No samplers yet. Add a SoundCloud, Mixcloud or YouTube link.</p>
                </div>
              )}
              <div className="space-y-sm">
                {samplers.map(s => {
                  const icons: Record<string, string> = { soundcloud: 'cloud', mixcloud: 'radio', youtube: 'play_circle', link: 'link' }
                  return (
                    <div key={s.id} className="glass-card p-sm rounded-xl flex items-center gap-sm">
                      <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-primary text-[20px]">{icons[s.type] ?? 'music_note'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-body-md text-on-surface font-bold truncate">{s.title}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest capitalize">{s.type}</p>
                      </div>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="active:scale-95">
                        <span className="material-symbols-outlined text-primary text-[20px]">open_in_new</span>
                      </a>
                      <button onClick={() => deleteSampler(s.id)} className="active:scale-95">
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[20px]">delete</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'opportunities' && (
          <div className="space-y-gutter">
            <p className="font-body-md text-on-surface-variant">Open gig postings from clubs — apply directly.</p>
            {openings.length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">work_outline</span>
                <p className="font-h2 text-h2 text-on-surface mb-xs">No openings right now</p>
                <p className="font-body-md">Check back soon — clubs post gig openings here.</p>
              </div>
            )}
            {openings.map((o: any) => {
              const applied = appliedIds.has(o.id)
              return (
                <div key={o.id} className="glass-card p-md rounded-xl">
                  <div className="flex items-start justify-between mb-sm">
                    <div>
                      <p className="font-h2 text-h2 text-on-surface">{o.title}</p>
                      <p className="font-body-md text-primary">{o.clubs?.name}</p>
                      {o.event_date && (
                        <p className="font-body-md text-on-surface-variant text-sm">
                          {new Date(o.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                    {o.pay_range && <span className="chip-live">{o.pay_range}</span>}
                  </div>
                  {o.description && <p className="font-body-md text-on-surface-variant/80 text-sm mb-sm leading-relaxed">{o.description}</p>}
                  {o.genres?.length > 0 && (
                    <div className="flex gap-xs flex-wrap mb-sm">
                      {o.genres.map((g: string) => <span key={g} className="chip-default">{g}</span>)}
                    </div>
                  )}
                  {applyingId === o.id ? (
                    <div className="space-y-sm mt-sm">
                      <textarea value={applyMessage} onChange={e => setApplyMessage(e.target.value)}
                        rows={2} className="vibe-input w-full resize-none text-sm" placeholder="Short message to the club (optional)…" />
                      <div className="flex gap-sm">
                        <button onClick={() => setApplyingId(null)}
                          className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Cancel</button>
                        <button onClick={() => applyToOpening(o.id)}
                          className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">Send</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { if (!applied) setApplyingId(o.id) }} disabled={applied}
                      className={`w-full h-10 rounded-xl font-h2 transition-all active:scale-95 disabled:cursor-default ${
                        applied ? 'border border-primary text-primary' : 'bg-primary-container text-on-primary-container ignite-glow'
                      }`}>
                      {applied ? '✓ Applied' : 'Apply'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="space-y-gutter">
            {requests.length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">mail</span>
                <p className="font-h2 text-h2 text-on-surface mb-xs">No requests yet</p>
                <p className="font-body-md">Direct booking requests from clubs appear here.</p>
              </div>
            )}
            {requests.map((r: any) => (
              <div key={r.id} className={`glass-card p-md rounded-xl border ${r.status === 'pending' ? 'border-primary/30' : 'border-outline-variant/20'}`}>
                <div className="flex items-start justify-between mb-sm">
                  <div>
                    <p className="font-h2 text-h2 text-on-surface">{r.event_name}</p>
                    <p className="font-body-md text-primary">{r.clubs?.name}</p>
                    {r.event_date && (
                      <p className="font-body-md text-on-surface-variant text-sm">
                        {new Date(r.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                  <span className={`${r.status === 'accepted' ? 'chip-live' : 'chip-default'}`}>{r.status.toUpperCase()}</span>
                </div>
                {r.message && <p className="font-body-md text-on-surface-variant/80 text-sm mb-sm italic">"{r.message}"</p>}
                {r.fee_cents > 0 && (
                  <div className="flex items-center gap-xs mb-sm">
                    <span className="material-symbols-outlined text-primary text-[16px]">payments</span>
                    <span className="font-body-md text-primary font-bold">€{(r.fee_cents / 100).toFixed(0)}</span>
                    <span className="font-body-md text-on-surface-variant text-sm">
                      · {r.payment_method === 'app' ? 'via Club Fuoco' : 'off-app'}
                    </span>
                  </div>
                )}
                {r.status === 'pending' && (
                  <div className="flex gap-sm">
                    <button onClick={() => respondToRequest(r.id, 'rejected')}
                      className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Decline</button>
                    <button onClick={() => respondToRequest(r.id, 'accepted')}
                      className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">Accept</button>
                  </div>
                )}
                {r.status === 'accepted' && r.payment_status === 'paid' && (
                  <p className="text-center font-label-sm text-label-sm text-primary uppercase tracking-widest">✓ Payment received</p>
                )}
                {r.status === 'accepted' && r.payment_status === 'off_app' && (
                  <p className="text-center font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Payment handled off-app</p>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="glass-card p-md rounded-xl space-y-sm">
            <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Bio</h3>
            <p className="font-body-md text-on-surface-variant">{profile?.bio || 'No bio yet.'}</p>
            <button onClick={() => setEditMode(true)}
              className="w-full h-12 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow mt-sm active:scale-95">
              Edit Profile
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
