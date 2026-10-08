'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BrandEvent } from '@/app/api/portal/brands/[id]/events/route'
import { computeNight, eur, DISCLOSURE_STATEMENT } from '@/lib/disclosure'
import { Btn, ErrorLine, Modal, TextInput, api, C, caps, font, mono } from './_ui'

// "Send disclosure" on a promoter card. Asks, per logged night, what the club
// pays per table and our share, and the guestlist price for men and women —
// the 50% of each guestlist price is worked out live. Sends by email; the
// binding statement is shown here exactly as the promoter receives it.

type Rates = { table_club_pays: string; table_our_share: string; gl_man: string; gl_woman: string }
const EMPTY: Rates = { table_club_pays: '', table_our_share: '', gl_man: '', gl_woman: '' }

function num(s: string): number | null {
  const v = parseFloat(s.replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : null
}

export function DisclosureButton({ brandId, name, email }: { brandId: string; name: string; email: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn wide onClick={() => setOpen(true)}>Send disclosure</Btn>
      {open && <DisclosureModal brandId={brandId} name={name} email={email} onClose={() => setOpen(false)} />}
    </>
  )
}

function DisclosureModal({ brandId, name, email, onClose }: {
  brandId: string; name: string; email: string | null; onClose: () => void
}) {
  const [nights, setNights] = useState<BrandEvent[] | null>(null)
  const [rates, setRates] = useState<Record<string, Rates>>({})
  const [to, setTo] = useState(email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    api<{ events: BrandEvent[] }>(`/api/portal/brands/${brandId}/events`)
      .then(d => setNights(d.events))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load nights'))
  }, [brandId])

  const selected = useMemo(
    () => (nights ?? []).filter(n => rates[n.id]),
    [nights, rates],
  )

  const toggle = (id: string) => setRates(r => {
    const next = { ...r }
    if (next[id]) delete next[id]
    else next[id] = { ...(selected[0] ? r[selected[0].id] : EMPTY) }
    return next
  })
  const setField = (id: string, k: keyof Rates, v: string) =>
    setRates(r => ({ ...r, [id]: { ...r[id], [k]: v } }))
  const copyFirstToAll = () => {
    const first = selected[0] && rates[selected[0].id]
    if (!first) return
    setRates(r => Object.fromEntries(Object.keys(r).map(id => [id, { ...first }])))
  }

  const send = async () => {
    setError(null)
    if (!to.trim()) { setError('Add the email address to send it to.'); return }
    if (!selected.length) { setError('Pick at least one night.'); return }
    if (!confirm(`Send this disclosure for ${selected.length} night${selected.length === 1 ? '' : 's'} to ${to.trim()}?`)) return
    setSending(true)
    try {
      await api(`/api/portal/brands/${brandId}/disclosure`, {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          nights: selected.map(n => {
            const r = rates[n.id]
            return {
              night_id: n.id,
              table_club_pays: num(r.table_club_pays),
              table_our_share: num(r.table_our_share),
              gl_man: num(r.gl_man),
              gl_woman: num(r.gl_woman),
            }
          }),
        }),
      })
      setSent(to.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally { setSending(false) }
  }

  if (sent) {
    return (
      <Modal title="Disclosure sent" onClose={onClose}>
        <p style={{ margin: 0, fontFamily: font, fontSize: 14, color: C.dim, lineHeight: 1.6 }}>
          Sent to <span style={{ fontFamily: mono, color: C.text }}>{sent}</span>. A copy of exactly what was sent is in Activity.
        </p>
        <div style={{ marginTop: 20 }}><Btn kind="primary" onClick={onClose}>Done</Btn></div>
      </Modal>
    )
  }

  return (
    <Modal title={`Send disclosure — ${name}`} onClose={onClose} width={760}>
      <label style={{ display: 'block', marginBottom: 18 }}>
        <span style={{ ...caps, fontSize: 10, color: C.faint, display: 'block', marginBottom: 7 }}>Send to</span>
        <TextInput type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="promoter@email.com" />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ ...caps, fontSize: 10, color: C.faint }}>Logged nights</span>
        {nights && nights.length > 0 && (
          <span style={{ display: 'flex', gap: 8 }}>
            <Btn small onClick={() => setRates(Object.fromEntries(nights.map(n => [n.id, rates[n.id] ?? { ...EMPTY }])))}>Select all</Btn>
            {selected.length > 1 && <Btn small onClick={copyFirstToAll}>Copy first night's prices to all</Btn>}
          </span>
        )}
      </div>

      {!nights && !error && <p style={{ fontFamily: font, fontSize: 13, color: C.faint }}>Loading nights…</p>}
      {nights && nights.length === 0 && (
        <p style={{ fontFamily: font, fontSize: 13, color: C.faint }}>No nights logged for this promoter yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(nights ?? []).map(n => {
          const r = rates[n.id]
          const calc = r && computeNight({
            night_id: n.id, night_date: n.night_date, label: '',
            table_club_pays: num(r.table_club_pays), table_our_share: num(r.table_our_share),
            gl_man: num(r.gl_man), gl_woman: num(r.gl_woman),
          })
          return (
            <div key={n.id} style={{ border: `1px solid ${r ? C.gold : C.line}`, borderRadius: 6, padding: '10px 12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!r} onChange={() => toggle(n.id)} />
                <span style={{ fontFamily: mono, fontSize: 12.5, color: C.text }}>
                  {new Date(n.night_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span style={{ fontFamily: font, fontSize: 13, color: C.dim }}>
                  {[n.club_name ?? n.location_name, n.title].filter(Boolean).join(' · ')}
                </span>
              </label>
              {r && calc && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 10 }}>
                  <Money label="Club pays per table" value={r.table_club_pays} onChange={v => setField(n.id, 'table_club_pays', v)} />
                  <Money label="Our share per table" value={r.table_our_share} onChange={v => setField(n.id, 'table_our_share', v)} />
                  <Money label="Guestlist — men" value={r.gl_man} onChange={v => setField(n.id, 'gl_man', v)}
                    note={`50%: ${eur(calc.gl_man_split)}`} />
                  <Money label="Guestlist — women" value={r.gl_woman} onChange={v => setField(n.id, 'gl_woman', v)}
                    note={`50%: ${eur(calc.gl_woman_split)}`} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p style={{
        margin: '20px 0 0', padding: 14, border: `1px solid ${C.gold}`, borderRadius: 6,
        fontFamily: font, fontSize: 13, color: C.text, lineHeight: 1.6,
      }}>
        {DISCLOSURE_STATEMENT}
      </p>

      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={send} disabled={sending || !selected.length}>
          {sending ? 'Sending…' : `Send disclosure${selected.length ? ` (${selected.length})` : ''}`}
        </Btn>
      </div>
    </Modal>
  )
}

function Money({ label, value, onChange, note }: {
  label: string; value: string; onChange: (v: string) => void; note?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ ...caps, fontSize: 9.5, color: C.faint, display: 'block', marginBottom: 6 }}>{label}</span>
      <TextInput inputMode="decimal" value={value} placeholder="€" onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 10px', fontSize: 13.5 }} />
      {note && <span style={{ display: 'block', marginTop: 5, fontFamily: mono, fontSize: 12, color: C.goldHi }}>{note}</span>}
    </label>
  )
}
