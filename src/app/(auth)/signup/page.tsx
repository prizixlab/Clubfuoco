'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Design tokens
const C = {
  cream:  '#F8F5EE',
  ink:    '#221E1A',
  stone:  '#6E6356',
  sand:   '#9F9486',
  red:    '#8C2A2A',
  white:  '#FFFFFF',
  warm:   'rgb(244,236,221)',
}

type AccountType = 'user' | 'club' | 'dj'

const HOME: Record<AccountType, string> = {
  user: '/explore',
  club: '/club-dashboard',
  dj:   '/dj-dashboard',
}

// Months for birthday drum
const MONTHS_EN  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_IT  = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre']
const currentYear = new Date().getFullYear()
const DAYS  = Array.from({ length: 31 },  (_, i) => i + 1)
const YEARS = Array.from({ length: 84 },  (_, i) => currentYear - 17 - i)

// ─────────────────────────────────────────────────────────────────────────────
// DrumPicker — iOS-style scroll snap picker
// ─────────────────────────────────────────────────────────────────────────────
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

  // Scroll to selection on mount / external change
  useEffect(() => {
    const idx = items.findIndex(i => i.value === selected)
    if (idx >= 0) {
      setLocalIdx(idx)
      if (scrollRef.current) {
        scrollRef.current.scrollTop = idx * ITEM_H
      }
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
        textTransform: 'uppercase' as const, textAlign: 'center', margin: 0,
      }}>
        {label}
      </p>

      <div style={{
        position: 'relative', background: C.white, borderRadius: 12,
        overflow: 'hidden', border: '1px solid rgba(34,30,26,0.08)',
        height: ITEM_H * 5,
      }}>
        {/* Fade top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 2.2,
          background: 'linear-gradient(to bottom, rgba(255,255,255,1) 40%, rgba(255,255,255,0))',
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Fade bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 2.2,
          background: 'linear-gradient(to top, rgba(255,255,255,1) 40%, rgba(255,255,255,0))',
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Top band */}
        <div style={{
          position: 'absolute', top: ITEM_H * 2, left: 0, right: 0,
          height: 1, background: 'rgba(34,30,26,0.16)', zIndex: 3, pointerEvents: 'none',
        }} />
        {/* Bottom band */}
        <div style={{
          position: 'absolute', top: ITEM_H * 3, left: 0, right: 0,
          height: 1, background: 'rgba(34,30,26,0.16)', zIndex: 3, pointerEvents: 'none',
        }} />

        {/* Scroll list */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="drum-scroll"
          style={{
            height: '100%',
            overflowY: 'scroll',
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}
        >
          {/* top spacer */}
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
          {items.map((item, i) => {
            const dist = Math.abs(i - localIdx)
            const isSel = dist === 0
            return (
              <div
                key={item.value}
                style={{
                  height: ITEM_H, scrollSnapAlign: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: '"Instrument Serif", Georgia, serif',
                  fontSize: isSel ? 26 : 20,
                  fontStyle: isSel ? 'italic' : 'normal',
                  color: isSel ? C.red : C.ink,
                  opacity: dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25,
                  letterSpacing: '-0.07px',
                  userSelect: 'none',
                  cursor: 'pointer',
                  transition: 'font-size 0.12s, color 0.12s',
                }}
                onClick={() => {
                  onSelect(item.value)
                  scrollRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
                }}
              >
                {item.label}
              </div>
            )
          })}
          {/* bottom spacer */}
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: AuthField wrapper
// ─────────────────────────────────────────────────────────────────────────────
function AuthField({
  label, children, rightSlot, error,
}: {
  label: string, children: React.ReactNode,
  rightSlot?: React.ReactNode, error?: boolean,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: C.sand, letterSpacing: '1.8px',
        textTransform: 'uppercase' as const, margin: 0,
      }}>
        {label}
      </p>
      <div style={{
        background: error ? 'rgba(140,42,42,0.04)' : C.white,
        border: error ? '1px solid #8C2A2A' : '1px solid rgba(34,30,26,0.08)',
        borderRadius: 12, padding: '0 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        transition: 'border-color 0.2s',
      }}>
        {children}
        {rightSlot}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none', outline: 'none',
  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
  fontSize: 16, color: C.ink, padding: '14px 0', lineHeight: '1.3', flex: 1, // 16px minimum prevents iOS auto-zoom
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: Progress bar (4 segments)
// ─────────────────────────────────────────────────────────────────────────────
function ProgressBar({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1, height: 2, borderRadius: 1,
            background: i < step ? C.red : 'rgba(34,30,26,0.16)',
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: Primary CTA button
// ─────────────────────────────────────────────────────────────────────────────
function PrimaryBtn({
  children, onClick, disabled, type = 'button', loading,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  loading?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%', height: 55,
        background: disabled && !loading ? 'rgba(140,42,42,0.3)' : C.red,
        color: C.cream, borderRadius: 14, border: 'none',
        fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
        fontSize: 15, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'opacity 0.2s, background 0.2s',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? 'Please wait…' : (
        <>
          {children}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function SignupPage() {
  const router = useRouter()

  const [step,         setStep]        = useState<1 | 2 | 3 | 4>(2)
  const [accountType,  setAccountType] = useState<AccountType>('user')
  const [showRoleChooser, setShowRoleChooser] = useState(false)
  const [firstName,    setFirstName]   = useState('')
  const [lastName,     setLastName]    = useState('')
  const [email,        setEmail]       = useState('')
  const [password,     setPassword]    = useState('')
  const [showPwd,      setShowPwd]     = useState(false)
  const [tosAccepted,  setTosAccepted] = useState(false)
  const [bDay,         setBDay]        = useState(String(DAYS[16]))       // 17
  const [bMonth,       setBMonth]      = useState(String(5))              // May
  const [bYear,        setBYear]       = useState(String(currentYear - 25))
  const [userId,       setUserId]      = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'gold' | 'sapphire' | 'black'>('free')
  const [loading,      setLoading]     = useState(false)
  const [error,        setError]       = useState('')

  const supabase = createClient()

  // Account type labels
  const kindLabel: Record<AccountType, string> = {
    user: 'Notturno',
    club: 'Locale',
    dj:   'Artista',
  }
  const kindSubLabel: Record<AccountType, string> = {
    user: 'Night Out',
    club: 'Club / Venue',
    dj:   'DJ / Artist',
  }

  // ── Step 2: Create account
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!tosAccepted) {
      setError('Please accept the Terms of Use and Privacy Policy to continue.')
      return
    }

    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email, password,
      options: {
        data: {
          full_name: `${firstName} ${lastName}`.trim(),
          first_name: firstName,
          last_name:  lastName,
          account_type: accountType,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      await (supabase as any).from('users').update({ account_type: accountType }).eq('id', data.user.id)
      setUserId(data.user.id)
    }

    setLoading(false)
    if (accountType === 'user') {
      setStep(3)
    } else {
      router.push(HOME[accountType])
    }
  }

  // ── Step 3: Birthday — Club Fuoco is strictly 18+. ──────────────────────────
  async function handleBirthday(skip = false) {
    if (!skip && userId && bDay && bMonth && bYear) {
      const month = String(bMonth).padStart(2, '0')
      const day   = String(bDay).padStart(2, '0')

      // Age check. The DB also enforces this with a trigger, so a bypassed
      // client can't store an under-18 birthday — the update simply fails.
      const today = new Date()
      let age = today.getFullYear() - Number(bYear)
      const m = today.getMonth() + 1
      if (m < Number(bMonth) || (m === Number(bMonth) && today.getDate() < Number(bDay))) age--

      if (age < 18) {
        setError('You must be 18 or older to use Club Fuoco.')
        try { await supabase.auth.signOut() } catch { /* ignore */ }
        setUserId(null)
        setStep(2)
        return
      }

      const { error: upErr } = await (supabase as any)
        .from('users')
        .update({ birthday: `${bYear}-${month}-${day}` })
        .eq('id', userId)

      if (upErr) {
        // Server-side 18+ trigger rejected it.
        setError('You must be 18 or older to use Club Fuoco.')
        try { await supabase.auth.signOut() } catch { /* ignore */ }
        setUserId(null)
        setStep(2)
        return
      }
    }
    setStep(4)
  }

  // ── Step 4: Membership
  // Paid tiers are purchased via Apple In-App Purchase on the tier's detail
  // screen (App Store guideline 3.1.1). Selecting a paid plan here just takes
  // the user to that screen; free continues straight to onboarding.
  function handleMembership(plan: string) {
    if (plan === 'free') {
      router.push('/explore')
    } else {
      router.push(`/membership/${plan}`)
    }
  }

  function goBack() {
    // Within the signup wizard, "Back" rewinds steps. From step 1 or 2 (the
    // entry points), it returns to wherever the user came from in history —
    // a venue page they tapped a booking from, or the splash if it's a fresh
    // entry. Avoids hard-routing back to splash and losing their context.
    if (step <= 2) {
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back()
      } else {
        router.push('/')
      }
    } else {
      setStep(s => (s - 1) as 1 | 2 | 3 | 4)
    }
  }

  // Layout wrapper (cream bg, full height)
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.cream, overflow: 'hidden' } as React.CSSProperties}>

      {/* ── Header */}
      <div style={{
        padding: '12px 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={goBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 10, color: C.stone, letterSpacing: '1.8px',
            textTransform: 'uppercase', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        {step > 1 && (
          <p style={{
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 8.5, color: C.sand, letterSpacing: '1.87px',
            textTransform: 'uppercase', margin: 0,
          }}>
            Step {step === 2 ? '01' : step === 3 ? '02' : '03'} / 03
          </p>
        )}
      </div>

      {/* Progress bar (steps 2+) */}
      {step > 1 && (
        <div style={{ padding: '12px 20px 0' }}>
          <ProgressBar step={step - 1} total={3} />
        </div>
      )}

      <div style={{ padding: '16px 20px 20px' }}>

        {/* ══ Step 1: Who ══════════════════════════════════════════════════ */}
        {step === 1 && (
          <div>
            {/* Kicker */}
            <p style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
              textTransform: 'uppercase', margin: '0 0 6px',
            }}>
              N° 01 · Chi sei
            </p>

            {/* Headline */}
            <h1 style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 38, fontWeight: 400, lineHeight: 1.1,
              letterSpacing: '-1.04px', color: C.ink, margin: '0 0 6px',
            }}>
              How will you use <em>Club Fuoco?</em>
            </h1>
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13, color: C.stone, letterSpacing: '-0.07px',
              margin: '0 0 16px',
            }}>
              Pick what fits — you can change later.
            </p>

            {/* Hero card — Notturno */}
            <button
              onClick={() => setAccountType('user')}
              style={{
                width: '100%', padding: '14px 16px',
                background: 'linear-gradient(155deg, rgb(26,20,16) 0%, rgb(42,24,16) 38%, rgb(91,31,28) 72%, rgb(194,86,45) 110%)',
                borderRadius: 16,
                border: accountType === 'user'
                  ? '1px solid rgba(255,224,165,0.22)'
                  : '1px solid rgba(255,224,165,0.1)',
                cursor: 'pointer', textAlign: 'left',
                position: 'relative', overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              {/* Watermark number */}
              <div style={{
                position: 'absolute', top: 8, right: 16,
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 56, fontStyle: 'italic',
                color: 'rgba(255,232,181,0.18)',
                lineHeight: 1, userSelect: 'none',
              }}>
                N° 01
              </div>

              {/* Badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'rgb(232,182,91)', borderRadius: 4,
                padding: '3px 7px', marginBottom: 8,
              }}>
                <span style={{
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: 9, fontWeight: 700, color: 'rgb(42,24,16)',
                  letterSpacing: '2.16px', textTransform: 'uppercase',
                }}>
                  Recommended · Most users
                </span>
              </div>

              {/* Name */}
              <h2 style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 36, fontStyle: 'italic', fontWeight: 400,
                color: 'rgb(244,236,221)', letterSpacing: '-0.44px',
                margin: '0 0 3px', lineHeight: 1,
              }}>
                Notturno
              </h2>

              {/* Subtitle */}
              <p style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 10.5, color: 'rgba(244,236,221,0.7)',
                letterSpacing: '2.31px', textTransform: 'uppercase',
                margin: '0 0 8px',
              }}>
                Night Out
              </p>

              {/* Tags */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                {['Discover clubs', 'Book entry', 'Save events'].map((tag, i) => (
                  <span key={tag} style={{
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 9.5, color: 'rgba(244,236,221,0.65)',
                    letterSpacing: '1.52px', textTransform: 'uppercase',
                  }}>
                    {i > 0 && <span style={{ marginRight: 8 }}>·</span>}
                    {tag}
                  </span>
                ))}
              </div>

              {/* Selected indicator */}
              {accountType === 'user' && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,232,181,0.14)',
                  border: '1px solid rgba(255,232,181,0.4)',
                  borderRadius: 999, padding: '4px 10px',
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: '1.5px solid rgb(255,232,181)',
                    display: 'inline-block',
                  }} />
                  <span style={{
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 10, color: 'rgb(255,232,181)',
                    letterSpacing: '2px', textTransform: 'uppercase',
                  }}>
                    Selected
                  </span>
                </div>
              )}
            </button>

            {/* Divider */}
            <p style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 12.5, fontStyle: 'italic', color: C.sand,
              textAlign: 'center', margin: '0 0 10px',
            }}>
              or, if you&apos;re on the other side
            </p>

            {/* Mini cards row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {/* Locale */}
              <button
                onClick={() => setAccountType('club')}
                style={{
                  flex: 1, padding: '12px 10px',
                  background: accountType === 'club' ? 'rgba(140,42,42,0.04)' : C.white,
                  border: accountType === 'club'
                    ? '1px solid rgba(140,42,42,0.4)'
                    : '1px solid rgba(34,30,26,0.08)',
                  borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1px solid rgba(34,30,26,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M3 21V9l9-7 9 7v12H3z" stroke={accountType === 'club' ? C.red : C.sand} strokeWidth="1.5" strokeLinejoin="round"/>
                    <rect x="9" y="15" width="6" height="6" stroke={accountType === 'club' ? C.red : C.sand} strokeWidth="1.5"/>
                  </svg>
                </div>
                <span style={{
                  fontFamily: '"Instrument Serif", Georgia, serif',
                  fontSize: 22, fontStyle: 'italic', color: C.ink,
                }}>
                  Locale
                </span>
                <span style={{
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: 9, color: C.sand, letterSpacing: '1.62px',
                  textTransform: 'uppercase',
                }}>
                  Club / Venue
                </span>
              </button>

              {/* Artista */}
              <button
                onClick={() => setAccountType('dj')}
                style={{
                  flex: 1, padding: '12px 10px',
                  background: accountType === 'dj' ? 'rgba(140,42,42,0.04)' : C.white,
                  border: accountType === 'dj'
                    ? '1px solid rgba(140,42,42,0.4)'
                    : '1px solid rgba(34,30,26,0.08)',
                  borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1px solid rgba(34,30,26,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke={accountType === 'dj' ? C.red : C.sand} strokeWidth="1.5"/>
                    <path d="M12 9V3M15 12h6M12 15v6M9 12H3" stroke={accountType === 'dj' ? C.red : C.sand} strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <span style={{
                  fontFamily: '"Instrument Serif", Georgia, serif',
                  fontSize: 22, fontStyle: 'italic', color: C.ink,
                }}>
                  Artista
                </span>
                <span style={{
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: 9, color: C.sand, letterSpacing: '1.62px',
                  textTransform: 'uppercase',
                }}>
                  DJ / Artist
                </span>
              </button>
            </div>

            <PrimaryBtn onClick={() => setStep(2)}>Continue</PrimaryBtn>

            <p style={{
              textAlign: 'center', marginTop: 14,
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13, color: C.stone,
            }}>
              Already a member?{' '}
              <Link href="/login" style={{ color: C.red, textDecoration: 'none' }}>
                Sign in →
              </Link>
            </p>
          </div>
        )}

        {/* ══ Step 2: Details ═══════════════════════════════════════════════ */}
        {step === 2 && (
          <div>
            {/* Role — everyone is a partygoer by default; clubs & artists opt out here */}
            {accountType === 'user' && !showRoleChooser && (
              <button
                type="button"
                onClick={() => setShowRoleChooser(true)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'rgba(248,245,238,0.9)',
                  border: '1px solid rgba(42,31,18,0.18)',
                  borderRadius: 12, padding: '13px 15px', marginBottom: 24,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 12.5, color: C.stone, lineHeight: 1.45,
                }}
              >
                <strong style={{ color: C.ink }}>Are you an artist, or do you represent a club?</strong>{' '}
                <span style={{ color: C.red, textDecoration: 'underline' }}>Tap here</span>
              </button>
            )}

            {showRoleChooser && (
              <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{
                  fontFamily: 'var(--font-geist-mono), monospace',
                  fontSize: 9.5, color: C.red, letterSpacing: '1.6px',
                  textTransform: 'uppercase', margin: '0 0 2px',
                }}>
                  Which are you?
                </p>
                {([
                  { type: 'club', name: 'Locale',  sub: 'Club / Venue' },
                  { type: 'dj',   name: 'Artista', sub: 'DJ / Artist'  },
                ] as { type: AccountType; name: string; sub: string }[]).map(opt => (
                  <div
                    key={opt.type}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '14px 16px',
                      background: C.white, border: '1px solid rgba(42,31,18,0.18)', borderRadius: 12,
                      opacity: 0.55,
                    }}
                  >
                    <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 20, fontStyle: 'italic', color: C.ink }}>
                      {opt.name}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-geist-mono), monospace', fontSize: 8.5,
                      color: C.stone, letterSpacing: '1.2px', textTransform: 'uppercase',
                      background: 'rgba(42,31,18,0.07)', borderRadius: 999, padding: '3px 9px',
                    }}>
                      Coming soon
                    </span>
                  </div>
                ))}
                <p style={{
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 12, color: C.stone, lineHeight: 1.45, margin: '4px 0 0',
                }}>
                  Club and artist accounts aren&apos;t open yet — these features are coming soon.
                  For now, continue as a guest and explore the city.
                </p>
                <button
                  type="button"
                  onClick={() => { setAccountType('user'); setShowRoleChooser(false) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '6px 0', alignSelf: 'flex-start',
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 9.5, color: C.stone, letterSpacing: '1.4px', textTransform: 'uppercase',
                  }}
                >
                  ← I&apos;m just here for nights out
                </button>
              </div>
            )}

            {accountType !== 'user' && !showRoleChooser && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(248,245,238,0.9)',
                border: '1px solid rgba(42,31,18,0.18)',
                borderRadius: 999, padding: '6px 14px 6px 10px',
                marginBottom: 24,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: C.stone, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
                  Account ·{' '}
                </span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 14, fontStyle: 'italic', color: C.ink }}>
                  {kindLabel[accountType]}
                </span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: C.stone, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
                  ({kindSubLabel[accountType]})
                </span>
                <button
                  onClick={() => setShowRoleChooser(true)}
                  style={{
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 9.5, color: C.red, letterSpacing: '1.71px',
                    textTransform: 'uppercase', background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, marginLeft: 4,
                  }}
                >
                  Change
                </button>
              </div>
            )}

            {/* Kicker */}
            <p style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
              textTransform: 'uppercase', margin: '0 0 12px',
            }}>
              N° 02 · I tuoi dati
            </p>

            {/* Headline */}
            <h1 style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 48, fontWeight: 400, lineHeight: 1.1,
              letterSpacing: '-1.04px', color: C.ink, margin: '0 0 8px',
            }}>
              Your <em>details</em>
            </h1>
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13.5, color: C.stone, letterSpacing: '-0.07px',
              margin: '0 0 28px',
            }}>
              A real name on the door · a real email for the guest list.
            </p>

            <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Name row */}
              <div style={{ display: 'flex', gap: 10 }}>
                <AuthField label="First Name">
                  <input
                    type="text" value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required placeholder="Marco" style={inputStyle}
                  />
                </AuthField>
                <AuthField label="Last Name">
                  <input
                    type="text" value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    required placeholder="Bernardi" style={inputStyle}
                  />
                </AuthField>
              </div>

              <AuthField label="Email" error={!!error && error.toLowerCase().includes('email')}>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  required placeholder="you@fuoco.club" style={inputStyle}
                />
              </AuthField>

              <AuthField label="Password" error={!!error && error.toLowerCase().includes('password')} rightSlot={
                <button
                  type="button" onClick={() => setShowPwd(v => !v)}
                  style={{
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: 10, color: C.red, letterSpacing: '1.6px',
                    textTransform: 'uppercase', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '4px 0', flexShrink: 0,
                  }}
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              }>
                <input
                  type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  required minLength={8} placeholder="••••••••"
                  style={{ ...inputStyle, flex: 1 }}
                />
              </AuthField>

              {/* Password hint */}
              <p style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 9.5, color: C.sand, letterSpacing: '1.14px',
                textTransform: 'uppercase', margin: '-4px 0 0',
              }}>
                8+ characters · one number · one symbol
              </p>

              {/* Error message */}
              {error && (
                <p style={{
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 12, color: C.red, margin: 0, lineHeight: 1.4,
                }}>
                  {error}{' '}
                  {error.toLowerCase().includes('email') && (
                    <Link href="/login" style={{ color: C.red }}>Try signing in.</Link>
                  )}
                </p>
              )}

              {/* Terms of Use acceptance — required to create an account */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 4 }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={tosAccepted}
                  onClick={() => setTosAccepted(v => !v)}
                  style={{
                    width: 20, height: 20, flexShrink: 0, marginTop: 1, padding: 0,
                    borderRadius: 6, cursor: 'pointer',
                    border: `1.5px solid ${tosAccepted ? C.red : C.sand}`,
                    background: tosAccepted ? C.red : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {tosAccepted && (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6.4L4.7 9.2L10 3.4" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span style={{
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 12, color: C.sand, lineHeight: 1.45,
                }}>
                  I have read and accept the{' '}
                  <Link href="/legal/terms" style={{ color: C.red, textDecoration: 'underline' }}>Terms of Use</Link>
                  {' '}and{' '}
                  <Link href="/legal/privacy" style={{ color: C.red, textDecoration: 'underline' }}>Privacy Policy</Link>.
                </span>
              </div>

              <div style={{ paddingTop: 8 }}>
                <PrimaryBtn type="submit" loading={loading}>Create account</PrimaryBtn>
              </div>

              {/* Legal links */}
              <p style={{
                textAlign: 'center',
                fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                fontSize: 11.5, color: C.sand, margin: '4px 0 0',
              }}>
                <Link href="/legal/terms" style={{ fontSize: 11.5, color: C.sand }}>Terms</Link>
                {' · '}
                <Link href="/legal/privacy" style={{ fontSize: 11.5, color: C.sand }}>Privacy</Link>
                {' · '}
                <Link href="/legal/help" style={{ fontSize: 11.5, color: C.sand }}>Help</Link>
              </p>
            </form>
          </div>
        )}

        {/* ══ Step 3: Birthday ══════════════════════════════════════════════ */}
        {step === 3 && (
          <div>
            {/* Icon */}
            <div style={{
              width: 64, height: 64,
              background: C.white,
              border: '1px solid rgba(34,30,26,0.08)',
              borderRadius: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="6" width="18" height="15" rx="2" stroke={C.sand} strokeWidth="1.5"/>
                <path d="M3 11h18" stroke={C.sand} strokeWidth="1.5"/>
                <path d="M8 3v3M16 3v3" stroke={C.sand} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>

            {/* Kicker */}
            <p style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
              textTransform: 'uppercase', margin: '0 0 12px',
            }}>
              N° 03 · Compleanno
            </p>

            {/* Headline */}
            <h1 style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 48, fontWeight: 400, lineHeight: 1.1,
              letterSpacing: '-1.04px', color: C.ink, margin: '0 0 8px',
            }}>
              When&apos;s your<br /><em>birthday?</em>
            </h1>
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13.5, color: C.stone, letterSpacing: '-0.07px',
              margin: '0 0 32px',
            }}>
              Unlock exclusive deals and surprises on your night out.
            </p>

            {/* Drum pickers */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
              <DrumPicker
                label="Day"
                values={DAYS}
                selected={bDay}
                onSelect={setBDay}
              />
              <DrumPicker
                label="Month"
                values={Array.from({ length: 12 }, (_, i) => i + 1)}
                labels={MONTHS_EN}
                selected={bMonth}
                onSelect={setBMonth}
              />
              <DrumPicker
                label="Year"
                values={YEARS}
                selected={bYear}
                onSelect={setBYear}
              />
            </div>

            {/* Selected date display */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <p style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 9, color: C.sand, letterSpacing: '1.98px',
                textTransform: 'uppercase', margin: '0 0 4px',
              }}>
                Selected
              </p>
              <p style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 18, fontStyle: 'italic', color: C.red,
                margin: 0,
              }}>
                {bDay} {MONTHS_IT[parseInt(bMonth) - 1]} {bYear}
              </p>
            </div>

            {error && (
              <p style={{
                fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                fontSize: 12, color: C.red, margin: '0 0 12px', lineHeight: 1.4,
              }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <PrimaryBtn onClick={() => handleBirthday(false)}>Continue</PrimaryBtn>
              <button
                onClick={() => handleBirthday(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 13, color: C.sand, padding: '8px 0',
                  textAlign: 'center',
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ══ Step 4: Membership ════════════════════════════════════════════ */}
        {step === 4 && (
          <div>
            {/* Kicker */}
            <p style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
              textTransform: 'uppercase', margin: '0 0 12px',
            }}>
              N° 04 · Membership
            </p>

            {/* Headline */}
            <h1 style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 48, fontWeight: 400, lineHeight: 1.1,
              letterSpacing: '-1.04px', color: C.ink, margin: '0 0 8px',
            }}>
              Choose your<br /><em>membership</em>
            </h1>
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13.5, color: C.stone, letterSpacing: '-0.07px',
              margin: '0 0 28px',
            }}>
              Start free, upgrade later · cancel anytime.
            </p>

            {/* Tier cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>

              {/* ── Libero (Free) */}
              <TierCard
                selected={selectedPlan === 'free'}
                onClick={() => setSelectedPlan('free')}
                background="linear-gradient(135deg, rgb(248,239,220) 0%, rgb(239,224,195) 55%, rgb(229,210,168) 100%)"
                border={selectedPlan === 'free' ? 'rgba(42,31,18,0.35)' : 'rgba(42,31,18,0.18)'}
                nameColor="rgb(107,31,31)"
                subColor="rgb(42,31,18)"
                priceColor="rgb(107,31,31)"
                cadColor="rgb(42,31,18)"
                radioColor="rgba(34,30,26,0.3)"
                radioFill={selectedPlan === 'free' ? 'rgb(107,31,31)' : undefined}
              >
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 20, fontStyle: 'italic', color: 'rgb(107,31,31)' }}>Libero</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: 'rgb(42,31,18)', letterSpacing: '1.9px', textTransform: 'uppercase' as const }}>Free</span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 19, color: 'rgb(107,31,31)' }}>€0</span>
              </TierCard>

              {/* ── Paid tiers — gated behind "Coming soon" ── */}
              <div style={{ position: 'relative' }}>
              <div style={{ filter: 'blur(4px)', opacity: 0.55, pointerEvents: 'none', userSelect: 'none' }}>
              {/* ── Oro (Gold) */}
              <TierCard
                selected={selectedPlan === 'gold'}
                onClick={() => setSelectedPlan('gold')}
                background="linear-gradient(135deg, rgb(74,44,14) 0%, rgb(140,90,30) 45%, rgb(194,139,61) 100%)"
                border={selectedPlan === 'gold' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)'}
                badge="Popular"
                badgeBg="rgba(255,255,255,0.18)"
                badgeBorder="rgba(255,255,255,0.3)"
                badgeColor="rgb(255,232,181)"
                nameColor="rgb(255,232,181)"
                subColor="rgb(255,241,210)"
                priceColor="rgb(255,232,181)"
                cadColor="rgb(255,241,210)"
                radioColor="rgb(255,241,210)"
                radioFill={selectedPlan === 'gold' ? 'rgb(255,241,210)' : undefined}
              >
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 20, fontStyle: 'italic', color: 'rgb(255,232,181)' }}>Oro</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: 'rgb(255,241,210)', letterSpacing: '1.9px', textTransform: 'uppercase' as const }}>Gold</span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 19, color: 'rgb(255,232,181)' }}>€19</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 10, color: 'rgb(255,241,210)', letterSpacing: '1.2px' }}> / month</span>
              </TierCard>

              {/* Gold expanded perks when selected */}
              {selectedPlan === 'gold' && (
                <div style={{
                  background: 'linear-gradient(135deg, rgb(74,44,14) 0%, rgb(140,90,30) 45%, rgb(194,139,61) 100%)',
                  borderRadius: '0 0 12px 12px', marginTop: -10,
                  padding: '10px 20px 16px', border: '1px solid rgba(255,255,255,0.2)',
                  borderTop: 'none',
                }}>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 12 }} />
                  {['Priority entry at partner clubs', '15% discount on bookings', '1 monthly guest pass'].map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l3 3 7-6" stroke="rgb(255,241,210)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13, color: 'rgb(255,241,210)' }}>{p}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: 12,
                    border: '1px dashed rgba(255,255,255,0.2)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, color: 'rgba(255,241,210,0.6)', letterSpacing: '1.08px', textTransform: 'uppercase' as const }}>
                      Benefits at{' '}
                      <span style={{ color: 'rgb(255,241,210)' }}>partner clubs</span>
                      {' '}only · 124 venues in network
                    </span>
                  </div>
                </div>
              )}

              {/* ── Zaffiro (Sapphire) */}
              <TierCard
                selected={selectedPlan === 'sapphire'}
                onClick={() => setSelectedPlan('sapphire')}
                background="linear-gradient(135deg, rgb(14,27,74) 0%, rgb(31,53,144) 45%, rgb(74,107,196) 100%)"
                border={selectedPlan === 'sapphire' ? 'rgba(194,217,255,0.65)' : 'rgba(194,217,255,0.45)'}
                badge="Elite"
                badgeBg="rgba(255,255,255,0.1)"
                badgeBorder="rgba(194,217,255,0.4)"
                badgeColor="rgb(194,217,255)"
                nameColor="rgb(221,230,255)"
                subColor="rgb(234,238,251)"
                priceColor="rgb(221,230,255)"
                cadColor="rgb(234,238,251)"
                radioColor="rgba(34,30,26,0.16)"
                radioFill={selectedPlan === 'sapphire' ? 'rgb(234,238,251)' : undefined}
              >
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 20, fontStyle: 'italic', color: 'rgb(221,230,255)' }}>Zaffiro</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: 'rgb(234,238,251)', letterSpacing: '1.9px', textTransform: 'uppercase' as const }}>Sapphire</span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 19, color: 'rgb(221,230,255)' }}>€49</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 10, color: 'rgb(234,238,251)', letterSpacing: '1.2px' }}> / month</span>
              </TierCard>

              {/* Sapphire expanded perks when selected */}
              {selectedPlan === 'sapphire' && (
                <div style={{
                  background: 'linear-gradient(135deg, rgb(14,27,74) 0%, rgb(31,53,144) 45%, rgb(74,107,196) 100%)',
                  borderRadius: '0 0 12px 12px', marginTop: -10,
                  padding: '10px 20px 16px', border: '1px solid rgba(194,217,255,0.45)',
                  borderTop: 'none',
                }}>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 12 }} />
                  {[
                    '25% discount on all bookings',
                    'Guest list access (4× per month)',
                    'WhatsApp concierge support',
                    'Priority access to all events',
                  ].map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l3 3 7-6" stroke="rgb(194,217,255)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13, color: 'rgb(221,230,255)' }}>{p}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: 12,
                    border: '1px dashed rgba(194,217,255,0.2)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, color: 'rgba(221,230,255,0.6)', letterSpacing: '1.08px', textTransform: 'uppercase' as const }}>
                      Access at{' '}
                      <span style={{ color: 'rgb(221,230,255)' }}>all venues</span>
                      {' '}· 124 clubs in the network
                    </span>
                  </div>
                </div>
              )}

              {/* ── Nero (Black) */}
              <TierCard
                selected={selectedPlan === 'black'}
                onClick={() => setSelectedPlan('black')}
                background="linear-gradient(135deg, rgb(5,5,5) 0%, rgb(26,22,20) 60%, rgb(42,31,18) 100%)"
                border={selectedPlan === 'black' ? 'rgba(232,182,91,0.5)' : 'rgba(232,182,91,0.25)'}
                badge="Ultimate"
                badgeBg="rgba(232,182,91,0.15)"
                badgeBorder="rgba(232,182,91,0.4)"
                badgeColor="rgb(232,182,91)"
                nameColor="rgb(232,182,91)"
                subColor="rgb(240,228,210)"
                priceColor="rgb(232,182,91)"
                cadColor="rgb(240,228,210)"
                radioColor="rgba(34,30,26,0.16)"
                radioFill={selectedPlan === 'black' ? 'rgb(232,182,91)' : undefined}
              >
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 20, fontStyle: 'italic', color: 'rgb(232,182,91)' }}>Nero</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9.5, color: 'rgb(240,228,210)', letterSpacing: '1.9px', textTransform: 'uppercase' as const }}>Black</span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 19, color: 'rgb(232,182,91)' }}>€500</span>
                <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 10, color: 'rgb(240,228,210)', letterSpacing: '1.2px' }}> / month</span>
              </TierCard>
              {/* Black expanded perks when selected */}
              {selectedPlan === 'black' && (
                <div style={{
                  background: 'linear-gradient(135deg, rgb(5,5,5) 0%, rgb(26,22,20) 60%, rgb(42,31,18) 100%)',
                  borderRadius: '0 0 12px 12px', marginTop: -10,
                  padding: '10px 20px 16px', border: '1px solid rgba(232,182,91,0.25)',
                  borderTop: 'none',
                }}>
                  <div style={{ height: 1, background: 'rgba(232,182,91,0.15)', marginBottom: 12 }} />
                  {[
                    'Free VIP entry at every partner club',
                    'Unlimited guest list access',
                    '24/7 dedicated personal concierge',
                    'Private event invitations',
                    'Your name at the door, always',
                  ].map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l3 3 7-6" stroke="rgb(232,182,91)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontFamily: 'var(--font-geist-sans), Inter, sans-serif', fontSize: 13, color: 'rgb(240,228,210)' }}>{p}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: 12,
                    border: '1px dashed rgba(232,182,91,0.2)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 9, color: 'rgba(232,182,91,0.6)', letterSpacing: '1.08px', textTransform: 'uppercase' as const }}>
                      By invitation or application only ·{' '}
                      <span style={{ color: 'rgb(232,182,91)' }}>limited membership</span>
                    </span>
                  </div>
                </div>
              )}
              </div>

              {/* Coming soon overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'var(--font-geist-mono), monospace', fontSize: 10,
                  letterSpacing: '2.2px', textTransform: 'uppercase' as const,
                  color: 'rgb(248,245,238)', background: 'rgb(34,30,26)',
                  borderRadius: 999, padding: '8px 18px',
                }}>
                  Coming soon
                </span>
              </div>
              </div>
            </div>

            {/* Subscribe CTA */}
            <PrimaryBtn onClick={() => handleMembership(selectedPlan)} loading={loading}>
              {selectedPlan === 'free'
                ? 'Start for free'
                : `Subscribe to ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}`
              }
            </PrimaryBtn>

            {selectedPlan !== 'free' && (
              <button
                onClick={() => router.push('/explore')}
                style={{
                  display: 'block', width: '100%', marginTop: 12,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                  fontSize: 13, color: C.sand, textAlign: 'center',
                }}
              >
                Start free, upgrade later
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TierCard — generic membership tier card
// ─────────────────────────────────────────────────────────────────────────────
function TierCard({
  children, selected, onClick,
  background, border,
  badge, badgeBg, badgeBorder, badgeColor,
  nameColor: _nameColor, subColor: _subColor, priceColor: _priceColor, cadColor: _cadColor,
  radioColor, radioFill,
}: {
  children: React.ReactNode
  selected: boolean
  onClick: () => void
  background: string
  border: string
  badge?: string
  badgeBg?: string
  badgeBorder?: string
  badgeColor?: string
  nameColor?: string
  subColor?: string
  priceColor?: string
  cadColor?: string
  radioColor: string
  radioFill?: string
}) {
  const childArr = Array.isArray(children) ? children : [children]
  const [name, sub, price, cad] = childArr

  return (
    <div
      onClick={onClick}
      style={{
        background, borderRadius: 12,
        border: `1px solid ${border}`,
        padding: '14px 16px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'border-color 0.2s',
        position: 'relative',
      }}
    >
      {/* Radio */}
      <div style={{
        width: 18, height: 18, borderRadius: '50%',
        border: `1.5px solid ${radioColor}`,
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: radioFill ? `${radioFill}22` : 'transparent',
      }}>
        {radioFill && (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: radioFill }} />
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          {name}{sub}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          {price}{cad}
        </div>
      </div>

      {/* Badge */}
      {badge && (
        <div style={{
          background: badgeBg, border: `1px solid ${badgeBorder}`,
          borderRadius: 4, padding: '3px 6px',
        }}>
          <span style={{
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 8.5, color: badgeColor, letterSpacing: '1.87px',
            textTransform: 'uppercase' as const,
          }}>
            {badge}
          </span>
        </div>
      )}
    </div>
  )
}
