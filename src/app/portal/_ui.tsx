'use client'

import { useEffect, useState } from 'react'

// ── Partner Portal UI kit — "Ember & Onyx" ──────────────────────────────────
// Design system from the Stitch redesign (docs: ember_onyx/DESIGN.md in the
// design export): onyx surfaces with tonal layering + hairline outlines, ember
// gold as the sole action color, label-caps for section headers/status, mono
// for slugs/prices, serif (Instrument Serif) for editorial display moments.
// Never pink — supplier colors decorate their data, not the interface.

export const C = {
  bg:     '#0A0A0A',                      // level 0 — the void
  card:   '#141416',                      // level 1 — cards, panels, modals
  lifted: '#1C1C1E',                      // level 2 — hover / nested elements
  line:   'rgba(255,255,255,0.09)',       // hairline outline
  lineHi: 'rgba(255,255,255,0.22)',       // outline on hover/focus
  text:   '#F5F5F7',
  dim:    'rgba(245,245,247,0.6)',
  faint:  'rgba(245,245,247,0.38)',
  gold:   '#C09950',                      // ember — the sole catalyst for action
  goldHi: '#EBC073',                      // bright ember — hover / emphasis text
  danger: '#FFB4A2',
  green:  '#8FD6A5',
}

export const font  = 'Geist, -apple-system, system-ui, sans-serif'
export const serif = '"Instrument Serif", Georgia, serif'
export const mono  = 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace'

// label-caps — the system's workhorse for section headers, statuses, kickers.
export const caps: React.CSSProperties = {
  fontFamily: font, fontSize: 11, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
}

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

export function Btn({ children, onClick, kind = 'default', disabled, small, type, title, wide }: {
  children: React.ReactNode
  onClick?: () => void
  kind?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  title?: string
  wide?: boolean
}) {
  const primary = kind === 'primary'
  const base: React.CSSProperties = {
    // Primary CTAs speak in label-caps (the mock's PUBLISH CHANGES / CONFIRM &
    // ACTIVATE); secondary actions stay sentence-case and quiet.
    ...(primary
      ? { ...caps, fontSize: small ? 10.5 : 12, letterSpacing: '0.12em' }
      : { fontFamily: font, fontSize: small ? 12.5 : 14, fontWeight: 600 }),
    padding: small ? '7px 13px' : '12px 20px',
    borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    border: '1px solid transparent',
    transition: 'background 0.18s, border-color 0.18s, opacity 0.18s',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    whiteSpace: 'nowrap',
    ...(wide ? { width: '100%' } : null),
  }
  const kinds: Record<string, React.CSSProperties> = {
    default: { background: 'rgba(255,255,255,0.08)', color: C.text },
    primary: { background: C.gold, color: '#141416' },
    danger:  { background: 'transparent', color: C.danger, border: '1px solid rgba(255,180,166,0.3)' },
    ghost:   { background: 'transparent', color: C.dim, border: `1px solid ${C.line}` },
  }
  return (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled} title={title}
      className={`cfp-btn cfp-btn-${kind}`}
      style={{ ...base, ...kinds[kind] }}>
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 18 }}>
      <span style={{ ...caps, display: 'block', color: C.dim, marginBottom: 8 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: C.faint, marginTop: 6, fontFamily: font, lineHeight: 1.45 }}>{hint}</span>}
    </label>
  )
}

// Inputs sit INTO the canvas — darker than the card, sharp 4px corners.
export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.35)', color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 4,
  padding: '11px 12px', fontSize: 14, fontFamily: font, outline: 'none',
  transition: 'border-color 0.18s',
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="cfp-input" style={{ ...inputStyle, ...props.style }} />
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 24, ...style }}>
      {children}
    </div>
  )
}

// Section header inside a card — label-caps in ember, per the mock's
// "BRAND IDENTITY" / "OFFERS & VENUES".
export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
      <span style={{ ...caps, color: C.gold, letterSpacing: '0.14em' }}>{children}</span>
      {right}
    </div>
  )
}

// Status chip — 6px dot + label-caps, outlined and subtle (never a filled pill).
export function Badge({ children, color = C.gold }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      ...caps, fontSize: 10, color,
      border: `1px solid ${color}44`, background: 'rgba(0,0,0,0.25)',
      padding: '5px 9px', borderRadius: 4,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color, display: 'inline-block' }} />
      {children}
    </span>
  )
}

// Value block — big editorial number over an ember label (real metrics only).
export function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: '18px 20px' }}>
      <p style={{ ...caps, color: C.gold, margin: '0 0 10px', letterSpacing: '0.14em' }}>{label}</p>
      <p style={{ margin: 0, fontFamily: serif, fontSize: 26, lineHeight: 1.1, color: C.text }}>{value}</p>
    </div>
  )
}

// ── Day picker ───────────────────────────────────────────────────────────────
// valid_days is stored as display text ("Tue, Thu – Sun") that the iOS "Tonight"
// filter has to parse. This picker reads that text into toggles and emits a
// canonical, unambiguous string ("Every night" or an explicit comma list) so
// the parsing is always reliable.
const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
] as const

// sun=0 order for range-wrapping when parsing legacy strings.
const WRAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function parseDays(s: string): Set<string> {
  const v = (s ?? '').toLowerCase()
  if (/every|any|daily/.test(v)) return new Set(DAYS.map(d => d.key))
  const idxOf = (seg: string) => WRAP.findIndex(d => seg.includes(d))
  const set = new Set<string>()
  for (const part of v.split(',')) {
    const sep = ['–', '—', '-'].find(x => part.includes(x))
    if (sep) {
      const [a, b] = part.split(sep)
      const ai = idxOf(a), bi = idxOf(b)
      if (ai >= 0 && bi >= 0) { let i = ai; while (true) { set.add(WRAP[i]); if (i === bi) break; i = (i + 1) % 7 } continue }
    }
    const j = idxOf(part); if (j >= 0) set.add(WRAP[j])
  }
  return set
}

export function daysToString(set: Set<string>): string {
  if (set.size >= 7) return 'Every night'
  return DAYS.filter(d => set.has(d.key)).map(d => d.label).join(', ')
}

export function DayPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const set = parseDays(value)
  const every = set.size >= 7
  const toggle = (key: string) => {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    onChange(daysToString(next))
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Btn small kind={every ? 'primary' : 'ghost'}
        onClick={() => onChange(every ? '' : 'Every night')}>Every night</Btn>
      <span style={{ width: 1, height: 22, background: C.line, margin: '0 2px' }} />
      {DAYS.map(d => (
        <Btn key={d.key} small kind={!every && set.has(d.key) ? 'primary' : 'ghost'} onClick={() => toggle(d.key)}>
          {d.label}
        </Btn>
      ))}
    </div>
  )
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p style={{ margin: '12px 0 0', fontSize: 12.5, color: C.danger, fontFamily: font, lineHeight: 1.5 }}>{error}</p>
}

export function Modal({ title, children, onClose, width = 480 }: {
  title?: string; children: React.ReactNode; onClose: () => void; width?: number
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
      backdropFilter: 'blur(12px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.line}`, borderRadius: 8,
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        padding: 28, width: '100%', maxWidth: width, maxHeight: '88vh', overflowY: 'auto',
      }}>
        {title && <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700, color: C.text, fontFamily: font }}>{title}</h2>}
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

// ── Activation ceremony ─────────────────────────────────────────────────────
// The switch changes the consumer app's production state for every user, so
// the dialog is deliberately ceremonial (per the mock): bolt mark, serif title
// with the brand name in ember, an ember-ruled warning panel, a critical panel
// when the brand has zero live offers (warn — don't block), and the target
// environment spelled out. Shared by the suppliers list and the brand editor.
export function ActivateButton({ brand, onDone, small, wide, currentLive }: {
  brand: { id: string; name: string; is_active: boolean; offer_count: number }
  onDone: () => void
  small?: boolean
  wide?: boolean
  currentLive?: string | null
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

  if (brand.is_active) return null   // status chips mark the live brand

  return (
    <>
      <Btn kind="primary" small={small} wide={wide} onClick={() => setConfirming(true)}>Activate</Btn>
      {confirming && (
        <Modal onClose={() => busy ? null : setConfirming(false)} width={520}>
          <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 8, margin: '0 auto 18px',
              background: 'rgba(192,153,80,0.1)', border: '1px solid rgba(192,153,80,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={C.goldHi} aria-hidden>
                <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />
              </svg>
            </div>
            <h2 style={{ margin: 0, fontFamily: serif, fontSize: 24, fontWeight: 400, color: C.text }}>
              Make <em style={{ color: C.goldHi, fontStyle: 'italic' }}>{brand.name}</em> the live partner?
            </h2>
            <p style={{ ...caps, color: C.faint, margin: '10px 0 0', letterSpacing: '0.18em' }}>
              Production state transition
            </p>
          </div>

          <div style={{
            margin: '22px 0 0', background: C.lifted, borderRadius: 6,
            borderLeft: `2px solid ${C.gold}`, padding: '16px 18px',
          }}>
            <p style={{ margin: 0, fontSize: 13.5, color: C.text, lineHeight: 1.6, fontFamily: font }}>
              This changes the consumer app immediately.{' '}
              <span style={{ color: C.dim }}>Web updates on next load, the app on next open.</span>
            </p>
            {brand.offer_count === 0 && (
              <div style={{
                marginTop: 14, background: 'rgba(147,0,10,0.18)',
                border: '1px solid rgba(255,180,166,0.25)', borderRadius: 6, padding: '13px 15px',
              }}>
                <p style={{ ...caps, color: C.danger, margin: '0 0 7px', letterSpacing: '0.12em' }}>
                  No live offers
                </p>
                <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.55, fontFamily: font }}>
                  {brand.name} has <strong>zero</strong> live offers. Activating it
                  will blank the front-page partner shelf until offers are added.
                </p>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-around', gap: 16,
            borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`,
            margin: '20px 0', padding: '15px 0', textAlign: 'center',
          }}>
            <div>
              <p style={{ ...caps, color: C.gold, margin: '0 0 7px' }}>Target environment</p>
              <p style={{ margin: 0, fontFamily: serif, fontSize: 16, color: C.text }}>Production</p>
            </div>
            <div>
              <p style={{ ...caps, color: C.gold, margin: '0 0 7px' }}>Currently live</p>
              <p style={{ margin: 0, fontFamily: serif, fontSize: 16, color: C.text }}>{currentLive ?? '—'}</p>
            </div>
          </div>

          <ErrorLine error={error} />
          <div style={{ marginTop: 16 }}>
            <Btn kind="primary" wide onClick={activate} disabled={busy}>
              {busy ? 'Switching…' : 'Confirm & activate brand'}
            </Btn>
            <button onClick={() => setConfirming(false)} disabled={busy} style={{
              ...caps, background: 'none', border: 'none', color: C.dim, cursor: 'pointer',
              display: 'block', margin: '16px auto 0', padding: 6, letterSpacing: '0.14em',
            }}>
              Cancel action
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
