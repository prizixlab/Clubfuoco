'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'choose' | 'form' | 'code' | 'status'
type VType = 'claim' | 'new'

interface Club { id: string; name: string; address: string; instagram_handle: string }

export default function ClubVerifyPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('choose')
  const [type, setType] = useState<VType>('claim')
  const [clubs, setClubs] = useState<Club[]>([])
  const [clubSearch, setClubSearch] = useState('')
  const [existing, setExisting] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [mapsUrl, setMapsUrl] = useState('')
  const [addingMaps, setAddingMaps] = useState(false)

  const [form, setForm] = useState({
    club_id: '',
    club_name: '',
    instagram_handle: '',
    address: '',
    city: '',
    google_maps_url: '',
    website_url: '',
  })

  useEffect(() => {
    Promise.all([
      apiFetch('/api/club-verify').then(r => r.json()),
      apiFetch('/api/clubs?limit=50').then(r => r.json()),
    ]).then(([statusRes, clubsRes]) => {
      if (statusRes.data) {
        setExisting(statusRes.data)
        setStep('status')
      }
      setClubs(clubsRes.data ?? [])
      setLoading(false)
    })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await apiFetch('/api/club-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...form }),
    })
    const data = await res.json()
    if (data.error) { alert(data.error); setSubmitting(false); return }
    setExisting(data.data)
    setStep('code')
    setSubmitting(false)
  }

  async function submitMapsUrl() {
    setAddingMaps(true)
    const res = await apiFetch('/api/club-verify', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_maps_url: mapsUrl }),
    })
    const data = await res.json()
    if (data.data) setExisting(data.data)
    setAddingMaps(false)
  }

  async function withdraw() {
    if (!confirm('Withdraw your verification request?')) return
    await apiFetch('/api/club-verify', { method: 'DELETE' })
    setExisting(null)
    setStep('choose')
  }

  const filteredClubs = clubs.filter(c =>
    c.name.toLowerCase().includes(clubSearch.toLowerCase()) ||
    (c.address ?? '').toLowerCase().includes(clubSearch.toLowerCase())
  )

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">domain_verification</span>
    </div>
  )

  const statusConfig = {
    pending_instagram: {
      icon: 'photo_camera',
      color: 'text-primary',
      label: 'Waiting for Instagram verification',
      desc: 'Add the code below to your Instagram bio, then we\'ll confirm it\'s you.',
    },
    pending_maps: {
      icon: 'location_on',
      color: 'text-yellow-400',
      label: 'Google Maps required',
      desc: 'Your club needs to be on Google Maps. Add the link below.',
    },
    pending_review: {
      icon: 'hourglass_top',
      color: 'text-yellow-400',
      label: 'Under review',
      desc: 'Our team is reviewing your request. Usually within 24–48 hours.',
    },
    approved: {
      icon: 'verified',
      color: 'text-primary',
      label: 'Verified!',
      desc: 'Your club is live on Club Fuoco.',
    },
    rejected: {
      icon: 'cancel',
      color: 'text-error',
      label: 'Not approved',
      desc: 'Your request was not approved.',
    },
  }

  return (
    <div className="px-container-padding pt-md pb-xl space-y-gutter">

      {/* Header */}
      <div>
        <h1 className="font-h1 text-h1 text-primary uppercase tracking-[0.1em]">Club Verification</h1>
        <p className="font-body-md text-on-surface-variant mt-xs">Link your venue to Club Fuoco</p>
      </div>

      {/* STATUS — already submitted */}
      {step === 'status' && existing && (() => {
        const cfg = statusConfig[existing.status as keyof typeof statusConfig]
        return (
          <div className="space-y-gutter">
            <div className="glass-card p-md rounded-xl border border-outline-variant/20">
              <div className="flex items-center gap-sm mb-sm">
                <span className={`material-symbols-outlined text-[32px] ${cfg.color}`}
                  style={{ fontVariationSettings: "'FILL' 1" }}>{cfg.icon}</span>
                <div>
                  <p className="font-h2 text-h2 text-on-surface">{existing.club_name}</p>
                  <p className={`font-label-sm text-label-sm uppercase tracking-widest ${cfg.color}`}>{cfg.label}</p>
                </div>
              </div>
              <p className="font-body-md text-on-surface-variant">{cfg.desc}</p>
              {existing.admin_note && (
                <p className="font-body-md text-on-surface-variant mt-sm italic border-l-2 border-primary/30 pl-sm">
                  "{existing.admin_note}"
                </p>
              )}
            </div>

            {/* Show code if still waiting for Instagram */}
            {existing.status === 'pending_instagram' && (
              <div className="glass-card p-md rounded-xl border border-primary/30 space-y-sm">
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Your verification code</p>
                <div className="flex items-start justify-between gap-sm bg-surface-container rounded-xl px-md py-sm">
                  <p className="font-body-md text-primary text-base leading-relaxed italic">"{existing.verification_code}"</p>
                  <button onClick={() => navigator.clipboard.writeText(existing.verification_code)}
                    className="active:scale-95 flex-shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-on-surface-variant text-[20px]">content_copy</span>
                  </button>
                </div>
                <div className="space-y-xs">
                  <p className="font-body-md text-on-surface font-bold">How to verify:</p>
                  <ol className="space-y-xs list-none">
                    {[
                      `Go to your Instagram account @${existing.instagram_handle}`,
                      'Add the code to your bio — anywhere is fine',
                      'Our team will check within 24 hours and remove it from your bio instructions',
                      'Once confirmed, remove it from your bio',
                    ].map((step, i) => (
                      <li key={i} className="flex gap-sm font-body-md text-on-surface-variant">
                        <span className="w-5 h-5 rounded-full bg-primary-container/40 text-primary font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            {/* Maps URL input if pending_maps */}
            {existing.status === 'pending_maps' && (
              <div className="glass-card p-md rounded-xl border border-yellow-400/30 space-y-sm">
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Add Google Maps link</p>
                <p className="font-body-md text-on-surface-variant">
                  Search for your club on Google Maps, tap Share → Copy link, and paste it here.
                </p>
                <input value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
                  className="vibe-input w-full" placeholder="https://maps.google.com/…" />
                <button onClick={submitMapsUrl} disabled={!mapsUrl || addingMaps}
                  className="w-full h-12 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow disabled:opacity-50">
                  {addingMaps ? 'Saving…' : 'Submit Maps Link'}
                </button>
              </div>
            )}

            {/* Approved → go to dashboard */}
            {existing.status === 'approved' && (
              <button onClick={() => router.push('/club-dashboard')}
                className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98]">
                Go to Dashboard
              </button>
            )}

            {/* Rejected → allow resubmit */}
            {existing.status === 'rejected' && (
              <button onClick={withdraw}
                className="w-full h-12 border border-primary/30 text-primary font-h2 rounded-xl active:scale-95">
                Submit a New Request
              </button>
            )}

            {/* Withdraw (only while pending) */}
            {['pending_instagram', 'pending_maps'].includes(existing.status) && (
              <button onClick={withdraw}
                className="w-full h-10 text-on-surface-variant/50 font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
                Withdraw request
              </button>
            )}
          </div>
        )
      })()}

      {/* CHOOSE type */}
      {step === 'choose' && (
        <div className="space-y-gutter">
          <p className="font-body-md text-on-surface-variant">Is your club already on Club Fuoco, or are you adding a new one?</p>
          <div className="space-y-sm">
            {([
              { value: 'claim', icon: 'domain', title: 'My club is already listed', desc: 'Claim ownership and manage your existing venue page' },
              { value: 'new', icon: 'add_business', title: 'Register a new club', desc: 'Add your venue — requires Instagram, address, and Google Maps within 7 days' },
            ] as const).map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { setType(opt.value); setStep('form') }}
                className="w-full p-md glass-card rounded-xl border border-outline-variant/20 text-left flex items-start gap-sm active:scale-[0.98] hover:border-primary/30 transition-colors">
                <span className="material-symbols-outlined text-primary text-[28px] mt-0.5"
                  style={{ fontVariationSettings: "'FILL' 1" }}>{opt.icon}</span>
                <div>
                  <p className="font-h2 text-h2 text-on-surface">{opt.title}</p>
                  <p className="font-body-md text-on-surface-variant mt-xs">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FORM */}
      {step === 'form' && (
        <form onSubmit={submit} className="space-y-gutter">
          <button type="button" onClick={() => setStep('choose')}
            className="flex items-center gap-xs text-primary font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back
          </button>

          {type === 'claim' && (
            <div className="space-y-sm">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Search for your club</label>
              <input value={clubSearch} onChange={e => setClubSearch(e.target.value)}
                className="vibe-input w-full" placeholder="Club name or address…" />
              <div className="space-y-xs max-h-64 overflow-y-auto">
                {filteredClubs.length === 0 && clubSearch && (
                  <p className="font-body-md text-on-surface-variant text-center py-md">
                    Not found — <button type="button" className="text-primary underline" onClick={() => { setType('new'); setClubSearch('') }}>register it instead</button>
                  </p>
                )}
                {filteredClubs.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => setForm(f => ({ ...f, club_id: c.id, instagram_handle: c.instagram_handle ?? '' }))}
                    className={`w-full p-sm rounded-xl text-left border transition-all ${form.club_id === c.id ? 'border-primary bg-primary-container/10' : 'border-outline-variant/20 glass-card'}`}>
                    <p className="font-body-md text-on-surface font-bold">{c.name}</p>
                    <p className="font-body-md text-on-surface-variant text-sm">{c.address}</p>
                    {c.instagram_handle && (
                      <p className="font-label-sm text-label-sm text-primary mt-xs">@{c.instagram_handle}</p>
                    )}
                  </button>
                ))}
              </div>
              {/* Show the known Instagram once a club is selected — read-only */}
              {form.club_id && form.instagram_handle && (
                <div className="glass-card p-sm rounded-xl border border-primary/30 flex items-center gap-sm">
                  <span className="material-symbols-outlined text-primary text-[20px]">photo_camera</span>
                  <div>
                    <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">We'll verify this account</p>
                    <p className="font-body-md text-on-surface font-bold">@{form.instagram_handle}</p>
                  </div>
                </div>
              )}
              {form.club_id && !form.instagram_handle && (
                <div className="glass-card p-sm rounded-xl border border-yellow-400/30 flex items-center gap-sm">
                  <span className="material-symbols-outlined text-yellow-400 text-[20px]">warning</span>
                  <p className="font-body-md text-on-surface-variant text-sm">This club has no Instagram on file — please enter it below.</p>
                </div>
              )}
            </div>
          )}

          {type === 'new' && (
            <>
              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Club Name *</label>
                <input value={form.club_name} onChange={e => setForm(f => ({ ...f, club_name: e.target.value }))}
                  required className="vibe-input w-full" placeholder="e.g. Opium Barcelona" />
              </div>
              <div className="grid grid-cols-2 gap-sm">
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">City *</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    required className="vibe-input w-full" placeholder="Barcelona" />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Website</label>
                  <input value={form.website_url} onChange={e => setForm(f => ({ ...f, website_url: e.target.value }))}
                    className="vibe-input w-full" placeholder="https://…" />
                </div>
              </div>
              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Address *</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  required className="vibe-input w-full" placeholder="Passeig Marítim, 34" />
              </div>
              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                  Google Maps Link <span className="normal-case text-on-surface-variant/40">(optional — required within 7 days)</span>
                </label>
                <input value={form.google_maps_url} onChange={e => setForm(f => ({ ...f, google_maps_url: e.target.value }))}
                  className="vibe-input w-full" placeholder="https://maps.google.com/…" />
                {!form.google_maps_url && (
                  <p className="font-label-sm text-label-sm text-yellow-400/80">
                    You have 7 days to add this. New clubs without a Maps listing will be removed.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Instagram — only ask for new clubs, or existing clubs with no handle on file */}
          {(type === 'new' || (type === 'claim' && form.club_id && !form.instagram_handle)) && (
            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                Instagram Handle *
              </label>
              <div className="flex items-center vibe-input rounded-xl overflow-hidden">
                <span className="text-on-surface-variant/40 font-body-md pl-sm pr-xs">@</span>
                <input value={form.instagram_handle} onChange={e => setForm(f => ({ ...f, instagram_handle: e.target.value.replace('@', '') }))}
                  required className="flex-1 bg-transparent outline-none py-sm pr-sm font-body-md text-on-surface" placeholder="clubname" />
              </div>
            </div>
          )}

          {/* Explain what happens next */}
          <div className="glass-card p-sm rounded-xl border border-outline-variant/20 flex gap-sm">
            <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0 mt-0.5">info</span>
            <p className="font-body-md text-on-surface-variant text-sm">
              After submitting, you'll receive a unique code to post in your Instagram bio. Our team verifies it within 24 hours.
            </p>
          </div>

          <button type="submit" disabled={submitting || (type === 'claim' && !form.club_id)}
            className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit for Verification'}
          </button>
        </form>
      )}

      {/* CODE step — shown right after first submission */}
      {step === 'code' && existing && (
        <div className="space-y-gutter">
          <div className="text-center py-md">
            <span className="material-symbols-outlined text-[64px] text-primary block mb-sm"
              style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <p className="font-h1 text-h1 text-on-surface">Request submitted</p>
            <p className="font-body-md text-on-surface-variant mt-xs">Now verify your Instagram</p>
          </div>
          <div className="glass-card p-md rounded-xl border border-primary/30 space-y-sm">
            <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Your code</p>
            <div className="flex items-start justify-between gap-sm bg-surface-container rounded-xl px-md py-sm">
              <p className="font-body-md text-primary text-base leading-relaxed italic">"{existing.verification_code}"</p>
              <button onClick={() => navigator.clipboard.writeText(existing.verification_code)} className="active:scale-95 flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-on-surface-variant text-[20px]">content_copy</span>
              </button>
            </div>
            <ol className="space-y-sm">
              {[
                `Open Instagram and go to @${existing.instagram_handle}`,
                'Edit your profile → add the code anywhere in your bio',
                'Our team will check and approve within 24 hours',
                'Once confirmed, you can remove the code from your bio',
              ].map((s, i) => (
                <li key={i} className="flex gap-sm font-body-md text-on-surface-variant">
                  <span className="w-5 h-5 rounded-full bg-primary-container/40 text-primary font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <button onClick={() => setStep('status')}
            className="w-full h-12 border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">
            View Request Status
          </button>
        </div>
      )}
    </div>
  )
}
