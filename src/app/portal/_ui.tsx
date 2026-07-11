'use client'

import { useEffect, useState } from 'react'

// ── Partner Portal UI kit ────────────────────────────────────────────────────
// Small shared primitives for the /portal screens. Dark surface, Club Fuoco
// ember/gold accent (#C09950 — never pink), inline styles like the rest of
// the app. Operator tooling: legible and fast over fancy.

export const C = {
  bg:    '#0A0A0A',
  card:  '#141416',
  line:  'rgba(255,255,255,0.09)',
  text:  '#F5F5F7',
  dim:   'rgba(245,245,247,0.55)',
  faint: 'rgba(245,245,247,0.38)',
  gold:  '#C09950',
  danger:'#FFB4A2',
  green: '#8FD6A5',
}

export const font = 'Geist, -apple-system, system-ui, sans-serif'
export const serif = '"Instrument Serif", Georgia, serif'
export const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

// Same-origin fetch against /api/portal/**. Unwraps the { data, error }
// envelope; a 401 (expired/cleared cookie) bounces to the login screen.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData
  const res = await fetch(path, {
    ...init,
    headers: isForm ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 401) {
    window.location.href = '/portal/login'
    throw new Error('Session expired — signing back in')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) throw new Error(json?.error ?? `Request failed (${res.status})`)
  return json.data as T
}

export function Btn({ children, onClick, kind = 'default', disabled, small, type, title }: {
  children: React.ReactNode
  onClick?: () => void
  kind?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  const base: React.CSSProperties = {
    fontFamily: font, fontSize: small ? 12 : 14, fontWeight: 600,
    padding: small ? '6px 12px' : '10px 18px', borderRadius: 10,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    border: '1px solid transparent', transition: 'opacity 0.15s',
    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  }
  const kinds: Record<string, React.CSSProperties> = {
    default: { background: 'rgba(255,255,255,0.08)', color: C.text },
    primary: { background: C.gold, color: '#141416' },
    danger:  { background: 'transparent', color: C.danger, border: `1px solid rgba(255,180,166,0.35)` },
    ghost:   { background: 'transparent', color: C.dim, border: `1px solid ${C.line}` },
  }
  return (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled} title={title}
      style={{ ...base, ...kinds[kind] }}>
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim, marginBottom: 6, fontFamily: font }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11, color: C.faint, marginTop: 5, fontFamily: font }}>{hint}</span>}
    </label>
  )
}

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)', color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 14, fontFamily: font, outline: 'none',
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, ...style }}>
      {children}
    </div>
  )
}

export function Badge({ children, color = C.gold }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700,
      color, border: `1px solid ${color}55`, background: `${color}1A`,
      padding: '3px 8px', borderRadius: 999, fontFamily: font,
    }}>
      {children}
    </span>
  )
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p style={{ margin: '10px 0 0', fontSize: 12.5, color: C.danger, fontFamily: font }}>{error}</p>
}

export function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.62)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      backdropFilter: 'blur(2px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.line}`, borderRadius: 16,
        padding: 24, width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, color: C.text, fontFamily: font }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// The subordinate supplier credit exactly as the booking sheet renders it —
// used by the brand editor's live preview so the operator can honor a
// contract's visibility clause before flipping the switch.
export function SupplierCredit({ name, label, logoUrl }: {
  name: string; label: string | null; logoUrl: string | null
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(245,245,247,0.5)', fontFamily: font }}>
      {label?.trim() || 'Guestlist by'}
      {logoUrl
        ? <img src={logoUrl} alt={name} style={{ height: 12, maxWidth: 84, objectFit: 'contain', opacity: 0.8 }} />
        : <span style={{ fontWeight: 600, color: 'rgba(245,245,247,0.72)' }}>{name}</span>}
    </span>
  )
}

// Activate flow shared by the brands list and the brand editor. Confirms, and
// warns (doesn't block) when the brand has no offers — activating an empty
// brand blanks the front-page partner shelf.
export function ActivateButton({ brand, onDone, small }: {
  brand: { id: string; name: string; is_active: boolean; offer_count: number }
  onDone: () => void
  small?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function activate() {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/portal/brands/${brand.id}/activate`, { method: 'POST' })
      setConfirming(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed')
    } finally {
      setBusy(false)
    }
  }

  if (brand.is_active) return <Badge color={C.green}>Active</Badge>
  return (
    <>
      <Btn kind="primary" small={small} onClick={() => setConfirming(true)}>Activate</Btn>
      {confirming && (
        <Modal title={`Make ${brand.name} the live partner?`} onClose={() => busy ? null : setConfirming(false)}>
          <p style={{ margin: 0, fontSize: 14, color: C.dim, lineHeight: 1.55, fontFamily: font }}>
            Web updates on next load, the app on next open.
          </p>
          {brand.offer_count === 0 && (
            <p style={{ margin: '12px 0 0', fontSize: 13, color: C.danger, lineHeight: 1.5, fontFamily: font }}>
              ⚠ {brand.name} has no offers yet — activating it will blank the
              front-page partner shelf until offers are added.
            </p>
          )}
          <ErrorLine error={error} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <Btn kind="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Btn>
            <Btn kind="primary" onClick={activate} disabled={busy}>
              {busy ? 'Switching…' : `Make ${brand.name} live`}
            </Btn>
          </div>
        </Modal>
      )}
    </>
  )
}
