'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'

interface VerifRequest {
  id: string
  user_id: string
  club_id: string | null
  club_name: string
  instagram_handle: string
  address: string | null
  city: string | null
  google_maps_url: string | null
  website_url: string | null
  verification_code: string
  status: string
  instagram_verified_at: string | null
  maps_verified_at: string | null
  admin_note: string | null
  created_at: string
  expires_at: string
  clubs: { id: string; name: string } | null
  users: { email: string } | null
}

export default function AdminVerificationsPage() {
  const [requests, setRequests] = useState<VerifRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionNote, setActionNote] = useState<Record<string, string>>({})
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/admin/verifications')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setRequests(d.data ?? [])
        setLoading(false)
      })
  }, [])

  async function act(id: string, action: string) {
    setActing(id + action)
    const res = await apiFetch(`/api/admin/verifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, admin_note: actionNote[id] ?? '' }),
    })
    const data = await res.json()
    if (data.data) {
      setRequests(prev =>
        ['approved', 'rejected'].includes(data.data.status)
          ? prev.filter(r => r.id !== id)
          : prev.map(r => r.id === id ? { ...r, ...data.data } : r)
      )
    }
    setActing(null)
  }

  const statusLabel: Record<string, string> = {
    pending_instagram: 'Awaiting Instagram',
    pending_maps: 'Needs Maps',
    pending_review: 'Ready to Review',
  }

  const statusColor: Record<string, string> = {
    pending_instagram: 'chip-default',
    pending_maps: 'bg-yellow-500/20 text-yellow-300 rounded-full px-sm py-[2px] font-label-sm text-label-sm uppercase tracking-widest',
    pending_review: 'chip-live',
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">manage_accounts</span>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center py-32 px-container-padding text-center">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 mb-md">lock</span>
      <p className="font-h2 text-h2 text-on-surface">Access denied</p>
      <p className="font-body-md text-on-surface-variant mt-xs">{error}</p>
    </div>
  )

  return (
    <div className="px-container-padding pt-md pb-xl space-y-gutter">
      <div>
        <h1 className="font-h1 text-h1 text-primary uppercase tracking-[0.1em]">Verifications</h1>
        <p className="font-body-md text-on-surface-variant">{requests.length} pending</p>
      </div>

      {requests.length === 0 && (
        <div className="text-center py-xl">
          <span className="material-symbols-outlined text-[48px] text-primary block mb-sm"
            style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
          <p className="font-h2 text-h2 text-on-surface">All clear</p>
          <p className="font-body-md text-on-surface-variant mt-xs">No pending requests</p>
        </div>
      )}

      {requests.map(r => (
        <div key={r.id} className="glass-card p-md rounded-xl border border-outline-variant/20 space-y-sm">

          {/* Title row */}
          <div className="flex items-start justify-between gap-sm">
            <div className="flex-1">
              <p className="font-h2 text-h2 text-on-surface">{r.club_name}</p>
              <p className="font-body-md text-on-surface-variant text-sm">{r.users?.email}</p>
            </div>
            <span className={statusColor[r.status]}>{statusLabel[r.status]}</span>
          </div>

          {/* Type badge */}
          <span className={r.club_id ? 'chip-live' : 'chip-default'}>
            {r.club_id ? 'Claiming existing' : 'New club'}
          </span>

          {/* Details */}
          <div className="space-y-xs text-sm">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">photo_camera</span>
              <a href={`https://instagram.com/${r.instagram_handle}`} target="_blank" rel="noopener"
                className="font-body-md text-primary">@{r.instagram_handle}</a>
              {r.instagram_verified_at
                ? <span className="material-symbols-outlined text-[14px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                : <span className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase">(unverified)</span>}
            </div>
            {r.address && (
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant/60">location_on</span>
                <span className="font-body-md text-on-surface-variant">{r.address}{r.city ? `, ${r.city}` : ''}</span>
              </div>
            )}
            {r.google_maps_url && (
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant/60">map</span>
                <a href={r.google_maps_url} target="_blank" rel="noopener"
                  className="font-body-md text-primary underline truncate max-w-[220px]">View on Maps</a>
                {r.maps_verified_at
                  ? <span className="material-symbols-outlined text-[14px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  : null}
              </div>
            )}
            {!r.google_maps_url && !r.club_id && (
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-[16px] text-yellow-400">warning</span>
                <span className="font-body-md text-yellow-400">No Maps link yet</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant/50">
                  — expires {new Date(r.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            )}
            {r.website_url && (
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant/60">language</span>
                <a href={r.website_url} target="_blank" rel="noopener" className="font-body-md text-primary truncate max-w-[220px]">
                  {r.website_url.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
          </div>

          {/* Verification code */}
          <div className="bg-surface-container rounded-xl px-sm py-xs flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Code</span>
            <span className="font-body-md text-primary font-bold tracking-widest">{r.verification_code}</span>
          </div>

          {/* Admin note */}
          <input
            value={actionNote[r.id] ?? ''}
            onChange={e => setActionNote(n => ({ ...n, [r.id]: e.target.value }))}
            className="vibe-input w-full text-sm"
            placeholder="Note (optional, shown to user on reject)"
          />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-sm">
            {r.status === 'pending_instagram' && !r.instagram_verified_at && (
              <button onClick={() => act(r.id, 'verify_instagram')} disabled={acting === r.id + 'verify_instagram'}
                className="col-span-2 h-10 bg-primary-container/20 border border-primary/30 text-primary font-h2 rounded-xl active:scale-95 disabled:opacity-50">
                {acting === r.id + 'verify_instagram' ? 'Saving…' : '✓ Instagram verified'}
              </button>
            )}
            {r.status === 'pending_maps' && r.google_maps_url && !r.maps_verified_at && (
              <button onClick={() => act(r.id, 'verify_maps')} disabled={acting === r.id + 'verify_maps'}
                className="col-span-2 h-10 bg-yellow-500/10 border border-yellow-400/30 text-yellow-300 font-h2 rounded-xl active:scale-95 disabled:opacity-50">
                {acting === r.id + 'verify_maps' ? 'Saving…' : '✓ Maps verified'}
              </button>
            )}
            {r.status === 'pending_review' && (
              <>
                <button onClick={() => act(r.id, 'approve')} disabled={!!acting}
                  className="h-11 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95 disabled:opacity-50">
                  {acting === r.id + 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button onClick={() => act(r.id, 'reject')} disabled={!!acting}
                  className="h-11 border border-error/30 text-error font-h2 rounded-xl active:scale-95 disabled:opacity-50">
                  {acting === r.id + 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </>
            )}
            {/* Always allow reject from any pending state */}
            {r.status !== 'pending_review' && (
              <button onClick={() => act(r.id, 'reject')} disabled={!!acting}
                className="col-span-2 h-9 text-on-surface-variant/50 font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
                Reject request
              </button>
            )}
          </div>

          <p className="font-label-sm text-label-sm text-on-surface-variant/40 text-center">
            Submitted {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      ))}
    </div>
  )
}
