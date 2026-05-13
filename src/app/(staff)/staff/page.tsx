'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Rumba } from '@/types'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function StaffDashboard() {
  const [rumbas,  setRumbas]  = useState<Rumba[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    loadRumbas()
  }, [])

  async function loadRumbas() {
    setLoading(true)
    // Staff needs to see all rumbas including inactive — use service client via API
    const res  = await apiFetch('/api/staff/rumbas')
    const data = await res.json()
    setRumbas(data.data ?? [])
    setLoading(false)
  }

  async function toggleActive(rumba: Rumba) {
    setToggling(rumba.id)
    const res  = await apiFetch(`/api/rumbas/${rumba.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !rumba.is_active }),
    })
    const data = await res.json()
    if (data.data) {
      setRumbas(prev => prev.map(r => r.id === rumba.id ? { ...r, is_active: data.data.is_active } : r))
    }
    setToggling(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Rumbas</h1>
          <p className="text-on-surface-variant text-sm mt-1">Manage guest list events</p>
        </div>
        <Link
          href="/staff/rumbas/new"
          className="flex items-center gap-2 bg-primary text-on-primary font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity ignite-glow"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          New Rumba
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-16 text-on-surface-variant">
          <span className="material-symbols-outlined text-[40px] block mb-2 animate-pulse">local_fire_department</span>
          <p className="text-sm">Loading rumbas…</p>
        </div>
      ) : rumbas.length === 0 ? (
        <div className="text-center py-16 text-on-surface-variant glass-card rounded-2xl">
          <span className="material-symbols-outlined text-[48px] block mb-2 opacity-30">event</span>
          <p className="font-bold text-on-surface mb-1">No rumbas yet</p>
          <p className="text-sm mb-4">Create your first rumba to get started.</p>
          <Link href="/staff/rumbas/new" className="text-primary font-bold text-sm hover:underline">
            Create a Rumba →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {rumbas.map(rumba => {
            const pct   = Math.min(100, ((rumba.signup_count ?? 0) / rumba.capacity) * 100)
            const isFull = (rumba.signup_count ?? 0) >= rumba.capacity
            return (
              <div key={rumba.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
                {/* Cover thumb */}
                <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container-high">
                  {rumba.cover_image
                    ? <img src={rumba.cover_image} alt={rumba.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-[24px] text-primary/30" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                      </div>
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold text-on-surface truncate">{rumba.title}</p>
                    {rumba.is_active
                      ? <span className="text-[10px] font-bold text-green-400 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-[1px] uppercase tracking-wider flex-shrink-0">Live</span>
                      : <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container border border-outline-variant/30 rounded-full px-2 py-[1px] uppercase tracking-wider flex-shrink-0">Draft</span>
                    }
                  </div>
                  <p className="text-sm text-on-surface-variant mb-1 truncate">{rumba.venue_name} · {fmtDate(rumba.event_date)}</p>
                  {/* Capacity bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isFull ? 'bg-red-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`text-xs font-bold flex-shrink-0 ${isFull ? 'text-red-400' : 'text-on-surface-variant'}`}>
                      {rumba.signup_count ?? 0}/{rumba.capacity}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleActive(rumba)}
                    disabled={toggling === rumba.id}
                    title={rumba.is_active ? 'Deactivate' : 'Activate'}
                    className={`relative w-10 h-6 rounded-full transition-all flex-shrink-0 ${rumba.is_active ? 'bg-primary' : 'bg-surface-container border border-outline-variant/30'} ${toggling === rumba.id ? 'opacity-50' : ''}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${rumba.is_active ? 'left-5' : 'left-1'}`} />
                  </button>

                  <Link
                    href={`/staff/rumbas/${rumba.id}`}
                    className="flex items-center gap-1 bg-surface-container border border-outline-variant/30 text-on-surface text-sm font-bold px-3 py-1.5 rounded-lg hover:border-primary/50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    Manage
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
