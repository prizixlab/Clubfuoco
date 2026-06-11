'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Design tokens (match signup / login) ────────────────────────────────────
const C = {
  cream: '#F8F5EE',
  ink:   '#221E1A',
  stone: '#6E6356',
  sand:  '#9F9486',
  red:   '#8C2A2A',
  white: '#FFFFFF',
}

const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_IT = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre']
const currentYear = new Date().getFullYear()
const DAYS  = Array.from({ length: 31 }, (_, i) => i + 1)
const YEARS = Array.from({ length: 84 }, (_, i) => currentYear - 17 - i)

const HOME: Record<string, string> = { user: '/explore', club: '/club-dashboard', dj: '/dj-dashboard' }

type Missing = { name: boolean; email: boolean; phone: boolean; birthday: boolean }

export default function CompleteProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [ready,     setReady]     = useState(false)
  const [missing,   setMissing]   = useState<Missing>({ name: false, email: false, phone: false, birthday: false })
  const [accountType, setAccountType] = useState<string>('user')

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [phone,     setPhone]     = useState('')
  const [bDay,      setBDay]       = useState(String(DAYS[16]))
  const [bMonth,    setBMonth]     = useState(String(5))
  const [bYear,     setBYear]      = useState(String(currentYear - 25))

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // Load the current profile and work out what's missing.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      const { data: row } = await (supabase as any)
        .from('users')
        .select('full_name, email, phone, birthday, account_type')
        .eq('id', user.id)
        .single()

      if (cancelled) return

      const m: Missing = {
        name:     !row?.full_name,
        email:    !row?.email,
        phone:    !row?.phone,
        birthday: !row?.birthday,
      }
      setAccountType(row?.account_type ?? 'user')

      // Nothing missing — straight through to home.
      if (!m.name && !m.email && !m.phone && !m.birthday) {
        router.replace(HOME[row?.account_type ?? 'user'] ?? '/explore')
        return
      }

      // Prefill name if we have part of it
      if (row?.full_name) {
        const parts = String(row.full_name).trim().split(/\s+/)
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
      }
      if (row?.email) setEmail(row.email)

      setMissing(m)
      setReady(true)
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const update: Record<string, any> = {}

    if (missing.name) {
      const full = `${firstName} ${lastName}`.trim()
      if (!full) { setError('Please enter your name.'); return }
      update.full_name = full
    }
    if (missing.email) {
      if (!email.trim()) { setError('Please enter your email.'); return }
      update.email = email.trim()
    }
    if (missing.phone) {
      if (!phone.trim()) { setError('Please enter your phone number.'); return }
      update.phone = phone.trim()
    }
    if (missing.birthday) {
      // Club Fuoco is strictly 18+.
      const today = new Date()
      let age = today.getFullYear() - Number(bYear)
      const m = today.getMonth() + 1
      if (m < Number(bMonth) || (m === Number(bMonth) && today.getDate() < Number(bDay))) age--
      if (age < 18) { setError('You must be 18 or older to use Club Fuoco.'); return }
      update.birthday = `${bYear}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`
    }

    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }

    const { error: upErr } = await (supabase as any).from('users').update(update).eq('id', user.id)
    if (upErr) {
      setError(upErr.message.includes('18') ? 'You must be 18 or older to use Club Fuoco.' : upErr.message)
      setLoading(false)
      return
    }

    router.replace(HOME[accountType] ?? '/explore')
  }

  if (!ready) {
    return <div style={{ position: 'fixed', inset: 0, background: C.cream }} />
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.cream, overflowY: 'auto' } as React.CSSProperties}>
      <div style={{ padding: '28px 24px 40px', maxWidth: 480, margin: '0 auto' }}>
        {/* Kicker */}
        <p style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
          textTransform: 'uppercase', margin: '0 0 16px',
        }}>
          N° 01 · Quasi fatto
        </p>

        {/* Headline */}
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 44, fontWeight: 400, lineHeight: 1.05,
          letterSpacing: '-1.04px', color: C.ink, margin: '0 0 12px',
        }}>
          <em>Almost</em> there
        </h1>

        {/* Sub */}
        <p style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 14, color: C.stone, letterSpacing: '-0.07px',
          lineHeight: 1.5, margin: '0 0 32px',
        }}>
          Sorry — we didn&apos;t get everything we need from your sign-in. Just fill in
          the last details and you&apos;re in.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Name */}
          {missing.name && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="First name">
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder="Marco" required style={inputStyle} />
              </Field>
              <Field label="Last name">
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder="Bernardi" required style={inputStyle} />
              </Field>
            </div>
          )}

          {/* Email */}
          {missing.email && (
            <Field label="Email">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@fuoco.club" required style={inputStyle} />
            </Field>
          )}

          {/* Phone */}
          {missing.phone && (
            <Field label="Phone">
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+34 612 345 678" required style={inputStyle} />
            </Field>
          )}

          {/* Birthday */}
          {missing.birthday && (
            <div>
              <p style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 9, color: C.sand, letterSpacing: '1.8px',
                textTransform: 'uppercase', margin: '0 0 8px',
              }}>
                Birthday · 18+
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <DrumPicker label="Day"   values={DAYS} selected={bDay} onSelect={setBDay} />
                <DrumPicker label="Month" values={Array.from({ length: 12 }, (_, i) => i + 1)} labels={MONTHS_EN} selected={bMonth} onSelect={setBMonth} />
                <DrumPicker label="Year"  values={YEARS} selected={bYear} onSelect={setBYear} />
              </div>
              <p style={{
                textAlign: 'center', marginTop: 12,
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 16, fontStyle: 'italic', color: C.red,
              }}>
                {bDay} {MONTHS_IT[parseInt(bMonth) - 1]} {bYear}
              </p>
            </div>
          )}

          {error && (
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 12, color: C.red, margin: 0, lineHeight: 1.4,
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', height: 55, marginTop: 8,
              background: loading ? 'rgba(140,42,42,0.6)' : C.red,
              color: C.cream, borderRadius: 14, border: 'none',
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {loading ? 'Saving…' : (
              <>
                Enter Club Fuoco
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Field wrapper ────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none', outline: 'none',
  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
  fontSize: 16, color: C.ink, padding: '14px 0', lineHeight: '1.3', flex: 1,
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <p style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: C.sand, letterSpacing: '1.8px',
        textTransform: 'uppercase', margin: 0,
      }}>
        {label}
      </p>
      <div style={{
        background: C.white, border: '1px solid rgba(34,30,26,0.08)',
        borderRadius: 12, padding: '0 16px',
        display: 'flex', alignItems: 'center',
      }}>
        {children}
      </div>
    </div>
  )
}

// ── DrumPicker — iOS-style scroll-snap picker (mirrors signup) ────────────────
const ITEM_H = 40
function DrumPicker({
  values, labels, selected, onSelect, label,
}: {
  values: (string | number)[]
  labels?: string[]
  selected: string
  onSelect: (v: string) => void
  label: string
}) {
  const items = values.map((v, i) => ({ value: String(v), label: labels?.[i] ?? String(v) }))
  const scrollRef = useRef<HTMLDivElement>(null)
  const [localIdx, setLocalIdx] = useState(() => Math.max(0, items.findIndex(i => i.value === selected)))
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const idx = items.findIndex(i => i.value === selected)
    if (idx >= 0) {
      setLocalIdx(idx)
      if (scrollRef.current) scrollRef.current.scrollTop = idx * ITEM_H
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const onScroll = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!scrollRef.current) return
      const idx = Math.round(scrollRef.current.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(idx, items.length - 1))
      setLocalIdx(clamped)
      onSelect(items[clamped].value)
    }, 80)
  }, [items, onSelect])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <p style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: C.sand, letterSpacing: '1.8px',
        textTransform: 'uppercase', textAlign: 'center', margin: 0,
      }}>
        {label}
      </p>
      <div style={{
        position: 'relative', background: C.white, borderRadius: 12,
        overflow: 'hidden', border: '1px solid rgba(34,30,26,0.08)', height: ITEM_H * 5,
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 2.2, background: 'linear-gradient(to bottom, rgba(255,255,255,1) 40%, rgba(255,255,255,0))', zIndex: 2, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 2.2, background: 'linear-gradient(to top, rgba(255,255,255,1) 40%, rgba(255,255,255,0))', zIndex: 2, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: ITEM_H * 2, left: 0, right: 0, height: 1, background: 'rgba(34,30,26,0.16)', zIndex: 3, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: ITEM_H * 3, left: 0, right: 0, height: 1, background: 'rgba(34,30,26,0.16)', zIndex: 3, pointerEvents: 'none' }} />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{
            height: '100%', overflowY: 'scroll', scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none',
          } as React.CSSProperties}
        >
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
          {items.map((item, i) => {
            const dist = Math.abs(i - localIdx)
            const isSel = dist === 0
            return (
              <div
                key={item.value}
                onClick={() => { onSelect(item.value); scrollRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' }) }}
                style={{
                  height: ITEM_H, scrollSnapAlign: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: '"Instrument Serif", Georgia, serif',
                  fontSize: isSel ? 26 : 20, fontStyle: isSel ? 'italic' : 'normal',
                  color: isSel ? C.red : C.ink,
                  opacity: dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25,
                  userSelect: 'none', cursor: 'pointer', transition: 'font-size 0.12s, color 0.12s',
                }}
              >
                {item.label}
              </div>
            )
          })}
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  )
}
