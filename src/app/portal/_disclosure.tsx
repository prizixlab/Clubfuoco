'use client'

import { useEffect, useState } from 'react'
import {
  eur, half, priceLine, promoterPart, DISCLOSURE_STATEMENT, type DisclosureClub,
} from '@/lib/disclosure'
import { Btn, ErrorLine, Modal, TextInput, api, C, caps, font, mono } from './_ui'

// "Send disclosure" on a promoter card. A clean list, per club they work, of
// every VIP table they sell there with all its prices — the VIP section only
// appears at clubs where they sell tables. Per table the operator enters what
// the club pays and Club Fuoco's part; the promoter's part is the rest. Per
// club, guestlist men/women, split 50/50. Sent by email with the binding
// statement shown here exactly as the promoter receives it.

type Table = { club_pays: string; fuoco_part: string }
type Gl = { gl_man: string; gl_woman: string }

function num(s: string | undefined): number | null {
  if (!s) return null
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
  const [clubs, setClubs] = useState<DisclosureClub[] | null>(null)
  const [tables, setTables] = useState<Record<string, Table>>({})
  const [gl, setGl] = useState<Record<string, Gl>>({})
  const [to, setTo] = useState(email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    api<{ clubs: DisclosureClub[] }>(`/api/portal/brands/${brandId}/disclosure`)
      .then(d => setClubs(d.clubs))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load clubs'))
  }, [brandId])

  const setTable = (id: string, k: keyof Table, v: string) =>
    setTables(t => ({ ...t, [id]: { ...(t[id] ?? { club_pays: '', fuoco_part: '' }), [k]: v } }))
  const setGuest = (id: string, k: keyof Gl, v: string) =>
    setGl(g => ({ ...g, [id]: { ...(g[id] ?? { gl_man: '', gl_woman: '' }), [k]: v } }))

  const send = async () => {
    setError(null)
    if (!to.trim()) { setError('Add the email address to send it to.'); return }
    if (!confirm(`Send this disclosure to ${to.trim()}?`)) return
    setSending(true)
    try {
      await api(`/api/portal/brands/${brandId}/disclosure`, {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          clubs: (clubs ?? []).map(c => ({
            club_id: c.club_id,
            gl_man: num(gl[c.club_id]?.gl_man),
            gl_woman: num(gl[c.club_id]?.gl_woman),
            tables: c.tables.map(t => ({
              key: t.key,
              club_pays: num(tables[t.key]?.club_pays),
              fuoco_part: num(tables[t.key]?.fuoco_part),
            })),
          })),
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
    <Modal title={`Send disclosure — ${name}`} onClose={onClose} width={820}>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={{ ...caps, fontSize: 10, color: C.faint, display: 'block', marginBottom: 7 }}>Send to</span>
        <TextInput type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="promoter@email.com" />
      </label>

      {!clubs && !error && <p style={{ fontFamily: font, fontSize: 13, color: C.faint }}>Loading clubs and tables…</p>}
      {clubs && clubs.length === 0 && (
        <p style={{ fontFamily: font, fontSize: 13, color: C.faint }}>No clubs yet — they have no logged nights and aren't ranked on any table.</p>
      )}

      {(clubs ?? []).map(c => {
        const g = gl[c.club_id]
        const man = num(g?.gl_man), woman = num(g?.gl_woman)
        return (
          <section key={c.club_id} style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <h3 style={{ margin: 0, fontFamily: font, fontSize: 16, fontWeight: 700, color: C.text }}>{c.club_name}</h3>

            {c.tables.length > 0 && (
              <>
                <p style={{ ...caps, fontSize: 10, color: C.gold, margin: '16px 0 8px' }}>VIP tables</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {c.tables.map(t => {
                    const v = tables[t.key]
                    const promoter = promoterPart({ club_pays: num(v?.club_pays), fuoco_part: num(v?.fuoco_part) })
                    return (
                      <div key={t.key} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <span style={{ fontFamily: font, fontSize: 14, fontWeight: 650, color: C.text, minWidth: 140 }}>{t.name}</span>
                          <span style={{ fontFamily: mono, fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
                            {t.prices.length
                              ? t.prices.map((p, i) => <span key={i} style={{ display: 'block' }}>{priceLine(p)}</span>)
                              : <span style={{ color: C.faint }}>No price listed</span>}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
                          <Money label="Club pays per table" value={v?.club_pays ?? ''} onChange={x => setTable(t.key, 'club_pays', x)} />
                          <Money label="Club Fuoco's part" value={v?.fuoco_part ?? ''} onChange={x => setTable(t.key, 'fuoco_part', x)} />
                          <Computed label="Promoter's part" value={promoter} bad={promoter != null && promoter < 0} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <p style={{ ...caps, fontSize: 10, color: C.gold, margin: '16px 0 8px' }}>Guestlist</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <Money label="Men" value={g?.gl_man ?? ''} onChange={x => setGuest(c.club_id, 'gl_man', x)}
                note={man != null ? `Club Fuoco 50%: ${eur(half(man))} · Promoter 50%: ${eur(half(man))}` : undefined} />
              <Money label="Women" value={g?.gl_woman ?? ''} onChange={x => setGuest(c.club_id, 'gl_woman', x)}
                note={woman != null ? `Club Fuoco 50%: ${eur(half(woman))} · Promoter 50%: ${eur(half(woman))}` : undefined} />
            </div>
          </section>
        )
      })}

      <p style={{
        margin: '24px 0 0', padding: 14, border: `1px solid ${C.gold}`, borderRadius: 6,
        fontFamily: font, fontSize: 13, color: C.text, lineHeight: 1.6,
      }}>
        {DISCLOSURE_STATEMENT}
      </p>

      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={send} disabled={sending || !clubs?.length}>
          {sending ? 'Sending…' : 'Send disclosure'}
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
      {note && <span style={{ display: 'block', marginTop: 5, fontFamily: mono, fontSize: 11.5, color: C.goldHi }}>{note}</span>}
    </label>
  )
}

function Computed({ label, value, bad }: { label: string; value: number | null; bad?: boolean }) {
  return (
    <div>
      <span style={{ ...caps, fontSize: 9.5, color: C.faint, display: 'block', marginBottom: 6 }}>{label}</span>
      <div style={{
        padding: '8px 10px', fontSize: 13.5, fontFamily: mono, borderRadius: 4,
        border: `1px dashed ${bad ? C.danger : C.line}`, color: bad ? C.danger : value == null ? C.faint : C.goldHi,
      }}>
        {value == null ? 'auto' : eur(value)}
      </div>
    </div>
  )
}
