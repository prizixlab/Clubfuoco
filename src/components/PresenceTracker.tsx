'use client'
import { apiFetch } from '@/lib/api'
import { useEffect, useState } from 'react'

/*
 * Passive venue-presence tracking.
 *
 *  • On app-open, sends the device location to /api/signals/geo. If the device
 *    is inside a venue's radius, the server logs a geo_presence signal.
 *  • Fetches any unanswered signals (Maps/Uber taps + geo presence) and asks
 *    "Were you at X?" — the answer becomes a verified (or denied) visit.
 *
 * Mounted once, app-wide, from the (app) layout.
 */

interface Pending { club_id: string; name: string; kind: string }

const KIND_REASON: Record<string, string> = {
  geo_presence: 'Your phone was there',
  uber_click:   'You booked a ride there',
  maps_click:   'You got directions there',
}

export default function PresenceTracker() {
  const [pending, setPending] = useState<Pending[]>([])
  const [busy,    setBusy]    = useState(false)

  // ── App-open location → presence signal ──────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        apiFetch('/api/signals/geo', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        }).catch(() => {})
      },
      () => {},
      { timeout: 8000, enableHighAccuracy: false },
    )
  }, [])

  // ── Load pending "Were you at X?" prompts ────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch('/api/signals')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (Array.isArray(d?.data)) setPending(d.data) })
        .catch(() => {})
    }, 1500)  // let the geo signal land first
    return () => clearTimeout(t)
  }, [])

  const current = pending[0]
  if (!current) return null

  async function answer(confirmed: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await apiFetch('/api/signals', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ club_id: current.club_id, confirmed }),
      })
    } catch { /* keep going regardless */ }
    setPending(p => p.slice(1))
    setBusy(false)
  }

  function dismiss() { setPending(p => p.slice(1)) }

  return (
    <div style={{
      position: 'fixed', left: 16, right: 16, zIndex: 60,
      bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
      background: '#1F1B16', color: '#F8F5EE',
      borderRadius: 18, padding: '18px 18px 16px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
    }}>
      <p style={{
        margin: '0 0 4px', fontFamily: 'ui-monospace, monospace',
        fontSize: 9, letterSpacing: '1.8px', textTransform: 'uppercase',
        color: 'rgba(248,245,238,0.45)',
      }}>
        {KIND_REASON[current.kind] ?? 'Recent activity'}
      </p>
      <p style={{
        margin: '0 0 14px',
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 22, fontStyle: 'italic',
      }}>
        Were you at {current.name}?
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => answer(true)} disabled={busy}
          style={{
            flex: 2, height: 44, borderRadius: 11, border: 'none',
            background: '#F3EEE0', color: '#1F1B16',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
          Yes, I went
        </button>
        <button
          onClick={() => answer(false)} disabled={busy}
          style={{
            flex: 1, height: 44, borderRadius: 11,
            border: '1px solid rgba(248,245,238,0.18)',
            background: 'transparent', color: 'rgba(248,245,238,0.8)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
          No
        </button>
      </div>
      <button
        onClick={dismiss} disabled={busy}
        style={{
          width: '100%', marginTop: 8, padding: '6px 0',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'ui-monospace, monospace', fontSize: 9,
          letterSpacing: '1.4px', textTransform: 'uppercase',
          color: 'rgba(248,245,238,0.4)',
        }}>
        Ask me later
      </button>
    </div>
  )
}
