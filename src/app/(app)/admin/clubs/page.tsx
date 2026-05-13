'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'

interface PlaceResult {
  place_id:  string
  name:      string
  address:   string
  rating?:   number
  types?:    string[]
}

interface Club {
  id:              string
  name:            string
  address?:        string
  rating?:         number
  is_partner:      boolean
  is_active:       boolean
  google_place_id?: string
  last_synced_at?: string
}

export default function AdminClubsPage() {
  const [clubs,        setClubs]        = useState<Club[]>([])
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState<PlaceResult[]>([])
  const [searching,    setSearching]    = useState(false)
  const [importing,    setImporting]    = useState<string | null>(null)
  const [syncing,      setSyncing]      = useState(false)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [loading,      setLoading]      = useState(true)

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    apiFetch('/api/admin/clubs/list')
      .then(r => r.json())
      .then(d => { setClubs(d.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setResults([])
    try {
      const res  = await apiFetch(`/api/admin/clubs/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setResults(data.data ?? [])
    } catch {
      showToast('Search failed', false)
    } finally {
      setSearching(false)
    }
  }

  async function importClub(placeId: string) {
    setImporting(placeId)
    try {
      const res  = await apiFetch('/api/admin/clubs/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ place_id: placeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'Import failed', false)
      } else {
        showToast(`✓ ${data.data.name} added!`, true)
        setClubs(prev => [data.data, ...prev])
        setResults(prev => prev.filter(r => r.place_id !== placeId))
      }
    } catch {
      showToast('Import failed', false)
    } finally {
      setImporting(null)
    }
  }

  async function togglePartner(club: Club) {
    const res  = await apiFetch(`/api/admin/clubs/${club.id}/partner`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_partner: !club.is_partner }),
    })
    if (res.ok) {
      setClubs(prev => prev.map(c => c.id === club.id ? { ...c, is_partner: !c.is_partner } : c))
    }
  }

  async function syncAll() {
    setSyncing(true)
    try {
      const res  = await apiFetch('/api/admin/sync', {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? 'dev'}` }
      })
      const data = await res.json()
      showToast(`Synced ${data.synced} clubs`, true)
    } catch {
      showToast('Sync failed', false)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="px-container-padding pt-base pb-lg">
      <div className="flex items-center justify-between mb-lg">
        <h2 className="font-h1 text-h1 text-on-surface">Club Manager</h2>
        <button
          onClick={syncAll}
          disabled={syncing}
          className="flex items-center gap-xs px-md py-sm bg-surface-container border border-outline-variant/30 rounded-xl text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">
          <span className="material-symbols-outlined text-[16px]">sync</span>
          {syncing ? 'Syncing…' : 'Sync all'}
        </button>
      </div>

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-md py-sm rounded-xl text-sm font-semibold shadow-lg
          ${toast.ok ? 'bg-primary-container text-on-primary-container' : 'bg-error-container text-on-error-container'}`}>
          {toast.msg}
        </div>
      )}

      {/* Search & import */}
      <div className="glass-card rounded-xl p-md mb-lg">
        <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">
          Import from Google Places
        </p>
        <div className="flex gap-sm">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search venue name… e.g. Sala Apolo"
            className="flex-1 bg-surface-container-high border border-outline-variant/30 rounded-xl px-md py-sm font-body-md text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/50"
          />
          <button
            onClick={search}
            disabled={searching}
            className="px-md py-sm bg-primary-container text-on-primary-container rounded-xl font-label-sm uppercase tracking-widest active:scale-95 disabled:opacity-50">
            {searching ? '…' : 'Search'}
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-md space-y-sm">
            {results.map(r => (
              <div key={r.place_id}
                className="flex items-center justify-between gap-sm bg-surface-container rounded-xl px-md py-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-h2 text-on-surface truncate">{r.name}</p>
                  <p className="font-body-md text-on-surface-variant/60 text-sm truncate">{r.address}</p>
                  {r.rating && (
                    <p className="font-label-sm text-primary text-[11px]">★ {r.rating}</p>
                  )}
                </div>
                <button
                  onClick={() => importClub(r.place_id)}
                  disabled={importing === r.place_id}
                  className="flex-shrink-0 px-sm py-xs bg-primary-container text-on-primary-container rounded-lg font-label-sm text-[12px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
                  {importing === r.place_id ? '…' : 'Import'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Club list */}
      <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">
        {clubs.length} clubs in database
      </p>

      {loading ? (
        <div className="space-y-sm">
          {[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-sm">
          {clubs.map(club => (
            <div key={club.id}
              className="glass-card rounded-xl px-md py-sm flex items-center justify-between gap-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-xs">
                  <p className="font-h2 text-on-surface truncate">{club.name}</p>
                  {club.is_partner && (
                    <span className="chip-live text-[10px] px-xs py-[1px]">Partner</span>
                  )}
                  {!club.is_active && (
                    <span className="chip-default text-[10px] px-xs py-[1px]">Inactive</span>
                  )}
                </div>
                <p className="font-body-md text-on-surface-variant/50 text-[11px] truncate">
                  {club.google_place_id ? `✓ Linked` : 'No Google link'} ·{' '}
                  {club.last_synced_at
                    ? `Synced ${new Date(club.last_synced_at).toLocaleDateString()}`
                    : 'Never synced'}
                </p>
              </div>
              <button
                onClick={() => togglePartner(club)}
                className={`flex-shrink-0 px-sm py-xs rounded-lg font-label-sm text-[11px] uppercase tracking-widest active:scale-95 transition-all
                  ${club.is_partner
                    ? 'bg-primary/20 border border-primary/30 text-primary'
                    : 'bg-surface-container border border-outline-variant/20 text-on-surface-variant/60'}`}>
                {club.is_partner ? '✦ Partner' : 'Set partner'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
