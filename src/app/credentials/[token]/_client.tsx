'use client'

import { useState } from 'react'

// The partner-facing form. Deliberately plain: one field that matters, a clear
// statement of what we do with it, and no account to create.
//
// The key is posted once and never rendered back. There is no "show what you
// sent" state, because the only copy we keep is encrypted and the point of the
// flow is that nobody needs to look at it again.

const GOLD = '#C09950'
const BG = '#0A0A0A'
const CARD = '#141416'
const LINE = 'rgba(255,255,255,0.09)'
const TEXT = '#F5F5F7'
const DIM = 'rgba(245,245,247,0.6)'
const FAINT = 'rgba(245,245,247,0.38)'
const FONT = 'Geist, -apple-system, system-ui, sans-serif'

export default function CredentialIntakeClient({
  token, valid, providerLabel, displayName, expiresAt,
}: {
  token: string
  valid: boolean
  providerLabel: string
  displayName: string | null
  expiresAt: string | null
}) {
  const [key, setKey] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !key.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/credentials/intake/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, expires_at: expires || undefined }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.error ?? 'Something went wrong')
      // Clear it from component state the moment it's accepted. It stays in the
      // browser's memory either way, but there's no reason to keep it live in a
      // form the person may leave open on a laptop.
      setKey('')
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{
      minHeight: '100dvh', background: BG, color: TEXT, fontFamily: FONT,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <p style={{
          margin: '0 0 24px', textAlign: 'center', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.25em', textTransform: 'uppercase', color: GOLD,
        }}>
          Club Fuoco · Partner access
        </p>

        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 28 }}>
          {!valid ? (
            <Dead providerLabel={providerLabel} />
          ) : done ? (
            <Done providerLabel={providerLabel} />
          ) : (
            <form onSubmit={submit}>
              <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700 }}>
                Your {providerLabel} API key
              </h1>
              <p style={{ margin: '0 0 20px', fontSize: 14.5, lineHeight: 1.6, color: DIM }}>
                {displayName ? <>Thanks {displayName}. </> : null}
                Paste the key below and it goes straight into our encrypted store. It is
                never shown again, to us or to anyone else, and this page works only once.
              </p>

              <label style={{ display: 'block', fontSize: 12, color: FAINT, marginBottom: 6 }}>
                API key
              </label>
              <textarea
                value={key}
                onChange={e => setKey(e.target.value)}
                rows={3}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste the key from your Fourvenues Developer Portal"
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  background: BG, color: TEXT, border: `1px solid ${LINE}`,
                  borderRadius: 8, padding: '12px 14px', fontSize: 14,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.5, marginBottom: 18,
                }}
              />

              <label style={{ display: 'block', fontSize: 12, color: FAINT, marginBottom: 6 }}>
                Expiry date <span style={{ opacity: 0.7 }}>(optional, if your portal shows one)</span>
              </label>
              <input
                type="date"
                value={expires}
                onChange={e => setExpires(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: BG, color: TEXT, border: `1px solid ${LINE}`,
                  borderRadius: 8, padding: '11px 14px', fontSize: 14,
                  fontFamily: FONT, marginBottom: 20,
                }}
              />

              {error && (
                <p style={{
                  margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5, color: '#FFB4A2',
                }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !key.trim()}
                style={{
                  width: '100%', background: busy || !key.trim() ? 'rgba(192,153,80,0.4)' : GOLD,
                  color: '#141416', fontWeight: 700, fontSize: 15, fontFamily: FONT,
                  border: 'none', borderRadius: 8, padding: '14px 20px',
                  cursor: busy || !key.trim() ? 'default' : 'pointer',
                }}
              >
                {busy ? 'Sending…' : 'Send securely'}
              </button>

              {expiresAt && (
                <p style={{ margin: '16px 0 0', fontSize: 12.5, lineHeight: 1.6, color: FAINT }}>
                  This link expires on{' '}
                  {new Date(expiresAt).toLocaleDateString('en-GB', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                  . You can revoke the key from your {providerLabel} portal at any time.
                </p>
              )}
            </form>
          )}
        </div>

        <p style={{ margin: '24px 0 0', textAlign: 'center', fontSize: 11, color: 'rgba(245,245,247,0.25)' }}>
          Club Fuoco · Barcelona
        </p>
      </div>
    </main>
  )
}

function Done({ providerLabel }: { providerLabel: string }) {
  return (
    <div>
      <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700 }}>Got it, thank you</h1>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: DIM }}>
        Your {providerLabel} key is stored and this link is now closed. We&apos;ll check it
        works and come back to you if anything looks wrong. You can revoke it from your{' '}
        {providerLabel} portal whenever you want.
      </p>
    </div>
  )
}

function Dead({ providerLabel }: { providerLabel: string }) {
  return (
    <div>
      <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700 }}>This link has expired</h1>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: DIM }}>
        It may already have been used, or it may simply be too old. Ask your Club Fuoco
        contact for a fresh one and we&apos;ll send another {providerLabel} link straight
        away. Please don&apos;t email the key instead.
      </p>
    </div>
  )
}
