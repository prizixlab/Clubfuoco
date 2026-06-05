'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

// ── Splash screen — dark cinema theme
export default function SplashPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [continuing, setContinuing] = useState(false)

  // Replaces the middleware redirect: logged-in users skip straight to the app
  useEffect(() => {
    if (!loading && user) router.replace('/explore')
  }, [user, loading, router])

  // "Continue with no account" — silently creates a Supabase anonymous user so
  // every guest has a stable user.id we can count toward MAU and tie favourites,
  // signals, and presence to. The user never sees a form; this is transparent.
  // No personal info is collected. They can upgrade to a full account later.
  async function continueAsGuest() {
    if (continuing) return
    setContinuing(true)
    try {
      const supabase = createClient()
      await supabase.auth.signInAnonymously()
    } catch { /* still route them in — Explore is public */ }
    router.push('/explore')
  }
  return (
    <div
      style={{
        background: 'rgb(10, 8, 7)',
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        overflow: 'hidden',
      }}
    >
      {/* Fire glow — centered radial */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -70%)',
          width: 760,
          height: 760,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,182,91,0.55) 0%, rgba(194,86,45,0.42) 22%, rgba(107,31,31,0.32) 42%, rgba(20,12,8,0) 62%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top kicker */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontSize: 9.5,
          color: 'rgba(244,236,221,0.6)',
          letterSpacing: '2.66px',
          textTransform: 'uppercase',
        }}
      >
        EST · MMXXVI · BARCELONA
      </div>

      {/* Main content */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 430,
          padding: '0 24px 48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 0,
          paddingBottom: 'calc(48px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Edition kicker */}
        <p
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 9,
            color: 'rgba(244,236,221,0.45)',
            letterSpacing: '2.52px',
            textTransform: 'uppercase',
            marginBottom: 20,
          }}
        >
          N° 01 · BARCELONA
        </p>

        {/* Logo title */}
        <h1
          style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 34,
            fontWeight: 400,
            color: 'rgb(244,236,221)',
            letterSpacing: '10.88px',
            textTransform: 'uppercase',
            margin: '0 0 16px',
            lineHeight: 1.1,
          }}
        >
          CLUB FUOCO
        </h1>

        {/* Tagline */}
        <p
          style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 20,
            fontStyle: 'italic',
            color: 'rgba(244,236,221,0.75)',
            letterSpacing: '-0.12px',
            margin: '0 0 48px',
            lineHeight: 1.3,
          }}
        >
          Where the night begins before you arrive.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <Link
            href="/signup"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 55,
              background: 'rgb(194,86,45)',
              color: 'rgb(255,246,229)',
              borderRadius: 14,
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15,
              fontWeight: 500,
              textDecoration: 'none',
              letterSpacing: '0.01em',
            }}
          >
            Create account
          </Link>

          <Link
            href="/login"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 55,
              background: 'rgba(255,246,229,0.06)',
              border: '1px solid rgba(244,236,221,0.22)',
              color: 'rgb(244,236,221)',
              borderRadius: 14,
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15,
              fontWeight: 400,
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>

          {/* Guest browsing — Guideline 5.1.1(v) compliance. This MUST read as
              a primary action, not a footnote. Apple Review explicitly rejected
              a prior build because the guest path was rendered as low-emphasis
              text and a reviewer couldn't find it. Treat as a peer button. */}
          <button
            type="button"
            onClick={continueAsGuest}
            disabled={continuing}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 55,
              background: 'rgba(255,246,229,0.10)',
              border: '1px solid rgba(244,236,221,0.30)',
              color: 'rgb(244,236,221)',
              borderRadius: 14,
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '0.01em',
              cursor: 'pointer',
              opacity: continuing ? 0.6 : 1,
            }}
          >
            {continuing ? 'Opening…' : 'Continue as guest'}
          </button>

          <p
            style={{
              marginTop: 14,
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 12,
              lineHeight: 1.4,
              color: 'rgba(244,236,221,0.55)',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            Browse everything without an account. You only share details when you book.
          </p>
        </div>

        {/* Footer legal */}
        <p
          style={{
            marginTop: 24,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 9.5,
            color: 'rgba(244,236,221,0.4)',
            letterSpacing: '1.14px',
            textTransform: 'uppercase',
          }}
        >
          By continuing you accept the terms &amp; privacy
        </p>
      </div>
    </div>
  )
}
