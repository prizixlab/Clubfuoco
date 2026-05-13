'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'

interface Club { id: string; name: string }
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
}

export default function AdminGuestListsPage() {
  const [lists, setLists] = useState<GuestList[]>([])
  const [clubs, setClubs] = useState<Club[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedList, setSelectedList] = useState<string | null>(null)
  const [signups, setSignups] = useState<any[]>([])

  const [form, setForm] = useState({
    club_id: '',
    event_name: '',
    event_date: new Date().toISOString().split('T')[0],
    cutoff_time: '01:00',
    capacity: 50,
    free_entry_label: 'Free Entry Tonight',
    notes: '',
    is_active: false,
  })

  useEffect(() => {
    Promise.all([
      apiFetch('/api/guest-lists?admin=1').then(r => r.json()),
      apiFetch('/api/clubs').then(r => r.json()),
    ]).then(([listsData, clubsData]) => {
      setLists(listsData.data ?? [])
      setClubs(clubsData.data ?? [])
      setLoading(false)
    })

    // Auto-refresh counts every 30 seconds
    const interval = setInterval(() => {
      apiFetch('/api/guest-lists?admin=1').then(r => r.json()).then(d => {
        if (d.data) setLists(d.data)
      })
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  async function toggleActive(list: GuestList) {
    const updated = { ...list, is_active: !list.is_active }
    setLists(prev => prev.map(l => l.id === list.id ? updated : l))
    await apiFetch(`/api/guest-lists/${list.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !list.is_active }),
    })
  }

  async function deleteList(id: string) {
    setLists(prev => prev.filter(l => l.id !== id))
    await apiFetch(`/api/guest-lists/${id}`, { method: 'DELETE' })
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await apiFetch('/api/guest-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.data) setLists(prev => [data.data, ...prev])
    setShowForm(false)
    setSaving(false)
  }

  async function refreshLists() {
    const res = await apiFetch('/api/guest-lists?admin=1')
    const data = await res.json()
    if (data.data) setLists(data.data)
  }

  async function viewSignups(id: string) {
    setSelectedList(id)
    const res = await apiFetch(`/api/guest-lists/${id}?view=signups`)
    const data = await res.json()
    const rows = data.data ?? []
    setSignups(rows)
    // update the count in the card immediately from real DB data
    const realCount = rows.reduce((sum: number, s: any) => sum + s.party_size, 0)
    setLists(prev => prev.map(l => l.id === id ? { ...l, signups_count: realCount } : l))
  }

  function closeDrawer() {
    // Persist the real count into the card before clearing signups
    if (selectedList && signups.length > 0) {
      const realCount = signups.reduce((sum, s) => sum + s.party_size, 0)
      setLists(prev => prev.map(l => l.id === selectedList ? { ...l, signups_count: realCount } : l))
    }
    setSelectedList(null)
    setSignups([])
    refreshLists()
  }

  async function checkIn(listId: string, signupId: string, checked: boolean) {
    // Optimistic update
    setSignups(prev => prev.map(s => s.id === signupId ? { ...s, checked_in: checked } : s))

    const res = await apiFetch(`/api/guest-lists/${listId}/signup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signup_id: signupId, checked_in: checked }),
    })

    // Refetch from DB to confirm — reverts if the update failed
    const fresh = await apiFetch(`/api/guest-lists/${listId}?view=signups`)
    const data = await fresh.json()
    if (data.data) {
      setSignups(data.data)
      const realCount = data.data.reduce((sum: number, s: any) => sum + s.party_size, 0)
      setLists(prev => prev.map(l => l.id === listId ? { ...l, signups_count: realCount } : l))
    }
  }

  const clubName = (id: string) => clubs.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="px-container-padding pt-md pb-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-lg">
        <div>
          <h1 className="font-h1 text-h1 text-primary tracking-[0.1em] uppercase">Admin</h1>
          <p className="font-body-md text-on-surface-variant">Guest List Manager</p>
        </div>
        <div className="flex gap-sm">
          <button
            onClick={refreshLists}
            className="flex items-center gap-xs border border-outline-variant/30 text-on-surface-variant px-sm py-sm rounded-xl font-h2 active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-xs bg-primary-container text-on-primary-container px-md py-sm rounded-xl font-h2 ignite-glow active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            New List
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end">
          <div className="w-full bg-surface-container rounded-t-2xl p-md pb-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-md">
              <h2 className="font-h2 text-h2 text-on-surface">New Guest List</h2>
              <button onClick={() => setShowForm(false)}>
                <span className="material-symbols-outlined text-on-surface-variant">close</span>
              </button>
            </div>

            <form onSubmit={createList} className="space-y-gutter">
              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Club</label>
                <select
                  value={form.club_id}
                  onChange={e => setForm(f => ({ ...f, club_id: e.target.value }))}
                  required
                  className="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg px-sm py-sm text-on-surface font-body-md"
                >
                  <option value="">Select a club…</option>
                  {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Event Name</label>
                <input value={form.event_name} onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))}
                  required className="vibe-input w-full" placeholder="e.g. Rumbalist Saturday" />
              </div>

              <div className="grid grid-cols-2 gap-gutter">
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Date</label>
                  <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                    required className="vibe-input w-full" />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Cutoff</label>
                  <input type="time" value={form.cutoff_time} onChange={e => setForm(f => ({ ...f, cutoff_time: e.target.value }))}
                    required className="vibe-input w-full" />
                </div>
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Capacity</label>
                <input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: +e.target.value }))}
                  min={1} max={500} required className="vibe-input w-full" />
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Button Label</label>
                <input value={form.free_entry_label} onChange={e => setForm(f => ({ ...f, free_entry_label: e.target.value }))}
                  className="vibe-input w-full" placeholder="Free Entry Tonight" />
              </div>

              <div className="space-y-xs">
                <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Notes</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="vibe-input w-full" placeholder="Internal notes…" />
              </div>

              <div className="flex items-center justify-between glass-card p-sm rounded-xl">
                <span className="font-body-md text-on-surface">Activate immediately</span>
                <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`w-12 h-6 rounded-full transition-colors ${form.is_active ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${form.is_active ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <button type="submit" disabled={saving}
                className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow disabled:opacity-50">
                {saving ? 'Creating…' : 'Create Guest List'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Signups drawer */}
      {selectedList && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end">
          <div className="w-full bg-surface-container rounded-t-2xl p-md pb-xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-md">
              <h2 className="font-h2 text-h2 text-on-surface">Signups ({signups.length})</h2>
              <button onClick={closeDrawer}>
                <span className="material-symbols-outlined text-on-surface-variant">close</span>
              </button>
            </div>

            {signups.length === 0 && (
              <p className="font-body-md text-on-surface-variant text-center py-lg">No signups yet</p>
            )}

            <div className="space-y-xs">
              {signups.map((s, i) => (
                <div key={s.id} className={`flex items-center justify-between glass-card p-sm rounded-lg ${s.checked_in ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-sm">
                    <span className="font-label-sm text-label-sm text-on-surface-variant/40 w-6">{i + 1}</span>
                    <div>
                      <div className="flex items-center gap-xs">
                        <p className="font-body-md text-on-surface font-bold">{s.full_name}</p>
                        {s.tier === 'vip' && <span className="chip-live text-[10px] py-[1px] px-xs">VIP</span>}
                      </div>
                      {s.email && <p className="font-label-sm text-label-sm text-on-surface-variant/60">{s.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-sm">
                    <span className="flex items-center gap-xs">
                      <span className="material-symbols-outlined text-primary text-[16px]">group</span>
                      <span className="font-body-md text-primary font-bold">{s.party_size}</span>
                    </span>
                    <button
                      onClick={() => checkIn(selectedList!, s.id, !s.checked_in)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        s.checked_in ? 'bg-primary-container text-on-primary-container' : 'border border-outline-variant/30 text-on-surface-variant/40'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]" style={s.checked_in ? { fontVariationSettings: `'FILL' 1` } : undefined}>
                        check_circle
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {signups.length > 0 && (
              <div className="mt-md glass-card p-sm rounded-xl flex justify-between items-center">
                <div>
                  <span className="font-body-md text-on-surface-variant">Total guests</span>
                  <p className="font-label-sm text-label-sm text-on-surface-variant/50 mt-xs">
                    {signups.filter(s => s.checked_in).length} checked in
                  </p>
                </div>
                <span className="font-h2 text-h2 text-primary">
                  {signups.reduce((sum, s) => sum + s.party_size, 0)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lists */}
      {loading && (
        <div className="space-y-gutter">
          {[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-xl h-28 animate-pulse" />)}
        </div>
      )}

      {!loading && lists.length === 0 && (
        <div className="text-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[48px] mb-sm block text-primary">list_alt</span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">No guest lists yet</p>
          <p className="font-body-md">Create your first one above.</p>
        </div>
      )}

      <div className="space-y-gutter">
        {lists.map(list => (
          <div key={list.id} className={`glass-card rounded-xl p-md border ${list.is_active ? 'border-primary-container/40' : 'border-outline-variant/20'}`}>
            <div className="flex justify-between items-start mb-sm">
              <div className="flex-1">
                <div className="flex items-center gap-xs mb-xs">
                  <span className={list.is_active ? 'chip-live' : 'chip-default'}>
                    {list.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest">
                    {clubName(list.club_id)}
                  </span>
                </div>
                <h3 className="font-h2 text-h2 text-on-surface">{list.event_name}</h3>
                <p className="font-body-md text-on-surface-variant">
                  {new Date(list.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })} · Before {list.cutoff_time?.slice(0, 5)}
                </p>
              </div>

              {/* Toggle */}
              <button onClick={() => toggleActive(list)}
                className={`w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-sm ${list.is_active ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
                <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform mx-0.5 ${list.is_active ? 'translate-x-7' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Capacity bar */}
            <div className="flex items-center gap-sm mt-sm">
              <span className="material-symbols-outlined text-primary text-[16px]">group</span>
              <span className="font-body-md text-on-surface">
                <span className="text-primary font-bold">{list.signups_count}</span>
                <span className="text-on-surface-variant"> / {list.capacity}</span>
              </span>
              <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-container rounded-full transition-all"
                  style={{ width: `${Math.min(100, (list.signups_count / list.capacity) * 100)}%` }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-sm mt-sm pt-sm border-t border-outline-variant/10">
              <button onClick={() => viewSignups(list.id)}
                className="flex-1 h-9 flex items-center justify-center gap-xs border border-primary/30 text-primary font-label-sm text-label-sm uppercase tracking-widest rounded-xl active:scale-95">
                <span className="material-symbols-outlined text-[16px]">visibility</span>
                View List
              </button>
              <button onClick={() => deleteList(list.id)}
                className="h-9 px-md flex items-center gap-xs border border-outline-variant/20 text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest rounded-xl active:scale-95">
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
