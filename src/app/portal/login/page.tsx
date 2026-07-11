'use client'

import { useState } from 'react'
import { Btn, Card, ErrorLine, Field, TextInput, C, font } from '../_ui'

export default function PortalLogin() {
  const [password, setPassword] = useState('')
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
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 700, color: C.text, fontFamily: font }}>
          Operator sign-in
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: C.dim, fontFamily: font }}>
          Manage the front-page guestlist supplier.
        </p>
        <form onSubmit={submit}>
          <Field label="Portal password">
            <TextInput
              type="password" value={password} autoFocus
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
            />
          </Field>
          <ErrorLine error={error} />
          <div style={{ marginTop: 8 }}>
            <Btn kind="primary" type="submit" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Enter portal'}
            </Btn>
          </div>
        </form>
      </Card>
    </div>
  )
}
