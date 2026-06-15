'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { normalizeInviteCode } from '@/lib/url'
import type { GroupDetail } from '@/types'

// ── Public invite landing — clubfuoco.com/join/CODE ──────────────────────────
// The ONLY app surface on the web. Logged-out visitors see a preview and sign
// in / create an account; once joined, this same page becomes a self-contained
// booking view (club, pass + wallet, calendar, who's coming). There is no
// navigation into the rest of the app — the night lives in the native app.

const C = {
  cream: '#F8F5EE', ink: '#221E1A', stone: '#6E6356',
  sand: '#9F9486', red: '#8C2A2A', white: '#FFFFFF', line: 'rgba(34,30,26,0.10)',
  green: '#2D7A46',
}

type Preview = {
  club_name: string | null
  cover_image_url: string | null
  booking_date: string
  booking_type: 'general' | 'vip'
  status: string
  is_free: boolean
  going_count: number
  organizer_first: string | null
}

type Phase = 'loading' | 'preview' | 'joining' | 'joined' | 'error'

export default function JoinByCode() {
  const params = useParams<{ code: string }>()
  const code = normalizeInviteCode(params?.code)

  const [phase, setPhase]     = useState<Phase>('loading')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [detail, setDetail]   = useState<GroupDetail | null>(null)
  const [authed, setAuthed]   = useState(false)
  const [error, setError]     = useState('')
  const [qrUrl, setQrUrl]     = useState<string | null>(null)
  const [calMsg, setCalMsg]   = useState('')

  const nextPath = `/join/${code ?? ''}`

  // Load: public preview always; if signed in, also resolve the full detail and
  // jump straight to the booking view when already a member.
  useEffect(() => {
    let cancelled = false
    if (!code) { setError('This invite link is invalid.'); setPhase('error'); return }

    ;(async () => {
      try {
        const [previewRes, { data: { session } }] = await Promise.all([
          apiFetch(`/api/groups/preview/${code}`),
          createClient().auth.getSession(),
        ])
        if (cancelled) return
        setAuthed(!!session)

        const body = await previewRes.json().catch(() => null)
        if (!previewRes.ok || !body?.data) {
          setError(body?.error ?? 'This invite isn’t available anymore.'); setPhase('error'); return
        }
        setPreview(body.data as Preview)

        if (session) {
          const d = await fetchDetail()
          if (cancelled) return
          // Already part of this group (joined or the host) → show the booking.
          if (d?.me && d.me.rsvp !== 'declined') { setDetail(d); setPhase('joined'); return }
          if (d) setDetail(d)
        }
        setPhase('preview')
      } catch {
        if (!cancelled) { setError('Could not open this invite.'); setPhase('error') }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function fetchDetail(): Promise<GroupDetail | null> {
    const res = await apiFetch(`/api/groups/code/${code}`)
    const body = await res.json().catch(() => null)
    return res.ok ? (body?.data as GroupDetail) : null
  }

  // Render the pass QR client-side from the viewer's own token.
  useEffect(() => {
    const token = detail?.me?.qr_token
    if (phase === 'joined' && token) {
      QRCode.toDataURL(token, { margin: 1, width: 460 }).then(setQrUrl).catch(() => setQrUrl(null))
    }
  }, [phase, detail])

  const join = useCallback(async () => {
    if (!code) return
    setPhase('joining')
    try {
      const d0 = await fetchDetail()
      if (!d0?.id) { setError('This invite isn’t available anymore.'); setPhase('error'); return }
      const joinRes = await apiFetch(`/api/groups/${d0.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join' }),
      })
      const joinBody = await joinRes.json().catch(() => null)
      if (!joinRes.ok) { setError(joinBody?.error ?? 'Could not join this night.'); setPhase('error'); return }
      const d1 = await fetchDetail()   // refreshed with my membership + pass
      setDetail(d1 ?? d0)
      setPhase('joined')
    } catch {
      setError('Could not join this night.'); setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  function addToCalendar() {
    if (!detail) return
    const [y, m, d] = detail.booking_date.split('-').map(Number)
    const start = new Date(y, m - 1, d, 23, 0, 0)
    const end = new Date(start.getTime() + 4 * 3600 * 1000)
    const fmt = (dt: Date) =>
      `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Club Fuoco//EN', 'BEGIN:VEVENT',
      `UID:${detail.id}@clubfuoco.com`,
      `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:Night at ${detail.club_name}`,
      `LOCATION:${detail.club_name}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'club-fuoco.ics'; a.click()
    URL.revokeObjectURL(url)
    setCalMsg('Calendar file downloaded.')
  }

  const goingCount = detail ? detail.members.filter(mb => mb.rsvp === 'going').length : 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.cream, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 460, padding: '28px 22px 56px' }}>
        <p style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: C.red, letterSpacing: '2.1px', textTransform: 'uppercase', margin: '0 0 22px' }}>
          Club Fuoco · {phase === 'joined' ? 'You’re on the list' : 'You’re invited'}
        </p>

        {phase === 'loading' && <Skeleton />}

        {phase === 'error' && (
          <Card>
            <p style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 26, color: C.ink, margin: '0 0 8px' }}>Hmm.</p>
            <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, color: C.stone, margin: 0 }}>{error}</p>
          </Card>
        )}

        {/* ── Preview / join CTA (not yet joined) ── */}
        {(phase === 'preview' || phase === 'joining') && preview && (
          <>
            <Hero image={preview.cover_image_url} name={preview.club_name}
              badge={preview.is_free ? 'Free guestlist' : preview.booking_type === 'vip' ? 'VIP table' : 'Entry'}
              badgeGreen={preview.is_free} />
            <div style={{ marginTop: 18, marginBottom: 8 }}>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, color: C.ink, fontWeight: 500, margin: '0 0 4px' }}>{formatDate(preview.booking_date)}</p>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13.5, color: C.stone, margin: 0 }}>
                {preview.organizer_first ? <><strong style={{ color: C.ink, fontWeight: 600 }}>{preview.organizer_first}</strong> invited you · </> : null}
                {preview.going_count} going
              </p>
            </div>
            <div style={{ marginTop: 22 }}>
              {!authed ? (
                <>
                  <PrimaryLink href={`/login?next=${encodeURIComponent(nextPath)}`} label="Sign in to join" />
                  <SecondaryLink href={`/signup?next=${encodeURIComponent(nextPath)}`} label="Create an account" />
                  <p style={{ textAlign: 'center', fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, color: C.sand, letterSpacing: '1.4px', textTransform: 'uppercase', marginTop: 16 }}>
                    Continue with Google · Apple · Email
                  </p>
                </>
              ) : preview.status !== 'open' ? (
                <Notice text="This night is no longer open." />
              ) : (
                <PrimaryButton onClick={join} loading={phase === 'joining'} label="Join this night" />
              )}
            </div>
          </>
        )}

        {/* ── Joined: full booking view ── */}
        {phase === 'joined' && detail && (
          <>
            <Hero image={detail.club_image} name={detail.club_name} badge="You’re going" badgeGreen />

            <div style={{ marginTop: 18 }}>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, color: C.ink, fontWeight: 500, margin: '0 0 2px' }}>{formatDate(detail.booking_date)}</p>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13, color: C.stone, margin: 0 }}>
                {detail.booking_type === 'vip' ? 'VIP table' : 'Guestlist'} · {goingCount} going · Doors 23:00
              </p>
            </div>

            {/* Pass */}
            {detail.me?.qr_token && (
              <div style={{ marginTop: 18, background: C.white, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, letterSpacing: '1.6px', textTransform: 'uppercase', color: C.sand, margin: '0 0 12px' }}>Your pass · show at the door</p>
                {qrUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={qrUrl} alt="Entry QR code" style={{ width: 200, height: 200 }} />
                  : <div style={{ width: 200, height: 200, margin: '0 auto', background: '#ECE5D6', borderRadius: 8 }} />}
                <p style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 12, letterSpacing: '1px', color: C.stone, margin: '12px 0 0' }}>{detail.me.qr_token}</p>
              </div>
            )}

            {/* Wallet + Calendar */}
            <div style={{ marginTop: 12 }}>
              {detail.me?.booking_id && (
                <a href={`/api/bookings/${detail.me.booking_id}/wallet`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 50, background: C.ink, color: C.cream, borderRadius: 12, textDecoration: 'none', fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, fontWeight: 600 }}>
                  Add to Apple Wallet
                </a>
              )}
              <button onClick={addToCalendar}
                style={{ width: '100%', height: 50, marginTop: 10, background: 'transparent', color: C.ink, border: `1px solid ${C.line}`, borderRadius: 12, fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Add to calendar
              </button>
              {calMsg && <p style={{ textAlign: 'center', fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 11, color: C.stone, marginTop: 8 }}>{calMsg}</p>}
            </div>

            {/* Who's coming */}
            <div style={{ marginTop: 24 }}>
              <p style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, letterSpacing: '1.6px', textTransform: 'uppercase', color: C.sand, margin: '0 0 12px' }}>Who’s coming · {goingCount}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.members.filter(mb => mb.rsvp === 'going').map(mb => (
                  <div key={mb.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar name={mb.full_name} url={mb.avatar_url} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, fontWeight: 500, color: C.ink, margin: 0 }}>
                        {mb.full_name ?? 'Guest'}{mb.is_me ? ' (you)' : ''}
                      </p>
                    </div>
                    {mb.role === 'organizer' && (
                      <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 8, letterSpacing: '1.2px', textTransform: 'uppercase', color: C.red, background: 'rgba(140,42,42,0.08)', padding: '3px 8px', borderRadius: 99 }}>Host</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 12, color: C.sand, textAlign: 'center', marginTop: 28, lineHeight: 1.5 }}>
              Everything’s saved. Open the Club Fuoco app on your phone for live updates on the night.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── bits ─────────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Hero({ image, name, badge, badgeGreen }: { image: string | null; name: string | null; badge: string; badgeGreen?: boolean }) {
  return (
    <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', height: 220, background: '#2A1F1A', boxShadow: '0 12px 30px rgba(34,30,26,0.12)' }}>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.72))' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
        <span style={{ display: 'inline-block', fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#FFFFFF', background: badgeGreen ? 'rgba(45,122,70,0.92)' : 'rgba(0,0,0,0.45)', padding: '3px 9px', borderRadius: 99, marginBottom: 8 }}>{badge}</span>
        <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 34, lineHeight: 1.05, color: '#FFFFFF', margin: 0 }}>{name ?? 'A night out'}</h1>
      </div>
    </div>
  )
}

function Avatar({ name, url }: { name: string | null; url: string | null }) {
  const initials = (name ?? '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name ?? ''} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return (
    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(140,42,42,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 16, color: C.red }}>{initials}</div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22 }}>{children}</div>
}

function Skeleton() {
  return (
    <div>
      <div style={{ height: 220, borderRadius: 18, background: '#ECE5D6' }} />
      <div style={{ height: 16, width: 180, borderRadius: 6, background: '#ECE5D6', marginTop: 18 }} />
      <div style={{ height: 13, width: 130, borderRadius: 6, background: '#ECE5D6', marginTop: 10 }} />
      <div style={{ height: 55, borderRadius: 14, background: '#ECE5D6', marginTop: 24 }} />
    </div>
  )
}

function PrimaryButton({ onClick, label, loading }: { onClick: () => void; label: string; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ width: '100%', height: 55, background: loading ? 'rgba(140,42,42,0.6)' : C.red, color: C.cream, borderRadius: 14, border: 'none', fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, fontWeight: 500, cursor: loading ? 'default' : 'pointer' }}>
      {loading ? 'Joining…' : label}
    </button>
  )
}

function PrimaryLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 55, background: C.red, color: C.cream, borderRadius: 14, fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>{label}</a>
  )
}

function SecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 52, marginTop: 12, background: 'transparent', color: C.ink, border: `1px solid ${C.line}`, borderRadius: 14, fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>{label}</a>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px' }}>
      <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13.5, color: C.stone, margin: 0, lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}
