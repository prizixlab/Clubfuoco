'use client'

import { useState } from 'react'
import { Btn, ErrorLine, TextInput, C, caps, font, serif } from '../_ui'

// Centered ceremony lockup over the void — ember wordmark, access key with a
// visibility toggle, "authorized access only" rule. Per the Stitch mock.
export default function PortalLogin() {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Login failed')
      window.location.href = '/portal'
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 128px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 4px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ margin: 0, fontFamily: serif, fontStyle: 'italic', fontSize: 44, fontWeight: 400, color: C.goldHi, letterSpacing: '-0.01em' }}>
            Club Fuoco
          </h1>
          <p style={{ ...caps, color: C.dim, margin: '12px 0 0', letterSpacing: '0.24em' }}>Partner Portal</p>
        </div>

        <form onSubmit={submit}>
          <label style={{ display: 'block' }}>
            <span style={{ ...caps, display: 'block', color: C.dim, marginBottom: 8 }}>Access key</span>
            <div style={{ position: 'relative' }}>
              <TextInput
                type={show ? 'text' : 'password'} value={password} autoFocus
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                style={{ padding: '13px 46px 13px 14px', fontSize: 15 }}
              />
              <button type="button" onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide access key' : 'Show access key'}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: C.faint,
                  padding: 8, display: 'flex',
                }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                  {show && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </div>
          </label>

          <ErrorLine error={error} />
          <div style={{ marginTop: 22 }}>
            <Btn kind="primary" type="submit" wide disabled={busy || !password}>
              {busy ? 'Checking…' : <>Login <span aria-hidden>→</span></>}
            </Btn>
          </div>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 44 }}>
          <span style={{ flex: 1, height: 1, background: C.line }} />
          <span style={{ ...caps, color: C.faint, letterSpacing: '0.22em', fontSize: 10 }}>Authorized access only</span>
          <span style={{ flex: 1, height: 1, background: C.line }} />
        </div>
      </div>
    </div>
  )
}
