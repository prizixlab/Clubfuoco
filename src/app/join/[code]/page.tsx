'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { normalizeInviteCode } from '@/lib/url'

// ── Public invite landing — clubfuoco.com/join/CODE ──────────────────────────
// A logged-out person sees a preview (club, date, headcount, organizer). To
// join they sign in / create an account (Google · Apple · email); after auth
// they return here and join. This is the ONLY app surface on the web — there is
// deliberately no navigation into the rest of the app; joining ends on a
// self-contained confirmation that points to the native app.

const C = {
  cream: '#F8F5EE', ink: '#221E1A', stone: '#6E6356',
  sand: '#9F9486', red: '#8C2A2A', white: '#FFFFFF', line: 'rgba(34,30,26,0.10)',
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

  const [phase, setPhase]   = useState<Phase>('loading')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [authed, setAuthed]   = useState(false)
  const [error, setError]     = useState('')

  const nextPath = `/join/${code ?? ''}`

  // Load the public preview + current auth state.
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
          setError(body?.error ?? 'This invite isn’t available anymore.')
          setPhase('error')
          return
        }
        setPreview(body.data as Preview)
        setPhase('preview')
      } catch {
        if (!cancelled) { setError('Could not open this invite.'); setPhase('error') }
      }
    })()

    return () => { cancelled = true }
  }, [code])

  // Authenticated join: resolve the code → group, RSVP, then open the group.
  const join = useCallback(async () => {
    if (!code) return
    setPhase('joining')
    try {
      const resolveRes = await apiFetch(`/api/groups/code/${code}`)
      const resolved = await resolveRes.json().catch(() => null)
      const id = resolved?.data?.id
      if (!resolveRes.ok || !id) {
        setError(resolved?.error ?? 'This invite isn’t available anymore.')
        setPhase('error'); return
      }
      const joinRes = await apiFetch(`/api/groups/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join' }),
      })
      const joinBody = await joinRes.json().catch(() => null)
      if (!joinRes.ok) {
        setError(joinBody?.error ?? 'Could not join this night.')
        setPhase('error'); return
      }
      // Terminal — do NOT navigate into the web app. The night lives in the
      // native app from here.
      setPhase('joined')
    } catch {
      setError('Could not join this night.'); setPhase('error')
    }
  }, [code])

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.cream, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440, padding: '28px 22px 48px' }}>
        {/* Brand line */}
        <p style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: C.red, letterSpacing: '2.1px', textTransform: 'uppercase', margin: '0 0 22px' }}>
          Club Fuoco · You’re invited
        </p>

        {phase === 'loading' && <Skeleton />}

        {phase === 'error' && (
          <Card>
            <p style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 26, color: C.ink, margin: '0 0 8px' }}>Hmm.</p>
            <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, color: C.stone, margin: 0 }}>{error}</p>
          </Card>
        )}

        {phase === 'joined' && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(45,122,70,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5 11-11" stroke="#2D7A46" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </div>
            <p style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 30, color: C.ink, margin: '0 0 8px', textAlign: 'center' }}>
              You’re in{preview?.club_name ? ` — ${preview.club_name}` : ''}
            </p>
            <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, color: C.stone, margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
              You’re on the list. Open the Club Fuoco app on your phone to see the night, your pass, and who’s going.
            </p>
          </Card>
        )}

        {(phase === 'preview' || phase === 'joining') && preview && (
          <>
            {/* Hero */}
            <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', height: 220, background: '#2A1F1A', boxShadow: '0 12px 30px rgba(34,30,26,0.12)' }}>
              {preview.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.cover_image_url} alt={preview.club_name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.72))' }} />
              <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
                <span style={{ display: 'inline-block', fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: C.white, background: preview.is_free ? 'rgba(45,122,70,0.92)' : 'rgba(0,0,0,0.45)', padding: '3px 9px', borderRadius: 99, marginBottom: 8 }}>
                  {preview.is_free ? 'Free guestlist' : preview.booking_type === 'vip' ? 'VIP table' : 'Entry'}
                </span>
                <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 34, lineHeight: 1.05, color: C.white, margin: 0 }}>
                  {preview.club_name ?? 'A night out'}
                </h1>
              </div>
            </div>

            {/* Facts */}
            <div style={{ marginTop: 18, marginBottom: 8 }}>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, color: C.ink, fontWeight: 500, margin: '0 0 4px' }}>
                {formatDate(preview.booking_date)}
              </p>
              <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13.5, color: C.stone, margin: 0 }}>
                {preview.organizer_first ? <><strong style={{ color: C.ink, fontWeight: 600 }}>{preview.organizer_first}</strong> invited you · </> : null}
                {preview.going_count} going
              </p>
            </div>

            {/* Actions */}
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
                // The host covers the group, so guests join free — no payment.
                <PrimaryButton onClick={join} loading={phase === 'joining'} label="Join this night" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── bits ─────────────────────────────────────────────────────────────────────

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
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
    <a href={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 55, background: C.red, color: C.cream, borderRadius: 14, fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 15, fontWeight: 500, textDecoration: 'none' }}>
      {label}
    </a>
  )
}

function SecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 52, marginTop: 12, background: 'transparent', color: C.ink, border: `1px solid ${C.line}`, borderRadius: 14, fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
      {label}
    </a>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px' }}>
      <p style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13.5, color: C.stone, margin: 0, lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}
