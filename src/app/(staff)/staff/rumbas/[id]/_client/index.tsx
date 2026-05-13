'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Rumba, RumbaSignup } from '@/types'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed',  cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  arrived:   { label: 'Checked In', cls: 'bg-primary/20 text-primary border-primary/30' },
  denied:    { label: 'Denied',     cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
}

export default function ManageRumbaPage() {
  const params  = useParams()
  const id      = params.id as string

  const [rumba,    setRumba]    = useState<Rumba | null>(null)
  const [signups,  setSignups]  = useState<RumbaSignup[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [toggling, setToggling] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [error,    setError]    = useState('')

  const [form, setForm] = useState({
    title: '', venue_name: '', event_date: '', capacity: 100,
    description: '', dress_code: '', cover_image: '',
  })

  useEffect(() => {
    loadAll()
  }, [id])

  async function loadAll() {
    setLoading(true)
    const [rumbaRes, signupsRes] = await Promise.all([
      apiFetch(`/api/rumbas/${id}`).then(r => r.json()),
      apiFetch(`/api/rumbas/${id}/signups`).then(r => r.json()),
    ])
    if (rumbaRes.data) {
      setRumba(rumbaRes.data)
      const r = rumbaRes.data
      // Convert event_date to datetime-local format
      const dtLocal = r.event_date ? new Date(r.event_date).toISOString().slice(0, 16) : ''
      setForm({
        title:       r.title,
        venue_name:  r.venue_name,
        event_date:  dtLocal,
        capacity:    r.capacity,
        description: r.description ?? '',
        dress_code:  r.dress_code ?? '',
        cover_image: r.cover_image ?? '',
      })
    }
    setSignups(signupsRes.data ?? [])
    setLoading(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res  = await apiFetch(`/api/rumbas/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Save failed'); return }
    setRumba(prev => prev ? { ...prev, ...data.data } : data.data)
    setEditMode(false)
  }

  async function handleToggleActive() {
    if (!rumba) return
    setToggling(true)
    const res  = await apiFetch(`/api/rumbas/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !rumba.is_active }),
    })
    const data = await res.json()
    setToggling(false)
    if (data.data) setRumba(prev => prev ? { ...prev, is_active: data.data.is_active } : null)
  }

  async function handleStatusChange(signupId: string, status: 'arrived' | 'denied' | 'confirmed') {
    setActioning(signupId)
    const res  = await apiFetch(`/api/rumbas/${id}/signups/${signupId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status }),
    })
    const data = await res.json()
    setActioning(null)
    if (data.data) {
      setSignups(prev => prev.map(s => s.id === signupId ? data.data : s))
    }
  }

  const filtered = search
    ? signups.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()))
    : signups

  const arrived   = signups.filter(s => s.status === 'arrived').length
  const confirmed = signups.filter(s => s.status === 'confirmed').length
  const denied    = signups.filter(s => s.status === 'denied').length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-on-surface-variant">
        <span className="material-symbols-outlined text-[40px] animate-pulse">local_fire_department</span>
      </div>
    )
  }

  if (!rumba) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 text-center text-on-surface-variant">
        <p className="font-bold text-on-surface mb-2">Rumba not found</p>
        <Link href="/staff" className="text-primary text-sm">← Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/staff" className="text-on-surface-variant hover:text-on-surface mt-1 transition-colors">
          <span className="material-symbols-outlined text-[24px]">arrow_back</span>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white truncate">{rumba.title}</h1>
            {rumba.is_active
              ? <span className="text-[10px] font-bold text-green-400 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-[1px] uppercase tracking-wider">Live</span>
              : <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container border border-outline-variant/30 rounded-full px-2 py-[1px] uppercase tracking-wider">Draft</span>
            }
          </div>
          <p className="text-on-surface-variant text-sm mt-0.5">{rumba.venue_name} · {fmtDate(rumba.event_date)}</p>
        </div>
      </div>

      {/* Active toggle — big prominent */}
      <div className="glass-card rounded-2xl p-5 mb-6 flex items-center justify-between">
        <div>
          <p className="font-bold text-on-surface text-base">{rumba.is_active ? 'Live — Visible to guests' : 'Draft — Hidden from guests'}</p>
          <p className="text-on-surface-variant text-sm mt-0.5">
            {rumba.is_active
              ? 'This rumba appears on the Explore shelf and guests can sign up.'
              : 'Toggle to make this rumba visible and open signups.'}
          </p>
        </div>
        <button
          onClick={handleToggleActive}
          disabled={toggling}
          className={`relative w-16 h-9 rounded-full transition-all flex-shrink-0 ${rumba.is_active ? 'bg-primary ignite-glow' : 'bg-surface-container border border-outline-variant/30'} ${toggling ? 'opacity-50' : ''}`}
        >
          <span className={`absolute top-1.5 w-6 h-6 rounded-full bg-white transition-all shadow ${rumba.is_active ? 'left-9' : 'left-1.5'}`} />
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Signed Up', value: signups.filter(s => s.status !== 'denied').length, icon: 'how_to_reg', color: 'text-on-surface' },
          { label: 'Capacity',  value: rumba.capacity,     icon: 'groups',                  color: 'text-on-surface-variant' },
          { label: 'Arrived',   value: arrived,             icon: 'check_circle',             color: 'text-primary' },
          { label: 'Denied',    value: denied,              icon: 'cancel',                   color: 'text-red-400' },
        ].map(stat => (
          <div key={stat.label} className="glass-card rounded-xl p-3 text-center">
            <span className={`material-symbols-outlined text-[20px] ${stat.color}`} style={{ fontVariationSettings: "'FILL' 1" }}>{stat.icon}</span>
            <p className={`text-xl font-bold ${stat.color} mt-1`}>{stat.value}</p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Edit form */}
      <div className="glass-card rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-on-surface">Event Details</h2>
          <button
            onClick={() => setEditMode(m => !m)}
            className="text-sm text-primary font-semibold flex items-center gap-1 hover:opacity-80 transition-opacity"
          >
            <span className="material-symbols-outlined text-[16px]">{editMode ? 'close' : 'edit'}</span>
            {editMode ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editMode ? (
          <form onSubmit={handleSave} className="space-y-4">
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Title *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Venue *</label>
                <input type="text" value={form.venue_name} onChange={e => setForm(f => ({ ...f, venue_name: e.target.value }))} required
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Date & Time *</label>
                <input type="datetime-local" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} required
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Capacity</label>
                <input type="number" min={1} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: parseInt(e.target.value, 10) || 100 }))}
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Dress Code</label>
                <input type="text" value={form.dress_code} onChange={e => setForm(f => ({ ...f, dress_code: e.target.value }))}
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Cover Image URL</label>
                <input type="url" value={form.cover_image} onChange={e => setForm(f => ({ ...f, cover_image: e.target.value }))}
                  className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
                className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary/60 resize-none" />
            </div>

            <button type="submit" disabled={saving}
              className="w-full py-3 rounded-xl font-bold bg-primary text-on-primary ignite-glow disabled:opacity-50 flex items-center justify-center gap-2">
              {saving
                ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Saving…</>
                : <><span className="material-symbols-outlined text-[18px]">save</span> Save Changes</>
              }
            </button>
          </form>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: 'Venue',       value: rumba.venue_name },
              { label: 'Date',        value: fmtDate(rumba.event_date) },
              { label: 'Capacity',    value: `${rumba.capacity} guests` },
              { label: 'Dress Code',  value: rumba.dress_code ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-on-surface-variant text-xs uppercase tracking-wider mb-0.5">{label}</dt>
                <dd className="text-on-surface font-medium">{value}</dd>
              </div>
            ))}
            {rumba.description && (
              <div className="col-span-2">
                <dt className="text-on-surface-variant text-xs uppercase tracking-wider mb-0.5">Description</dt>
                <dd className="text-on-surface">{rumba.description}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Guest list */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-on-surface">Guest List ({signups.filter(s => s.status !== 'denied').length})</h2>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/50">search</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="bg-surface-container border border-outline-variant/30 rounded-xl pl-8 pr-3 py-2 text-on-surface text-sm placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60 w-44"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8 text-on-surface-variant">
            <span className="material-symbols-outlined text-[32px] block mb-2 opacity-30">group</span>
            <p className="text-sm">{search ? 'No guests match your search' : 'No signups yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((signup, idx) => {
              const cfg = STATUS_CFG[signup.status] ?? STATUS_CFG.confirmed
              const totalPeople = 1 + signup.plus_ones
              return (
                <div key={signup.id} className="flex items-center gap-3 p-3 bg-surface-container rounded-xl">
                  {/* Position number */}
                  <span className="w-6 text-center text-xs text-on-surface-variant/40 font-mono flex-shrink-0">
                    {idx + 1}
                  </span>

                  {/* Name + details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-on-surface text-sm truncate">{signup.name}</p>
                      {signup.plus_ones > 0 && (
                        <span className="text-[10px] text-on-surface-variant/60 bg-surface-container-high rounded-full px-1.5 py-0.5 flex-shrink-0">
                          +{signup.plus_ones} ({totalPeople} total)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant/50">{fmtShortDate(signup.created_at)}</p>
                  </div>

                  {/* Status badge */}
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border flex-shrink-0 ${cfg.cls}`}>{cfg.label}</span>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    {signup.status !== 'arrived' && (
                      <button
                        onClick={() => handleStatusChange(signup.id, 'arrived')}
                        disabled={actioning === signup.id}
                        title="Check In"
                        className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-colors flex items-center justify-center disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>how_to_reg</span>
                      </button>
                    )}
                    {signup.status !== 'denied' && (
                      <button
                        onClick={() => handleStatusChange(signup.id, 'denied')}
                        disabled={actioning === signup.id}
                        title="Deny"
                        className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">block</span>
                      </button>
                    )}
                    {signup.status !== 'confirmed' && (
                      <button
                        onClick={() => handleStatusChange(signup.id, 'confirmed')}
                        disabled={actioning === signup.id}
                        title="Reset to Confirmed"
                        className="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:border-outline-variant transition-colors flex items-center justify-center disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">undo</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
