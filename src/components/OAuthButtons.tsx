'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/url'

const C = {
  ink:   '#221E1A',
  stone: '#6E6356',
  white: '#FFFFFF',
}

// OAuth callback URL, preserving a validated ?next= so the user returns to
// where they started (e.g. an invite at /join/CODE) after sign-in.
function callbackUrl(): string {
  const base = `${window.location.origin}/api/auth/callback`
  const next = safeNextPath(new URLSearchParams(window.location.search).get('next'))
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}

// (Native iOS sign-in lives in the native app now — this component only
// renders the web OAuth redirect flows.)

export default function OAuthButtons() {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading,  setAppleLoading]  = useState(false)
  const supabase = createClient()

  async function signInWithGoogle() {
    setGoogleLoading(true)
    try {
      // Web — standard OAuth redirect
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl(),
          skipBrowserRedirect: true,
        },
      })
      if (error || !data.url) { setGoogleLoading(false); return }
      window.location.href = data.url
    } catch (e: any) {
      alert('Google sign-in error: ' + (e?.message ?? String(e)))
      setGoogleLoading(false)
    }
  }

  async function signInWithApple() {
    setAppleLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: callbackUrl() },
      })
      if (error || !data.url) { setAppleLoading(false); return }
      window.location.href = data.url
    } catch (e: any) {
      alert('Apple sign-in error: ' + (e?.message ?? String(e)))
    } finally {
      setAppleLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,30,26,0.1)' }} />
        <span style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 9, color: '#9F9486', letterSpacing: '1.8px',
          textTransform: 'uppercase',
        }}>
          or continue with
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,30,26,0.1)' }} />
      </div>

      {/* Google */}
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googleLoading || appleLoading}
        style={{
          width: '100%', height: 52,
          background: C.white,
          border: '1px solid rgba(34,30,26,0.12)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          cursor: googleLoading ? 'default' : 'pointer',
          opacity: googleLoading ? 0.6 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        {googleLoading ? <Spinner color={C.stone} /> : <GoogleIcon />}
        <span style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 14, fontWeight: 500, color: C.ink, letterSpacing: '-0.1px',
        }}>
          Continue with Google
        </span>
      </button>

      {/* Apple */}
      <button
        type="button"
        onClick={signInWithApple}
        disabled={googleLoading || appleLoading}
        style={{
          width: '100%', height: 52,
          background: C.ink,
          border: '1px solid rgba(34,30,26,0.12)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          cursor: appleLoading ? 'default' : 'pointer',
          opacity: appleLoading ? 0.6 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        {appleLoading ? <Spinner color="#F8F5EE" /> : <AppleIcon />}
        <span style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 14, fontWeight: 500, color: '#F8F5EE', letterSpacing: '-0.1px',
        }}>
          Continue with Apple
        </span>
      </button>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
      <path d="M13.036 9.545c-.022-2.197 1.8-3.263 1.882-3.315-1.027-1.5-2.625-1.705-3.19-1.726-1.352-.138-2.651.8-3.34.8-.69 0-1.745-.783-2.872-.762-1.474.022-2.838.857-3.597 2.173C.467 9.237 1.514 13.47 3.03 15.79c.75 1.14 1.64 2.418 2.81 2.37 1.13-.046 1.556-.726 2.922-.726 1.366 0 1.752.726 2.944.703 1.214-.022 1.981-1.163 2.727-2.307.862-1.32 1.214-2.607 1.235-2.672-.028-.011-2.365-.907-2.39-3.613h-.242zM10.84 3.024C11.44 2.29 11.85 1.279 11.73.25c-.87.04-1.93.586-2.553 1.302-.558.643-1.048 1.68-.916 2.67.971.075 1.966-.493 2.58-1.198z" fill="#F8F5EE"/>
    </svg>
  )
}

function Spinner({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeOpacity="0.25"/>
      <path d="M12 2a10 10 0 0110 10" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}
