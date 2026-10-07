'use client'

import { useCallback, useState } from 'react'
import { api, Btn, C, font, mono } from './_ui'
import type { CredentialRecord } from '@/lib/credentials'

// "Send Fourvenues API intake link" for one promoter.
//
// Collapsed until opened, matching FeeControl on the same card: a roster of
// thirty promoters that eagerly loads credential state on every row is thirty
// requests to render a list nobody is reading.
//
// The key itself never appears here. The most this screen can show is the last
// four characters, because that is the most the API will return.

interface Status {
  provider: string
  provider_label: string
  brand_id: string | null
  name: string
  suggested_email: string | null
  /** True when the stored address is one of ours — mail there reaches US. */
  email_is_ours: boolean
  ttl_days: number
  credentials: CredentialRecord[]
  pending_intake: { sent_to: string | null; expires_at: string; created_at: string } | null
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function statusColor(s: string): string {
  if (s === 'active') return C.green
  if (s === 'failed' || s === 'expired') return C.danger
  return C.faint
}

export function CredentialControl({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await api<Status>(`/api/portal/promoters/${userId}/credential-intake`)
      setStatus(r)
      // Prefill only with an address that would actually reach them.
      setEmail(r.email_is_ours ? '' : (r.suggested_email ?? ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load credential status')
    }
  }, [userId])

  const toggle = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next && !status) void load()
  }, [open, status, load])

  const send = useCallback(async (confirmOurDomain = false) => {
    const to = email.trim()
    if (!to) { setError('Enter the address to send it to'); return }
    if (status?.pending_intake && !confirmOurDomain) {
      const prev = status.pending_intake.sent_to ?? 'them'
      if (!confirm(
        `A link sent to ${prev} is still unused and expires ${fmtDate(status.pending_intake.expires_at)}.\n\n` +
        'Sending a new one cancels it. Continue?',
      )) return
    }
    setBusy(true)
    setError(null)
    setManualLink(null)
    try {
      const r = await api<{ sent: boolean; email: string; expires_at: string; link?: string }>(
        `/api/portal/promoters/${userId}/credential-intake`,
        {
          method: 'POST',
          body: JSON.stringify({
            provider: 'fourvenues',
            email: to,
            confirm_our_domain: confirmOurDomain || undefined,
          }),
        },
      )
      setSentTo(r.email)
      // Email not configured — hand the operator the link so the flow still
      // completes rather than silently going nowhere.
      if (!r.sent && r.link) setManualLink(r.link)
      void load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not send the link'
      // The our-domain guard is a confirmable warning, not a hard failure.
      if (/Club Fuoco address/i.test(msg)) {
        if (confirm(`${msg}\n\nSend it anyway?`)) { void send(true); return }
        setError(null)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }, [email, status, userId, load])

  const live = status?.credentials.find(c => c.status === 'active' || c.status === 'failed')

  if (!open) {
    return (
      <Btn small onClick={toggle} title={`Fourvenues API key for ${name}`}>
        Fourvenues key{live ? ` · ····${live.last4 ?? ''}` : ''}
      </Btn>
    )
  }

  return (
    <div style={{
      marginTop: 10, padding: 16, background: C.lifted,
      border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: font,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.gold }}>
          Fourvenues API key
        </span>
        <Btn small kind="ghost" onClick={toggle}>Close</Btn>
      </div>

      {!status && !error && (
        <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Loading…</p>
      )}

      {status && !status.brand_id && (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: C.danger }}>
          No brand yet. A key belongs to a brand, so provision one first.
        </p>
      )}

      {status?.brand_id && (
        <>
          {live && (
            <div style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.7, color: C.dim }}>
              <div>
                <span style={{ color: statusColor(live.status), fontWeight: 600 }}>
                  {live.status.toUpperCase()}
                </span>
                {live.last4 && (
                  <span style={{ fontFamily: mono, color: C.faint }}> · ····{live.last4}</span>
                )}
              </div>
              {live.rotate_after && <div style={{ color: C.faint }}>Rotate by {fmtDate(live.rotate_after)}</div>}
              {live.last_verified_at && (
                <div style={{ color: C.faint }}>
                  Last checked {fmtDate(live.last_verified_at)}
                  {live.last_verified_ok === false ? ' · failing' : ''}
                </div>
              )}
              {live.last_error && (
                <div style={{ color: C.danger, fontSize: 12.5 }}>{live.last_error}</div>
              )}
            </div>
          )}

          {status.pending_intake && !sentTo && (
            <p style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.6, color: C.faint }}>
              A link to {status.pending_intake.sent_to ?? 'them'} is still unused, expiring{' '}
              {fmtDate(status.pending_intake.expires_at)}.
            </p>
          )}

          {status.email_is_ours && (
            <p style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.6, color: C.danger }}>
              Their stored address ({status.suggested_email}) is ours, so a link sent there
              comes back to us. Use their real contact.
            </p>
          )}

          <label style={{ display: 'block', fontSize: 11, color: C.faint, marginBottom: 5 }}>
            Send to
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="their real contact address"
            style={{
              width: '100%', boxSizing: 'border-box', background: C.bg, color: C.text,
              border: `1px solid ${C.line}`, borderRadius: 6, padding: '9px 11px',
              fontSize: 13, fontFamily: font, marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn small kind="primary" onClick={() => send()} disabled={busy}>
              {busy ? 'Sending…' : live ? 'Send replacement link' : 'Send intake link'}
            </Btn>
            <span style={{ fontSize: 12, color: C.faint }}>
              One-time link, expires in {status.ttl_days} days
            </span>
          </div>

          {sentTo && !manualLink && (
            <p style={{ margin: '12px 0 0', fontSize: 13, color: C.green }}>
              Sent to {sentTo}.
            </p>
          )}

          {manualLink && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.danger }}>
                Email isn&apos;t configured, so nothing was sent. Pass this on yourself:
              </p>
              <code style={{
                display: 'block', wordBreak: 'break-all', fontFamily: mono, fontSize: 12,
                background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6,
                padding: '8px 10px', color: C.dim,
              }}>
                {manualLink}
              </code>
            </div>
          )}
        </>
      )}

      {error && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: C.danger }}>{error}</p>
      )}
    </div>
  )
}
