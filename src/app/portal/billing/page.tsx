'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  C, caps, font, serif, mono, api, Btn, Card, Field, TextInput, ErrorLine, Modal, StatTile, Badge,
} from '../_ui'

type Kind = 'guestlist' | 'ticket' | 'table'
interface Line {
  id: string
  source: 'offer' | 'event' | 'fourvenues'
  kind: Kind
  heads: number
  amount: number | null
  created_at: string
  night: string | null
  club_id: string | null
  club: string
  promoter_key: string
  promoter: string
  user_id: string | null
  user_name: string | null
  user_email: string | null
  user_phone: string | null
  checked_in: boolean
  excluded: { id: string; by: 'user' | 'line'; reason: string | null } | null
  assignable: boolean
  assigned: boolean
}
interface Promoter { id: string; name: string }
interface Payload {
  period: string; exclusionsReady: boolean; assignmentsReady: boolean
  promoters: Promoter[]; lines: Line[]
}

const KIND_LABEL: Record<Kind, string> = { guestlist: 'Guestlist', ticket: 'Ticket', table: 'VIP table' }
const SOURCE_LABEL: Record<Line['source'], string> = { offer: 'Offer', event: 'Event', fourvenues: 'Fourvenues' }

const eur = (n: number) => `€${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`

function periods(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() - i
    const dt = new Date(Date.UTC(y, m, 1))
    out.push({
      value: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`,
      label: dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })
  }
  out.push({ value: 'all', label: 'All time' })
  return out
}

interface Tally { key: string; name: string; guestlists: number; purchases: number; heads: number; revenue: number; excluded: number }

function tally(lines: Line[], keyOf: (l: Line) => string, nameOf: (l: Line) => string): Tally[] {
  const m = new Map<string, Tally>()
  for (const l of lines) {
    const k = keyOf(l)
    const t = m.get(k) ?? { key: k, name: nameOf(l), guestlists: 0, purchases: 0, heads: 0, revenue: 0, excluded: 0 }
    if (l.excluded) t.excluded++
    else {
      if (l.kind === 'guestlist') t.guestlists++
      else t.purchases++
      t.heads += l.heads
      t.revenue += l.amount ?? 0
    }
    m.set(k, t)
  }
  return [...m.values()].sort((a, b) => (b.guestlists + b.purchases) - (a.guestlists + a.purchases) || b.excluded - a.excluded)
}

export default function BillingPage() {
  const options = useMemo(periods, [])
  const [period, setPeriod] = useState(options[0].value)
  const [d, setD] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [promoter, setPromoter] = useState<Tally | null>(null)
  const [club, setClub] = useState<Tally | null>(null)
  const [excluding, setExcluding] = useState<Line | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setError(null)
    try { setD(await api<Payload>(`/api/portal/billing?period=${period}`)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }
  useEffect(() => { setD(null); void load() }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines = d?.lines ?? []
  const byPromoter = useMemo(() => tally(lines, l => l.promoter_key, l => l.promoter), [lines])
  const byClub = useMemo(() => tally(lines, l => l.club_id ?? `name:${l.club}`, l => l.club), [lines])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return lines.filter(l =>
      (!promoter || l.promoter_key === promoter.key)
      && (!club || (l.club_id ?? `name:${l.club}`) === club.key)
      && (!needle || [l.user_name, l.user_email, l.user_phone, l.club, l.promoter]
        .some(s => s?.toLowerCase().includes(needle))))
  }, [lines, q, promoter, club])

  const counted = shown.filter(l => !l.excluded)
  const totals = {
    guestlists: counted.filter(l => l.kind === 'guestlist').length,
    purchases: counted.filter(l => l.kind !== 'guestlist').length,
    heads: counted.reduce((s, l) => s + l.heads, 0),
    revenue: counted.reduce((s, l) => s + (l.amount ?? 0), 0),
    excluded: shown.length - counted.length,
  }

  async function exclude(line: Line, scope: 'line' | 'user', reason: string) {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/billing/exclusions', {
        method: 'POST',
        body: JSON.stringify(scope === 'user'
          ? { user_id: line.user_id, reason, label: line.user_name ?? line.user_email }
          : { source: line.source, line_id: line.id, reason, label: `${line.user_name ?? 'guest'} · ${line.club}` }),
      })
      setExcluding(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  async function assign(club_id: string, night: string, brand_id: string | null, label: string) {
    setError(null)
    try {
      await api('/api/portal/billing/assignments', {
        method: 'POST', body: JSON.stringify({ club_id, night, brand_id, label }),
      })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  async function include(line: Line) {
    if (!line.excluded) return
    setError(null)
    try {
      await api(`/api/portal/billing/exclusions?id=${line.excluded.id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Billing</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 620, lineHeight: 1.5 }}>
            Every guestlist and purchase made in the app, by promoter and by club. Mark people
            you brought in (or single entries) as not counting and they drop out of the totals.
          </p>
        </div>
        <select value={period} onChange={e => { setPeriod(e.target.value); setPromoter(null); setClub(null) }} style={{
          background: C.card, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8,
          padding: '9px 12px', fontFamily: font, fontSize: 14,
        }}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <ErrorLine error={error} />
      {d && !d.exclusionsReady && (
        <Card style={{ marginBottom: 18, borderColor: C.gold }}>
          <p style={{ margin: 0, fontSize: 13, color: C.goldHi, fontFamily: font }}>
            &quot;Don&apos;t count&quot; isn&apos;t switched on yet — the billing_exclusions table hasn&apos;t been applied to the database.
            Counts are shown, but nothing can be excluded until it is.
          </p>
        </Card>
      )}
      {!d && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 22 }}>
            <StatTile label="Guestlists" value={totals.guestlists} />
            <StatTile label="Purchases" value={totals.purchases} />
            <StatTile label="People (heads)" value={totals.heads} />
            <StatTile label="Paid in app" value={eur(totals.revenue)} />
            <StatTile label="Not counted" value={totals.excluded} />
          </div>

          <UnassignedCard lines={lines} promoters={d.promoters} ready={d.assignmentsReady} onAssign={assign} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18, marginBottom: 22 }}>
            <TallyCard title="By promoter" rows={byPromoter} active={promoter} onPick={t => setPromoter(promoter?.key === t.key ? null : t)} />
            <TallyCard title="By club" rows={byClub} active={club} onPick={t => setClub(club?.key === t.key ? null : t)} />
          </div>

          <Card>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <p style={{ ...caps, color: C.gold, margin: 0, letterSpacing: '0.14em' }}>Entries · {shown.length}</p>
              {promoter && <Chip label={`Promoter: ${promoter.name}`} onClear={() => setPromoter(null)} />}
              {club && <Chip label={`Club: ${club.name}`} onClear={() => setClub(null)} />}
            </div>
            <TextInput value={q} placeholder="Search guests by name, email or phone — or a club / promoter"
              onChange={e => setQ(e.target.value)} />

            <div style={{ marginTop: 12 }}>
              {shown.length === 0 && (
                <p style={{ color: C.dim, fontSize: 13, fontFamily: font, padding: '14px 0' }}>Nothing matches.</p>
              )}
              {shown.map(l => (
                <div key={`${l.source}:${l.id}`} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1.2fr) auto auto',
                  gap: 14, alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${C.line}`,
                  opacity: l.excluded ? 0.5 : 1, fontFamily: font,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {l.user_name || 'Unknown guest'}
                    </div>
                    <div style={{ fontSize: 12, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[l.user_email, l.user_phone].filter(Boolean).join(' · ') || 'no account details'}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {l.club}
                    </div>
                    <div style={{ fontSize: 12, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {l.promoter}{l.assigned ? ' (assigned)' : ''} · {l.night ?? l.created_at.slice(0, 10)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Badge color={l.kind === 'guestlist' ? C.dim : C.gold}>{KIND_LABEL[l.kind]}</Badge>
                    <div style={{ fontFamily: mono, fontSize: 11.5, color: C.dim, marginTop: 5 }}>
                      {SOURCE_LABEL[l.source]} · {l.heads} {l.heads === 1 ? 'person' : 'people'}
                      {l.amount ? ` · ${eur(l.amount)}` : ''}{l.checked_in ? ' · in' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 118 }}>
                    {l.excluded ? (
                      <>
                        <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 5 }}>
                          Not counted{l.excluded.by === 'user' ? ' (person)' : ''}{l.excluded.reason ? ` · ${l.excluded.reason}` : ''}
                        </div>
                        <Btn small onClick={() => include(l)}>
                          {l.excluded.by === 'user' ? 'Count person again' : 'Count again'}
                        </Btn>
                      </>
                    ) : (
                      <Btn small disabled={!d.exclusionsReady} onClick={() => setExcluding(l)}>Don&apos;t count</Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {excluding && (
        <ExcludeModal line={excluding} busy={busy} onClose={() => setExcluding(null)}
          onConfirm={(scope, reason) => exclude(excluding, scope, reason)}
          personEntries={excluding.user_id ? lines.filter(l => l.user_id === excluding.user_id).length : 0} />
      )}
    </>
  )
}

function TallyCard({ title, rows, active, onPick }: {
  title: string; rows: Tally[]; active: Tally | null; onPick: (t: Tally) => void
}) {
  return (
    <Card>
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 64px 64px 84px', gap: 8,
        ...caps, fontSize: 10, color: C.faint, paddingBottom: 10,
      }}>
        <span style={{ color: C.gold, letterSpacing: '0.14em' }}>{title}</span>
        <span style={{ textAlign: 'right' }}>Lists</span>
        <span style={{ textAlign: 'right' }}>Bought</span>
        <span style={{ textAlign: 'right' }}>Paid</span>
      </div>
      {rows.length === 0 && <p style={{ color: C.dim, fontSize: 13, fontFamily: font }}>Nothing yet.</p>}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {rows.map(t => (
          <button key={t.key} onClick={() => onPick(t)} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 64px 64px 84px', gap: 8, width: '100%',
            alignItems: 'center', textAlign: 'left', cursor: 'pointer', fontFamily: font,
            background: active?.key === t.key ? C.lifted : 'transparent',
            border: 'none', borderTop: `1px solid ${C.line}`, padding: '9px 6px', color: C.text,
          }}>
            <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.name}
              {t.excluded > 0 && <span style={{ fontSize: 11.5, color: C.faint, marginLeft: 6 }}>−{t.excluded}</span>}
            </span>
            <span style={{ fontFamily: mono, fontSize: 13, textAlign: 'right' }}>{t.guestlists}</span>
            <span style={{ fontFamily: mono, fontSize: 13, textAlign: 'right' }}>{t.purchases}</span>
            <span style={{ fontFamily: mono, fontSize: 13, textAlign: 'right', color: t.revenue ? C.text : C.faint }}>
              {eur(t.revenue)}
            </span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button onClick={onClear} style={{
      ...caps, fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer', color: C.goldHi,
      background: 'transparent', border: `1px solid ${C.gold}`, borderRadius: 999, padding: '6px 10px',
    }}>
      {label} ✕
    </button>
  )
}

function ExcludeModal({ line, busy, personEntries, onClose, onConfirm }: {
  line: Line; busy: boolean; personEntries: number
  onClose: () => void; onConfirm: (scope: 'line' | 'user', reason: string) => void
}) {
  const [scope, setScope] = useState<'line' | 'user'>(line.user_id ? 'user' : 'line')
  const [reason, setReason] = useState('')
  const opt = (value: 'line' | 'user', title: string, sub: string, disabled = false) => (
    <button disabled={disabled} onClick={() => setScope(value)} style={{
      display: 'block', width: '100%', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
      background: scope === value ? C.lifted : 'transparent', opacity: disabled ? 0.4 : 1,
      border: `1px solid ${scope === value ? C.gold : C.line}`, borderRadius: 8,
      padding: '11px 12px', marginBottom: 8, fontFamily: font,
    }}>
      <div style={{ fontSize: 13.5, color: C.text }}>{title}</div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{sub}</div>
    </button>
  )
  return (
    <Modal title="Don't count this" onClose={onClose}>
      <p style={{ color: C.dim, fontSize: 13, margin: '0 0 14px', lineHeight: 1.5, fontFamily: font }}>
        <strong style={{ color: C.text }}>{line.user_name || 'Unknown guest'}</strong> · {line.club} · {line.promoter}
      </p>
      {opt('user', 'This person — every entry',
        line.user_id ? `All ${personEntries} entr${personEntries === 1 ? 'y' : 'ies'} this period, and anything they book later.` : 'No account linked to this entry.',
        !line.user_id)}
      {opt('line', 'Just this entry', `Only this ${KIND_LABEL[line.kind].toLowerCase()}.`)}
      <Field label="Reason" hint="optional">
        <TextInput value={reason} maxLength={200} placeholder="Brought in by me / friend / staff / test"
          onChange={e => setReason(e.target.value)} />
      </Field>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => onConfirm(scope, reason)}>
          {busy ? 'Saving…' : "Don't count"}
        </Btn>
      </div>
    </Modal>
  )
}

/** Events (a club on a night) whose entries have no promoter of their own.
 *  Picking a promoter bills every such entry at that club that night to them;
 *  picking "No promoter" undoes it. Assigned events stay listed so they can
 *  be changed. */
function UnassignedCard({ lines, promoters, ready, onAssign }: {
  lines: Line[]; promoters: Promoter[]; ready: boolean
  onAssign: (club_id: string, night: string, brand_id: string | null, label: string) => void
}) {
  const events = useMemo(() => {
    const m = new Map<string, { club_id: string; night: string; club: string; entries: number; heads: number; brand: string | null }>()
    for (const l of lines) {
      if (!l.assignable || !l.club_id || !l.night) continue
      const k = `${l.club_id}|${l.night}`
      const e = m.get(k) ?? { club_id: l.club_id, night: l.night, club: l.club, entries: 0, heads: 0, brand: l.assigned ? l.promoter_key : null }
      e.entries++; e.heads += l.heads
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => Number(!!a.brand) - Number(!!b.brand) || b.night.localeCompare(a.night))
  }, [lines])
  if (!events.length) return null
  const open = events.filter(e => !e.brand).length

  return (
    <Card style={{ marginBottom: 22, borderColor: open ? C.gold : C.line }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <p style={{ ...caps, color: C.gold, margin: 0, letterSpacing: '0.14em' }}>
          Events without a promoter · {open ? `${open} to assign` : 'all assigned'}
        </p>
      </div>
      <p style={{ fontSize: 12.5, color: C.dim, margin: '0 0 12px', fontFamily: font, lineHeight: 1.5 }}>
        Entries here came in with no promoter attached. Assign the event and they count toward that promoter.
      </p>
      {!ready && (
        <p style={{ fontSize: 12.5, color: C.goldHi, margin: '0 0 12px', fontFamily: font }}>
          Assigning isn&apos;t switched on yet — the billing_assignments table hasn&apos;t been applied.
        </p>
      )}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {events.map(e => (
          <div key={`${e.club_id}|${e.night}`} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center',
            padding: '9px 0', borderTop: `1px solid ${C.line}`, fontFamily: font,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.club}</div>
              <div style={{ fontFamily: mono, fontSize: 11.5, color: C.dim }}>
                {e.night} · {e.entries} entr{e.entries === 1 ? 'y' : 'ies'} · {e.heads} {e.heads === 1 ? 'person' : 'people'}
              </div>
            </div>
            <select disabled={!ready} value={e.brand ?? ''}
              onChange={ev => onAssign(e.club_id, e.night, ev.target.value || null, `${e.club} · ${e.night}`)}
              style={{
                background: e.brand ? C.lifted : C.card, color: e.brand ? C.text : C.goldHi,
                border: `1px solid ${e.brand ? C.line : C.gold}`, borderRadius: 8,
                padding: '7px 10px', fontFamily: font, fontSize: 13, minWidth: 180,
              }}>
              <option value="">No promoter — assign…</option>
              {promoters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </Card>
  )
}
