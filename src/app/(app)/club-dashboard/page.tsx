'use client'
import { apiFetch } from '@/lib/api'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NavSpacer from '@/components/NavSpacer'

interface ClubDashboard {
  clubs: any[]
  guest_lists: any[]
  bookings: any[]
  upcoming_gigs: any[]
  staff_role: string
}

type Tab = 'overview' | 'live' | 'guestlists' | 'bookings' | 'lineup' | 'openings' | 'djs'

export default function ClubDashboardPage() {
  return <Suspense><ClubDashboard /></Suspense>
}

function ClubDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<ClubDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    const valid: Tab[] = ['overview', 'live', 'guestlists', 'bookings', 'lineup', 'openings', 'djs']
    return valid.includes(t as Tab) ? (t as Tab) : 'overview'
  })

  // Openings
  const [openings, setOpenings] = useState<any[]>([])
  const [openingForm, setOpeningForm] = useState({ title: '', description: '', event_date: '', genres: [] as string[], fee_cents: '' })
  const [creatingOpening, setCreatingOpening] = useState(false)
  const [viewingApps, setViewingApps] = useState<string | null>(null)
  const [applications, setApplications] = useState<any[]>([])
  const [bookingApp, setBookingApp] = useState<any | null>(null) // app being confirmed with payment
  const [bookingPayment, setBookingPayment] = useState<{ method: 'app' | 'off_app'; fee_euros: string }>({ method: 'off_app', fee_euros: '' })
  const [payingId, setPayingId] = useState<string | null>(null)

  // Browse DJs / send requests
  const [djList, setDjList] = useState<any[]>([])
  const [djSearch, setDjSearch] = useState('')
  const [sentRequests, setSentRequests] = useState<any[]>([])
  const [requestForm, setRequestForm] = useState<{ dj_id: string; event_name: string; event_date: string; message: string; fee_euros: string; payment_method: 'app' | 'off_app' } | null>(null)

  const GENRE_OPTIONS = ['House', 'Techno', 'Electronic', 'Hip-Hop', 'Latin', 'R&B', 'Reggaeton', 'Drum & Bass', 'Afrobeats', 'Commercial']
  const [liveForm, setLiveForm] = useState({ club_id: '', crowd_percentage: 50, current_dj: '', is_open: true, queue_wait_minutes: 0, special_note: '' })
  const [liveSaving, setLiveSaving] = useState(false)

  useEffect(() => {
    if (activeTab === 'openings') {
      apiFetch('/api/gig-openings?mine=1').then(r => r.json()).then(d => setOpenings(d.data ?? []))
    }
    if (activeTab === 'djs') {
      apiFetch('/api/dj').then(r => r.json()).then(d => setDjList(d.data ?? []))
      apiFetch('/api/gig-requests?sent=1').then(r => r.json()).then(d => setSentRequests(d.data ?? []))
    }
  }, [activeTab])

  async function viewApplications(openingId: string) {
    setViewingApps(openingId)
    const res = await apiFetch(`/api/gig-openings/${openingId}/apply`)
    const data = await res.json()
    setApplications(data.data ?? [])
  }

  async function confirmBookApp() {
    if (!bookingApp || !viewingApps) return
    const fee_cents = bookingPayment.fee_euros ? Math.round(parseFloat(bookingPayment.fee_euros) * 100) : 0
    setPayingId(bookingApp.id)
    await apiFetch(`/api/gig-openings/${viewingApps}/applications/${bookingApp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', fee_cents, payment_method: bookingPayment.method }),
    })
    setApplications(prev => prev.map(a => a.id === bookingApp.id ? { ...a, status: 'accepted', fee_cents, payment_method: bookingPayment.method, payment_status: bookingPayment.method === 'off_app' ? 'off_app' : 'unpaid' } : a))

    if (bookingPayment.method === 'app' && fee_cents > 0) {
      const res = await apiFetch('/api/gig-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_type: 'application', booking_id: bookingApp.id, fee_cents }),
      })
      const data = await res.json()
      if (data.data?.url) window.location.href = data.data.url
    }
    setBookingApp(null)
    setPayingId(null)
  }

  async function payNow(bookingType: string, bookingId: string, feeCents: number) {
    setPayingId(bookingId)
    const res = await apiFetch('/api/gig-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_type: bookingType, booking_id: bookingId, fee_cents: feeCents }),
    })
    const data = await res.json()
    if (data.data?.url) window.location.href = data.data.url
    setPayingId(null)
  }

  async function createOpening(e: React.FormEvent) {
    e.preventDefault()
    const fee_cents = openingForm.fee_cents ? Math.round(parseFloat(openingForm.fee_cents) * 100) : 0
    const res = await apiFetch('/api/gig-openings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...openingForm, fee_cents }),
    })
    const data = await res.json()
    if (data.data) {
      setOpenings(prev => [data.data, ...prev])
      setOpeningForm({ title: '', description: '', event_date: '', genres: [], fee_cents: '' })
      setCreatingOpening(false)
    }
  }

  async function closeOpening(id: string) {
    await apiFetch(`/api/gig-openings/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }),
    })
    setOpenings(prev => prev.map(o => o.id === id ? { ...o, status: 'closed' } : o))
  }

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!requestForm) return
    const fee_cents = requestForm.fee_euros ? Math.round(parseFloat(requestForm.fee_euros) * 100) : 0
    const res = await apiFetch('/api/gig-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestForm, fee_cents, payment_method: requestForm.payment_method }),
    })
    const data = await res.json()
    if (data.data) {
      const dj = djList.find(d => d.id === requestForm.dj_id)
      setSentRequests(prev => [{ ...data.data, dj_profiles: dj }, ...prev])
      // If pay via app, go to Stripe immediately
      if (requestForm.payment_method === 'app' && fee_cents > 0) {
        const payRes = await apiFetch('/api/gig-payments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_type: 'request', booking_id: data.data.id, fee_cents }),
        })
        const payData = await payRes.json()
        if (payData.data?.url) { window.location.href = payData.data.url; return }
      }
      setRequestForm(null)
    }
  }

  useEffect(() => {
    apiFetch('/api/club-dashboard')
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          // Not linked to a club — send them to verify/register
          router.replace('/club-verify')
          return
        }
        setData(d.data)
        if (d.data.clubs?.[0]) {
          const club = d.data.clubs[0]
          setLiveForm(f => ({
            ...f,
            club_id: club.id,
            crowd_percentage: club.live_status?.crowd_percentage ?? 50,
            current_dj: club.live_status?.current_dj ?? '',
            is_open: club.live_status?.is_open ?? false,
            queue_wait_minutes: club.live_status?.queue_wait_minutes ?? 0,
          }))
        }
        setLoading(false)
      })
  }, [])

  async function updateLiveStatus(e: React.FormEvent) {
    e.preventDefault()
    setLiveSaving(true)
    await apiFetch('/api/club-dashboard', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(liveForm),
    })
    setLiveSaving(false)
  }

  async function toggleGuestList(id: string, current: boolean) {
    setData(prev => prev ? {
      ...prev,
      guest_lists: prev.guest_lists.map(g => g.id === id ? { ...g, is_active: !current } : g)
    } : prev)
    await apiFetch(`/api/guest-lists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">nightlife</span>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center px-container-padding text-center py-32">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 mb-md">link_off</span>
      <p className="font-h2 text-h2 text-on-surface mb-xs">No club linked</p>
      <p className="font-body-md text-on-surface-variant mb-lg">{error}</p>
      <p className="font-body-md text-on-surface-variant text-sm">Contact the admin to link your account to a venue.</p>
    </div>
  )

  const club = data?.clubs?.[0]
  const live = club?.live_status
  const totalBookingsValue = (data?.bookings ?? []).reduce((sum: number, b: any) => sum + (b.total_amount ?? 0), 0)
  const confirmedBookings = (data?.bookings ?? []).filter((b: any) => b.status === 'confirmed').length
  const activeGuestLists = (data?.guest_lists ?? []).filter((g: any) => g.is_active).length
  const totalSignups = (data?.guest_lists ?? []).reduce((sum: number, g: any) => sum + (g.signups_count ?? 0), 0)

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="px-container-padding pt-md pb-sm">
        <div className="flex items-center justify-between mb-md">
          <div>
            <div className="flex items-center gap-xs">
              <h1 className="font-h1 text-h1 text-primary uppercase tracking-[0.1em]">Dashboard</h1>
              <span className="chip-default capitalize">{data?.staff_role}</span>
            </div>
            <p className="font-body-md text-on-surface-variant">{club?.name}</p>
          </div>
          <div className={`flex items-center gap-xs px-sm py-xs rounded-full ${live?.is_open ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container border border-outline-variant/20'}`}>
            <div className={`w-2 h-2 rounded-full ${live?.is_open ? 'bg-primary animate-pulse' : 'bg-on-surface-variant/30'}`} />
            <span className={`font-label-sm text-label-sm uppercase tracking-widest ${live?.is_open ? 'text-primary' : 'text-on-surface-variant/60'}`}>
              {live?.is_open ? 'Open' : 'Closed'}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-gutter mb-md">
          {[
            { label: 'Bookings', value: confirmedBookings, sub: `€${totalBookingsValue.toFixed(0)} revenue` },
            { label: 'Guest Lists', value: activeGuestLists, sub: `${totalSignups} total signups` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="glass-card p-sm rounded-xl">
              <p className="font-h1 text-h1 text-primary">{value}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">{label}</p>
              <p className="font-body-md text-on-surface-variant text-sm mt-xs">{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-xs overflow-x-auto no-scrollbar border-b border-outline-variant/20">
          {([
            { key: 'overview', label: 'Overview' },
            { key: 'live', label: 'Live' },
            { key: 'guestlists', label: 'Lists' },
            { key: 'bookings', label: 'Bookings' },
            { key: 'lineup', label: 'Lineup' },
            { key: 'openings', label: 'Openings' },
            { key: 'djs', label: 'Browse DJs' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => { setActiveTab(key); if (key !== 'openings') setCreatingOpening(false) }}
              className={`flex-shrink-0 pb-sm px-xs font-label-sm text-label-sm uppercase tracking-widest transition-colors border-b-2 ${
                activeTab === key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant/60'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-container-padding space-y-gutter">

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            {/* Live vibe card */}
            <div className={`glass-card p-md rounded-xl border ${live?.is_open ? 'border-primary/30' : 'border-outline-variant/20'}`}>
              <div className="flex justify-between items-center mb-sm">
                <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Live Vibe</h3>
                <button onClick={() => { setActiveTab('live'); setCreatingOpening(false) }} className="text-primary font-label-sm text-label-sm uppercase tracking-widest">Edit</button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-h2 text-h2 text-on-surface capitalize">{live?.crowd_label ?? '—'}</p>
                  <p className="font-body-md text-on-surface-variant">{live?.crowd_percentage ?? 0}% capacity</p>
                  {live?.current_dj && <p className="font-body-md text-primary mt-xs">DJ: {live.current_dj}</p>}
                  {live?.queue_wait_minutes > 0 && <p className="font-body-md text-on-surface-variant">{live.queue_wait_minutes} min queue</p>}
                </div>
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                  <circle cx="32" cy="32" r="24" fill="none" stroke="#ff5539" strokeWidth="6"
                    strokeDasharray={`${((live?.crowd_percentage ?? 0) / 100) * 150.8} 150.8`}
                    strokeLinecap="round" transform="rotate(-90 32 32)" />
                  <text x="32" y="37" textAnchor="middle" fill="#ffb4a6" fontSize="12" fontWeight="700">
                    {live?.crowd_percentage ?? 0}%
                  </text>
                </svg>
              </div>
            </div>

            {/* Upcoming gigs */}
            {(data?.upcoming_gigs ?? []).length > 0 && (
              <div className="glass-card p-md rounded-xl">
                <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Tonight's Lineup</h3>
                <div className="space-y-sm">
                  {(data?.upcoming_gigs ?? []).slice(0, 3).map((gig: any) => (
                    <div key={gig.id} className="flex items-center gap-sm border-b border-outline-variant/10 last:border-0 pb-sm last:pb-0">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                        {gig.dj_profiles?.avatar_url ? (
                          <img src={gig.dj_profiles.avatar_url} alt={gig.dj_profiles.stage_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-2">person</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-body-md text-on-surface font-bold">{gig.dj_profiles?.stage_name}</p>
                        <p className="font-body-md text-on-surface-variant text-sm">{gig.event_name} · {gig.start_time?.slice(0, 5)}</p>
                      </div>
                      <span className="chip-default capitalize">{gig.set_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent bookings preview */}
            {(data?.bookings ?? []).length > 0 && (
              <div className="glass-card p-md rounded-xl">
                <div className="flex justify-between items-center mb-sm">
                  <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Recent Bookings</h3>
                  <button onClick={() => { setActiveTab('bookings'); setCreatingOpening(false) }} className="text-primary font-label-sm text-label-sm uppercase tracking-widest">See all</button>
                </div>
                <div className="space-y-xs">
                  {(data?.bookings ?? []).slice(0, 4).map((b: any) => (
                    <div key={b.id} className="flex justify-between items-center py-xs border-b border-outline-variant/10 last:border-0">
                      <div>
                        <p className="font-body-md text-on-surface">{b.users?.full_name ?? 'Guest'}</p>
                        <p className="font-body-md text-on-surface-variant text-sm">{b.party_size} guests · {b.booking_type}</p>
                      </div>
                      <span className="font-body-md text-primary font-bold">€{(b.total_amount ?? 0).toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* LIVE STATUS */}
        {activeTab === 'live' && (
          <form onSubmit={updateLiveStatus} className="space-y-gutter">
            <div className="glass-card p-md rounded-xl space-y-gutter">
              <div className="flex items-center justify-between">
                <span className="font-body-md text-on-surface">Club is open</span>
                <button type="button" onClick={() => setLiveForm(f => ({ ...f, is_open: !f.is_open }))}
                  className={`w-14 h-7 rounded-full transition-colors ${liveForm.is_open ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
                  <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform mx-0.5 ${liveForm.is_open ? 'translate-x-7' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                  Crowd Level: {liveForm.crowd_percentage}%
                </label>
                <input type="range" min={0} max={100} value={liveForm.crowd_percentage}
                  onChange={e => setLiveForm(f => ({ ...f, crowd_percentage: +e.target.value }))}
                  className="w-full accent-primary" />
                <div className="flex justify-between font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest">
                  <span>Empty</span><span>Quiet</span><span>Lively</span><span>Busy</span><span>Packed</span>
                </div>
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">DJ Playing Now</label>
                <input value={liveForm.current_dj} onChange={e => setLiveForm(f => ({ ...f, current_dj: e.target.value }))}
                  className="vibe-input w-full" placeholder="DJ name or set" />
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Queue Wait (minutes)</label>
                <input type="number" min={0} max={120} value={liveForm.queue_wait_minutes}
                  onChange={e => setLiveForm(f => ({ ...f, queue_wait_minutes: +e.target.value }))}
                  className="vibe-input w-full" />
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Special Note</label>
                <input value={liveForm.special_note} onChange={e => setLiveForm(f => ({ ...f, special_note: e.target.value }))}
                  className="vibe-input w-full" placeholder="e.g. Tonight: Ladies Free until 1AM" />
              </div>
            </div>

            <button type="submit" disabled={liveSaving}
              className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow disabled:opacity-50">
              {liveSaving ? 'Updating…' : 'Update Live Status'}
            </button>
          </form>
        )}

        {/* GUEST LISTS */}
        {activeTab === 'guestlists' && (
          <div className="space-y-gutter">
            {(data?.guest_lists ?? []).length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">list_alt</span>
                <p className="font-body-md">No guest lists yet.</p>
              </div>
            )}

            {(data?.guest_lists ?? []).map((gl: any) => (
              <div key={gl.id} className={`glass-card p-md rounded-xl border ${gl.is_active ? 'border-primary/30' : 'border-outline-variant/20'}`}>
                <div className="flex justify-between items-start mb-sm">
                  <div>
                    <div className="flex items-center gap-xs mb-xs">
                      <span className={gl.is_active ? 'chip-live' : 'chip-default'}>
                        {gl.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                      {gl.tier === 'vip' && <span className="chip-vip">VIP</span>}
                    </div>
                    <p className="font-h2 text-h2 text-on-surface">{gl.event_name}</p>
                    <p className="font-body-md text-on-surface-variant">
                      {new Date(gl.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' '}· Before {gl.cutoff_time?.slice(0, 5)}
                    </p>
                    {gl.dj_profiles && (
                      <p className="font-body-md text-primary mt-xs">DJ: {gl.dj_profiles.stage_name}</p>
                    )}
                  </div>
                  <button onClick={() => toggleGuestList(gl.id, gl.is_active)}
                    className={`w-14 h-7 rounded-full transition-colors flex-shrink-0 ${gl.is_active ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
                    <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform mx-0.5 ${gl.is_active ? 'translate-x-7' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="flex items-center gap-md">
                  <div className="flex items-center gap-xs">
                    <span className="material-symbols-outlined text-primary text-[16px]">group</span>
                    <span className="font-body-md text-on-surface">
                      <span className="text-primary font-bold">{gl.signups_count}</span>
                      <span className="text-on-surface-variant"> / {gl.capacity}</span>
                    </span>
                  </div>
                  <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div className="h-full bg-primary-container rounded-full transition-all"
                      style={{ width: `${Math.min(100, (gl.signups_count / gl.capacity) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* BOOKINGS */}
        {activeTab === 'bookings' && (
          <div className="space-y-gutter">
            <div className="glass-card p-sm rounded-xl flex justify-between items-center">
              <span className="font-body-md text-on-surface-variant">Total revenue</span>
              <span className="font-h2 text-h2 text-primary">€{totalBookingsValue.toFixed(2)}</span>
            </div>

            {(data?.bookings ?? []).length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">confirmation_number</span>
                <p className="font-body-md">No bookings yet.</p>
              </div>
            )}

            {(data?.bookings ?? []).map((b: any) => (
              <div key={b.id} className="glass-card p-md rounded-xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-h2 text-h2 text-on-surface">{b.users?.full_name ?? 'Guest'}</p>
                    <p className="font-body-md text-on-surface-variant">{b.users?.email}</p>
                    <div className="flex gap-sm mt-xs">
                      <span className="font-body-md text-on-surface-variant">{b.party_size} guests</span>
                      <span className="font-body-md text-on-surface-variant">·</span>
                      <span className="font-body-md text-on-surface-variant capitalize">{b.booking_type}</span>
                      <span className="font-body-md text-on-surface-variant">·</span>
                      <span className="font-body-md text-on-surface-variant">
                        {new Date(b.booking_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-h2 text-h2 text-primary">€{(b.total_amount ?? 0).toFixed(0)}</p>
                    <span className={b.status === 'confirmed' ? 'chip-live' : 'chip-default'}>{b.status.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* OPENINGS */}
        {activeTab === 'openings' && (
          <div className="space-y-gutter">
            {viewingApps ? (
              <>
                <button onClick={() => { setViewingApps(null); setApplications([]) }}
                  className="flex items-center gap-xs text-primary font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  Back to Openings
                </button>
                <h3 className="font-h2 text-h2 text-on-surface">Applications</h3>
                {applications.length === 0 && (
                  <div className="text-center py-lg text-on-surface-variant">
                    <span className="material-symbols-outlined text-[48px] block mb-sm">inbox</span>
                    <p className="font-body-md">No applications yet.</p>
                  </div>
                )}
                {applications.map((app: any) => (
                  <div key={app.id} className={`glass-card p-md rounded-xl border ${app.status === 'pending' ? 'border-primary/30' : 'border-outline-variant/20'}`}>
                    <div className="flex items-center gap-sm mb-sm">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                        {app.dj_profiles?.avatar_url
                          ? <img src={app.dj_profiles.avatar_url} alt={app.dj_profiles.stage_name} className="w-full h-full object-cover" />
                          : <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-2">person</span>
                        }
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-xs">
                          <p className="font-body-md text-on-surface font-bold">{app.dj_profiles?.stage_name}</p>
                          {app.dj_profiles?.is_verified && (
                            <span className="material-symbols-outlined text-primary text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                          )}
                        </div>
                        <p className="font-body-md text-on-surface-variant text-sm">{app.dj_profiles?.follower_count?.toLocaleString()} followers</p>
                      </div>
                      <span className={app.status === 'accepted' ? 'chip-live' : app.status === 'rejected' ? 'chip-default' : 'chip-default'}>
                        {app.status.toUpperCase()}
                      </span>
                    </div>
                    {app.dj_profiles?.genres?.length > 0 && (
                      <div className="flex gap-xs flex-wrap mb-sm">
                        {app.dj_profiles.genres.map((g: string) => <span key={g} className="chip-default text-xs">{g}</span>)}
                      </div>
                    )}
                    {app.message && <p className="font-body-md text-on-surface-variant/80 text-sm mb-sm italic">"{app.message}"</p>}
                    {app.status === 'pending' && (
                      <div className="flex gap-sm">
                        <button onClick={() => { setApplications(prev => prev.map(a => a.id === app.id ? { ...a, status: 'rejected' } : a)); apiFetch(`/api/gig-openings/${viewingApps}/applications/${app.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'rejected' }) }) }}
                          className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Pass</button>
                        <button onClick={() => { setBookingApp(app); setBookingPayment({ method: 'off_app', fee_euros: app.fee_cents ? String(app.fee_cents / 100) : '' }) }}
                          className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">Book</button>
                      </div>
                    )}
                    {app.status === 'accepted' && app.payment_method === 'app' && app.payment_status === 'unpaid' && (
                      <button onClick={() => payNow('application', app.id, app.fee_cents)} disabled={payingId === app.id}
                        className="w-full h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95 disabled:opacity-50">
                        {payingId === app.id ? 'Redirecting…' : `Pay €${(app.fee_cents / 100).toFixed(2)} via Stripe`}
                      </button>
                    )}
                    {app.status === 'accepted' && app.payment_status === 'paid' && (
                      <p className="text-center font-label-sm text-label-sm text-primary uppercase tracking-widest">✓ Paid via app</p>
                    )}
                    {app.status === 'accepted' && app.payment_status === 'off_app' && (
                      <p className="text-center font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Payment off-app</p>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <>
                <button onClick={() => setCreatingOpening(true)}
                  className="w-full h-12 border border-primary/30 text-primary font-h2 rounded-xl flex items-center justify-center gap-sm active:scale-95">
                  <span className="material-symbols-outlined text-[20px]">add</span>
                  Post New Opening
                </button>

                {creatingOpening && (
                  <form onSubmit={createOpening} className="glass-card p-md rounded-xl space-y-sm">
                    <div className="space-y-xs">
                      <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Title *</label>
                      <input value={openingForm.title} onChange={e => setOpeningForm(f => ({ ...f, title: e.target.value }))}
                        required className="vibe-input w-full" placeholder="e.g. Resident DJ — Saturdays" />
                    </div>
                    <div className="space-y-xs">
                      <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Description</label>
                      <textarea value={openingForm.description} onChange={e => setOpeningForm(f => ({ ...f, description: e.target.value }))}
                        rows={3} className="vibe-input w-full resize-none" placeholder="Tell DJs what you're looking for…" />
                    </div>
                    <div className="grid grid-cols-2 gap-sm">
                      <div className="space-y-xs">
                        <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Event Date</label>
                        <input type="date" value={openingForm.event_date} onChange={e => setOpeningForm(f => ({ ...f, event_date: e.target.value }))}
                          className="vibe-input w-full" />
                      </div>
                      <div className="space-y-xs">
                        <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Fee (€)</label>
                        <input type="number" min="0" step="10" value={openingForm.fee_cents} onChange={e => setOpeningForm(f => ({ ...f, fee_cents: e.target.value }))}
                          className="vibe-input w-full" placeholder="e.g. 300" />
                      </div>
                    </div>
                    <div className="space-y-xs">
                      <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Genres</label>
                      <div className="flex flex-wrap gap-xs">
                        {GENRE_OPTIONS.map(g => (
                          <button key={g} type="button"
                            onClick={() => setOpeningForm(f => ({ ...f, genres: f.genres.includes(g) ? f.genres.filter(x => x !== g) : [...f.genres, g] }))}
                            className={`px-sm py-xs rounded-full font-label-sm text-label-sm transition-all ${openingForm.genres.includes(g) ? 'bg-primary-container text-on-primary-container' : 'chip-default'}`}>
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-sm">
                      <button type="button" onClick={() => setCreatingOpening(false)}
                        className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Cancel</button>
                      <button type="submit"
                        className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">Post</button>
                    </div>
                  </form>
                )}

                {openings.length === 0 && !creatingOpening && (
                  <div className="text-center py-lg text-on-surface-variant">
                    <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">work_outline</span>
                    <p className="font-h2 text-h2 text-on-surface mb-xs">No openings posted</p>
                    <p className="font-body-md">Post a gig opening and DJs will apply.</p>
                  </div>
                )}

                {openings.map((o: any) => {
                  const appCount = o.gig_applications?.length ?? 0
                  return (
                    <div key={o.id} className={`glass-card p-md rounded-xl border ${o.status === 'open' ? 'border-primary/30' : 'border-outline-variant/20'}`}>
                      <div className="flex items-start justify-between mb-xs">
                        <p className="font-h2 text-h2 text-on-surface">{o.title}</p>
                        <span className={o.status === 'open' ? 'chip-live' : 'chip-default'}>{o.status.toUpperCase()}</span>
                      </div>
                      {o.event_date && (
                        <p className="font-body-md text-on-surface-variant text-sm mb-sm">
                          {new Date(o.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {o.fee_cents > 0 && ` · €${(o.fee_cents / 100).toFixed(0)}`}
                        </p>
                      )}
                      <div className="flex gap-sm">
                        <button onClick={() => viewApplications(o.id)}
                          className="flex-1 h-10 border border-primary/30 text-primary font-h2 rounded-xl flex items-center justify-center gap-xs active:scale-95">
                          <span className="material-symbols-outlined text-[16px]">people</span>
                          {appCount} Application{appCount !== 1 ? 's' : ''}
                        </button>
                        {o.status === 'open' && (
                          <button onClick={() => closeOpening(o.id)}
                            className="h-10 px-sm border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">
                            Close
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* BOOKING CONFIRMATION MODAL */}
        {bookingApp && (
          <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end justify-center p-container-padding">
            <div className="w-full max-w-sm bg-surface rounded-2xl p-md space-y-gutter border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <p className="font-h2 text-h2 text-on-surface">Confirm Booking</p>
                <button onClick={() => setBookingApp(null)} className="active:scale-95">
                  <span className="material-symbols-outlined text-on-surface-variant">close</span>
                </button>
              </div>
              <div className="flex items-center gap-sm p-sm bg-primary-container/10 rounded-xl border border-primary-container/20">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                  {bookingApp.dj_profiles?.avatar_url
                    ? <img src={bookingApp.dj_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-2">person</span>}
                </div>
                <p className="font-body-md text-on-surface font-bold">{bookingApp.dj_profiles?.stage_name}</p>
              </div>
              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Agreed Fee (€)</label>
                <input type="number" min="0" step="10"
                  value={bookingPayment.fee_euros}
                  onChange={e => setBookingPayment(f => ({ ...f, fee_euros: e.target.value }))}
                  className="vibe-input w-full" placeholder="0 for unpaid / barter" />
              </div>
              <div className="space-y-sm">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Payment Method</label>
                {(['off_app', 'app'] as const).map(method => (
                  <button key={method} type="button"
                    onClick={() => setBookingPayment(f => ({ ...f, method }))}
                    className={`w-full p-sm rounded-xl border-2 text-left transition-all ${bookingPayment.method === method ? 'border-primary bg-primary-container/20' : 'border-outline-variant/20 bg-surface-container'}`}>
                    <div className="flex items-center gap-sm">
                      <span className={`material-symbols-outlined text-[20px] ${bookingPayment.method === method ? 'text-primary' : 'text-on-surface-variant/40'}`}
                        style={bookingPayment.method === method ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {method === 'app' ? 'credit_card' : 'handshake'}
                      </span>
                      <div>
                        <p className={`font-body-md font-bold ${bookingPayment.method === method ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                          {method === 'app' ? 'Pay via Club Fuoco' : 'Handle off-app'}
                        </p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant/50">
                          {method === 'app'
                            ? `Secure Stripe payment — DJ receives €${bookingPayment.fee_euros ? (parseFloat(bookingPayment.fee_euros) * 0.88).toFixed(0) : '—'}`
                            : 'Cash, bank transfer, or your own arrangement'}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={confirmBookApp} disabled={payingId === bookingApp.id}
                className="w-full h-12 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50">
                {payingId === bookingApp.id ? 'Processing…' : bookingPayment.method === 'app' ? 'Confirm & Pay via Stripe' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        )}

        {/* BROWSE DJs */}
        {activeTab === 'djs' && (
          <div className="space-y-gutter">
            {requestForm ? (
              <form onSubmit={sendRequest} className="glass-card p-md rounded-xl space-y-sm">
                <div className="flex items-center justify-between mb-sm">
                  <p className="font-h2 text-h2 text-on-surface">Send Booking Request</p>
                  <button type="button" onClick={() => setRequestForm(null)} className="active:scale-95">
                    <span className="material-symbols-outlined text-on-surface-variant">close</span>
                  </button>
                </div>
                <div className="flex items-center gap-sm p-sm bg-primary-container/10 rounded-xl border border-primary-container/30">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                    {djList.find(d => d.id === requestForm.dj_id)?.avatar_url
                      ? <img src={djList.find(d => d.id === requestForm.dj_id)?.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="material-symbols-outlined text-[20px] text-on-surface-variant/30 block text-center mt-2">person</span>
                    }
                  </div>
                  <p className="font-body-md text-on-surface font-bold">{djList.find(d => d.id === requestForm.dj_id)?.stage_name}</p>
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Event Name *</label>
                  <input value={requestForm.event_name} onChange={e => setRequestForm(f => f ? { ...f, event_name: e.target.value } : f)}
                    required className="vibe-input w-full" placeholder="e.g. Saturday Night Live" />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Event Date</label>
                  <input type="date" value={requestForm.event_date} onChange={e => setRequestForm(f => f ? { ...f, event_date: e.target.value } : f)}
                    className="vibe-input w-full" />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Message</label>
                  <textarea value={requestForm.message} onChange={e => setRequestForm(f => f ? { ...f, message: e.target.value } : f)}
                    rows={2} className="vibe-input w-full resize-none" placeholder="Include set time or other details…" />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Fee (€)</label>
                  <input type="number" min="0" step="10" value={requestForm.fee_euros}
                    onChange={e => setRequestForm(f => f ? { ...f, fee_euros: e.target.value } : f)}
                    className="vibe-input w-full" placeholder="e.g. 300" />
                </div>
                <div className="space-y-sm">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Payment</label>
                  {(['off_app', 'app'] as const).map(method => (
                    <button key={method} type="button"
                      onClick={() => setRequestForm(f => f ? { ...f, payment_method: method } : f)}
                      className={`w-full p-sm rounded-xl border-2 text-left transition-all ${requestForm.payment_method === method ? 'border-primary bg-primary-container/20' : 'border-outline-variant/20 bg-surface-container'}`}>
                      <div className="flex items-center gap-sm">
                        <span className={`material-symbols-outlined text-[18px] ${requestForm.payment_method === method ? 'text-primary' : 'text-on-surface-variant/40'}`}
                          style={requestForm.payment_method === method ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                          {method === 'app' ? 'credit_card' : 'handshake'}
                        </span>
                        <div>
                          <p className={`font-body-md font-bold ${requestForm.payment_method === method ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                            {method === 'app' ? 'Pay via Club Fuoco' : 'Handle off-app'}
                          </p>
                          <p className="font-label-sm text-label-sm text-on-surface-variant/50 text-xs">
                            {method === 'app' ? 'Stripe checkout on send' : 'Cash, bank transfer, etc.'}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-sm">
                  <button type="button" onClick={() => setRequestForm(null)}
                    className="flex-1 h-10 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">Cancel</button>
                  <button type="submit"
                    className="flex-1 h-10 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95">
                    {requestForm.payment_method === 'app' ? 'Send & Pay' : 'Send Request'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <input value={djSearch} onChange={e => setDjSearch(e.target.value)}
                  className="vibe-input w-full" placeholder="Search DJs by name…" />

                {sentRequests.length > 0 && (
                  <div className="glass-card p-md rounded-xl">
                    <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">Sent Requests</h3>
                    <div className="space-y-xs">
                      {sentRequests.map((r: any) => (
                        <div key={r.id} className="py-xs border-b border-outline-variant/10 last:border-0">
                          <div className="flex items-center gap-sm">
                            <p className="font-body-md text-on-surface flex-1 truncate">{r.dj_profiles?.stage_name} — {r.event_name}</p>
                            <span className={r.status === 'accepted' ? 'chip-live' : 'chip-default'}>
                              {r.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center gap-sm mt-xs">
                            {r.fee_cents > 0 && (
                              <span className="font-label-sm text-label-sm text-primary">€{(r.fee_cents / 100).toFixed(0)}</span>
                            )}
                            {r.payment_status === 'paid' && (
                              <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest">✓ Paid</span>
                            )}
                            {r.payment_status === 'unpaid' && r.status === 'accepted' && (
                              <button onClick={() => payNow('request', r.id, r.fee_cents)} disabled={payingId === r.id}
                                className="font-label-sm text-label-sm text-on-primary-container bg-primary-container px-sm py-[2px] rounded-full uppercase tracking-widest disabled:opacity-50">
                                {payingId === r.id ? 'Redirecting…' : 'Pay now'}
                              </button>
                            )}
                            {r.payment_status === 'off_app' && (
                              <span className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest">Off-app</span>
                            )}
                            {r.event_date && (
                              <span className="font-label-sm text-label-sm text-on-surface-variant/50">
                                {new Date(r.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-sm">
                  {djList.filter(d => d.stage_name.toLowerCase().includes(djSearch.toLowerCase())).map((dj: any) => (
                    <div key={dj.id} className="glass-card p-sm rounded-xl flex items-center gap-sm">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0">
                        {dj.avatar_url
                          ? <img src={dj.avatar_url} alt={dj.stage_name} className="w-full h-full object-cover" />
                          : <span className="material-symbols-outlined text-[24px] text-on-surface-variant/30 block text-center mt-3">person</span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-xs">
                          <p className="font-body-md text-on-surface font-bold truncate">{dj.stage_name}</p>
                          {dj.is_verified && (
                            <span className="material-symbols-outlined text-primary text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                          )}
                        </div>
                        <p className="font-body-md text-on-surface-variant text-sm">{dj.follower_count?.toLocaleString()} followers</p>
                        {dj.genres?.length > 0 && (
                          <div className="flex gap-xs flex-wrap mt-xs">
                            {dj.genres.slice(0, 3).map((g: string) => <span key={g} className="chip-default text-xs">{g}</span>)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setRequestForm({ dj_id: dj.id, event_name: '', event_date: '', message: '', fee_euros: '', payment_method: 'off_app' })}
                        className="h-9 px-sm bg-primary-container text-on-primary-container font-label-sm text-label-sm uppercase tracking-widest rounded-xl ignite-glow active:scale-95 flex-shrink-0">
                        Invite
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* LINEUP */}
        {activeTab === 'lineup' && (
          <div className="space-y-gutter">
            {(data?.upcoming_gigs ?? []).length === 0 && (
              <div className="text-center py-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] block mb-sm text-primary">queue_music</span>
                <p className="font-h2 text-h2 text-on-surface mb-xs">No DJs booked</p>
                <p className="font-body-md">DJ gigs will appear here once added.</p>
              </div>
            )}

            {(data?.upcoming_gigs ?? []).map((gig: any) => (
              <div key={gig.id} className="glass-card p-md rounded-xl flex items-center gap-md">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0 border-2 border-outline-variant/20">
                  {gig.dj_profiles?.avatar_url ? (
                    <img src={gig.dj_profiles.avatar_url} alt={gig.dj_profiles.stage_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-[24px] text-on-surface-variant/30 block text-center mt-4">person</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-h2 text-h2 text-on-surface">{gig.dj_profiles?.stage_name}</p>
                  <p className="font-body-md text-on-surface-variant">{gig.event_name}</p>
                  <p className="font-body-md text-primary">
                    {new Date(gig.gig_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {gig.start_time && ` · ${gig.start_time.slice(0, 5)}`}
                    {gig.end_time && ` – ${gig.end_time.slice(0, 5)}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-xs">
                  <span className="chip-default capitalize">{gig.set_type}</span>
                  {gig.dj_profiles?.instagram_handle && (
                    <span className="font-label-sm text-label-sm text-on-surface-variant/50">@{gig.dj_profiles.instagram_handle}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <NavSpacer />
    </div>
  )
}
