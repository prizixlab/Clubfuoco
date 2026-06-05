'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Sign-in screen — exact match to 02 _ Sign in-2.html
// Cream cinema theme

const C = {
  cream:  '#F8F5EE',
  ink:    '#221E1A',
  stone:  '#6E6356',
  sand:   '#9F9486',
  red:    '#8C2A2A',
  white:  '#FFFFFF',
}

export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      let type = 'user'
      try {
        const { data: profile } = await (supabase as any)
          .from('users')
          .select('account_type')
          .eq('id', data.user.id)
          .single()
        type = (profile as any)?.account_type ?? 'user'
      } catch {
        // Profile lookup failed — fall back to the standard home screen.
      }
      const home: Record<string, string> = { user: '/explore', club: '/club-dashboard', dj: '/dj-dashboard' }
      router.push(home[type] ?? '/explore')
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.cream, overflow: 'hidden' } as React.CSSProperties}>
      {/* Header nav — Back goes to the previous page in history (the venue
          page they came from, the explore feed, etc.) instead of hard-routing
          to the splash. Falls back to splash if there's no history. */}
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back()
            } else {
              router.push('/')
            }
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 10, color: C.stone, letterSpacing: '1.8px',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
      </div>

      <div style={{ padding: '24px 24px 40px' }}>
        {/* Kicker */}
        <p style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
          textTransform: 'uppercase', margin: '0 0 16px',
        }}>
          N° 01 · Accesso
        </p>

        {/* Headline */}
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 52, fontWeight: 400, lineHeight: 1,
          letterSpacing: '-1.04px', color: C.ink, margin: '0 0 10px',
        }}>
          <em>Welcome</em> back
        </h1>

        {/* Sub */}
        <p style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 13.5, color: C.stone, letterSpacing: '-0.07px',
          margin: '0 0 36px',
        }}>
          Sign in to find tonight&apos;s room.
        </p>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Email field */}
          <AuthField label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@fuoco.club"
              style={inputStyle}
            />
          </AuthField>

          {/* Password field */}
          <AuthField label="Password" rightSlot={
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 10, color: C.red, letterSpacing: '1.6px',
                textTransform: 'uppercase', background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px 6px',
              }}
            >
              {showPwd ? 'HIDE' : 'SHOW'}
            </button>
          }>
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{ ...inputStyle, flex: 1 }}
            />
          </AuthField>

          {/* Error */}
          {error && (
            <p style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 12, color: C.red, margin: 0,
            }}>
              {error}
            </p>
          )}

          {/* Forgot */}
          <div style={{ textAlign: 'center', marginTop: -8 }}>
            <button
              type="button"
              style={{
                fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
                fontSize: 13, color: C.red, background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px 8px',
              }}
            >
              Forgot password?
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', height: 55,
              background: loading ? 'rgba(140,42,42,0.6)' : C.red,
              color: C.cream, borderRadius: 14, border: 'none',
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Signing in…' : (
              <>
                Sign in
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <span style={{
            fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
            fontSize: 13, color: C.stone, letterSpacing: '-0.07px',
          }}>
            No account?{' '}
          </span>
          <Link
            href="/signup"
            style={{
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13, color: C.red, textDecoration: 'none',
            }}
          >
            Create one →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
  fontSize: 16, // 16px minimum prevents iOS auto-zoom on focus
  color: '#221E1A',
  padding: '14px 0',
  lineHeight: '1.3',
}

function AuthField({
  label,
  children,
  rightSlot,
  error,
}: {
  label: string
  children: React.ReactNode
  rightSlot?: React.ReactNode
  error?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: '#9F9486', letterSpacing: '1.8px',
        textTransform: 'uppercase', margin: 0,
      }}>
        {label}
      </p>
      <div style={{
        background: '#FFFFFF',
        border: error ? '1px solid #8C2A2A' : '1px solid rgba(34,30,26,0.08)',
        borderRadius: 12,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'border-color 0.2s',
        backgroundColor: error ? 'rgba(140,42,42,0.04)' : '#FFFFFF',
      }}>
        {children}
        {rightSlot}
      </div>
    </div>
  )
}
