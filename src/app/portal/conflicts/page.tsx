'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, SectionLabel, api, C, caps, font, serif } from '../_ui'
import { shownSuppliers, toggleSupplier } from '@/lib/conflict-rule'

// Who shows what, at every venue — one card per venue + product, with an
// optional per-NIGHT override.
//
// Keyed by venue AND kind (a guestlist and a VIP table are decided separately),
// and within a product a specific night can override the default: Rumba runs
// the door Mon–Fri, Aashi on Saturday. A venue-wide / all-nights rule still
// applies to anything without its own rule, so existing decisions carry forward.
//
// The CLASH badge marks products two suppliers actually compete for. The
// selection is a SET, not a winner — "show these three of five" has to work.

interface Supplier { id: string; name: string; color: string }
interface Rule { mode: 'all' | 'none' | 'selected'; brand_ids: string[] }
interface Conflict {
  club_id:    string
  club_name:  string
  kind:       string
  kind_label: string
  inherited:  boolean
  conflict:   boolean
  rule:       Rule
  day_rules:  Record<string, Rule>   // weekday '0'..'6' → override
  suppliers:  Supplier[]
}

// Display order: Mon-first reads naturally for going out; value is the 0=Sun..6
// index the server keys on.
const NIGHTS: { w: string; label: string }[] = [
  { w: '1', label: 'Mon' }, { w: '2', label: 'Tue' }, { w: '3', label: 'Wed' },
  { w: '4', label: 'Thu' }, { w: '5', label: 'Fri' }, { w: '6', label: 'Sat' },
  { w: '0', label: 'Sun' },
]

export default function ConflictsPage() {
  const [items, setItems] = useState<Conflict[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Conflict[]>('/api/portal/conflicts')
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  return (
    <>
      <h1 style={{ margin: 0, fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
        Who <em style={{ fontStyle: 'italic', color: C.goldHi }}>shows</em> where
      </h1>
      <p style={{ margin: '8px 0 24px', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 640, lineHeight: 1.55 }}>
        Every venue and product with a supplier behind it. Set a default for each, then
        override any night that should differ — Rumba on the door Mon–Fri, Aashi on Saturday.
        <strong style={{ color: C.goldHi, fontWeight: 500 }}> Clash</strong> marks the ones where
        suppliers actually compete.
      </p>

      <ErrorLine error={error} />
      {items === null && !error && (
        <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>
      )}
      {items?.length === 0 && (
        <Card>
          <p style={{ margin: 0, fontSize: 14, color: C.dim, fontFamily: font }}>
            No offers are live yet, so there is nothing to assign.
          </p>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items?.map(c => <ConflictCard key={`${c.club_id}|${c.kind}`} item={c} onSaved={load} />)}
      </div>
    </>
  )
}

// The supplier picker (All / No offers / pick a set). Controlled: reports the
// resulting rule up on every change.
function SupplierPicker({ suppliers, value, onChange }: {
  suppliers: Supplier[]; value: Rule; onChange: (r: Rule) => void
}) {
  const ids = suppliers.map(s => s.id)
  const shown = shownSuppliers(value, ids)
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Choice active={value.mode === 'all'}  onClick={() => onChange({ mode: 'all', brand_ids: [] })}>All suppliers</Choice>
        <Choice active={value.mode === 'none'} onClick={() => onChange({ mode: 'none', brand_ids: [] })}>No offers</Choice>
      </div>
      <p style={{ ...caps, color: C.faint, margin: '14px 0 8px', letterSpacing: '0.12em' }}>or pick who shows</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suppliers.map(s => {
          const on = shown.includes(s.id)
          return (
            <button key={s.id} onClick={() => onChange(toggleSupplier(shown, s.id) as Rule)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                background: on ? C.lifted : 'transparent',
                border: `1px solid ${on ? C.lineHi : C.line}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
              }}>
              <span style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `1px solid ${on ? C.gold : C.lineHi}`, background: on ? C.gold : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#000', fontSize: 11, fontFamily: font, fontWeight: 700,
              }}>{on ? '✓' : ''}</span>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color, flexShrink: 0 }} />
              <span style={{ fontFamily: font, fontSize: 14, color: C.text }}>{s.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

// Short label for a rule, e.g. "all", "none", "Rumba", "2 of 3".
function ruleLabel(rule: Rule, suppliers: Supplier[]): string {
  if (rule.mode === 'all') return `all ${suppliers.length}`
  if (rule.mode === 'none') return 'no offers'
  const inThis = rule.brand_ids.filter(id => suppliers.some(s => s.id === id))
  if (inThis.length === 1) return suppliers.find(s => s.id === inThis[0])?.name ?? '1'
  return `${inThis.length} of ${suppliers.length}`
}

function ConflictCard({ item, onSaved }: { item: Conflict; onSaved: () => void }) {
  const supplierIds = item.suppliers.map(s => s.id)
  // Scope an inherited venue-wide rule to this card's suppliers, or the count
  // reads "2 of 1" and saving would record a supplier that can't appear here.
  const baseline: Rule = {
    mode: item.rule.mode,
    brand_ids: item.rule.brand_ids.filter(id => supplierIds.includes(id)),
  }

  const [rule, setRule] = useState<Rule>(baseline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [showDays, setShowDays] = useState(Object.keys(item.day_rules).length > 0)

  const dirty = rule.mode !== baseline.mode
    || (rule.mode === 'selected' && rule.brand_ids.slice().sort().join() !== baseline.brand_ids.slice().sort().join())

  async function saveDefault() {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/conflicts', {
        method: 'PUT',
        body: JSON.stringify({ club_id: item.club_id, kind: item.kind, weekday: '*', mode: rule.mode, brand_ids: rule.brand_ids }),
      })
      setSaved(true); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    setBusy(false)
  }

  const overrideCount = Object.keys(item.day_rules).length

  return (
    <Card style={item.conflict ? { borderColor: `${C.gold}55` } : undefined}>
      <SectionLabel right={
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {item.conflict && <Badge color={C.goldHi}>Clash</Badge>}
          {overrideCount > 0 && <Badge color={C.gold}>{overrideCount} night{overrideCount === 1 ? '' : 's'} custom</Badge>}
          <Badge color={rule.mode === 'none' ? C.danger : C.gold}>{ruleLabel(rule, item.suppliers)} showing</Badge>
        </span>
      }>
        {item.club_name} · <span style={{ color: C.goldHi }}>{item.kind_label}</span>
      </SectionLabel>

      {item.inherited && (
        <p style={{ margin: '0 0 12px', fontFamily: font, fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
          Currently following this venue&rsquo;s overall rule. Saving here applies to
          {' '}{item.kind_label.toLowerCase()} only and leaves the other products alone.
        </p>
      )}

      <p style={{ ...caps, color: C.gold, margin: '4px 0 10px', letterSpacing: '0.12em' }}>Default — every night</p>
      <SupplierPicker suppliers={item.suppliers} value={rule} onChange={r => { setRule(r); setSaved(false) }} />

      <ErrorLine error={error} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <Btn kind="primary" onClick={saveDefault} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save default'}</Btn>
        {saved && !dirty && <span style={{ fontFamily: font, fontSize: 13, color: C.green }}>Saved</span>}
        <button onClick={() => setShowDays(v => !v)} style={{
          marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: font, fontSize: 13, color: C.dim,
        }}>
          {showDays ? 'Hide nights ▲' : 'Override a night ▾'}
        </button>
      </div>

      {showDays && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {NIGHTS.map(n => (
            <NightRow key={n.w} item={item} night={n} defaultRule={rule} onSaved={onSaved} />
          ))}
        </div>
      )}
    </Card>
  )
}

function NightRow({ item, night, defaultRule, onSaved }: {
  item: Conflict; night: { w: string; label: string }; defaultRule: Rule; onSaved: () => void
}) {
  const supplierIds = item.suppliers.map(s => s.id)
  const override = item.day_rules[night.w]
  const scoped = (r?: Rule): Rule | null => r
    ? { mode: r.mode, brand_ids: r.brand_ids.filter(id => supplierIds.includes(id)) } : null
  const savedRule = scoped(override)

  const [open, setOpen] = useState(false)
  const [rule, setRule] = useState<Rule>(savedRule ?? defaultRule)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/conflicts', {
        method: 'PUT',
        body: JSON.stringify({ club_id: item.club_id, kind: item.kind, weekday: night.w, mode: rule.mode, brand_ids: rule.brand_ids }),
      })
      setOpen(false); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    setBusy(false)
  }
  async function revert() {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/conflicts', {
        method: 'DELETE',
        body: JSON.stringify({ club_id: item.club_id, kind: item.kind, weekday: night.w }),
      })
      setOpen(false); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revert') }
    setBusy(false)
  }

  return (
    <div style={{ border: `1px solid ${savedRule ? `${C.gold}44` : C.line}`, borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
        background: 'transparent', border: 'none', cursor: 'pointer', padding: '9px 12px',
      }}>
        <span style={{ ...caps, fontSize: 11, color: savedRule ? C.goldHi : C.dim, width: 34 }}>{night.label}</span>
        <span style={{ fontFamily: font, fontSize: 13, color: savedRule ? C.text : C.faint }}>
          {savedRule ? ruleLabel(savedRule, item.suppliers) : `follows default (${ruleLabel(defaultRule, item.suppliers)})`}
        </span>
        <span style={{ marginLeft: 'auto', color: C.faint, fontSize: 12 }}>{open ? '▲' : '▾'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px', borderTop: `1px solid ${C.line}` }}>
          <SupplierPicker suppliers={item.suppliers} value={rule} onChange={setRule} />
          <ErrorLine error={error} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <Btn kind="primary" small onClick={save} disabled={busy}>{busy ? '…' : `Save ${night.label}`}</Btn>
            {savedRule && <Btn small onClick={revert} disabled={busy}>Revert to default</Btn>}
          </div>
        </div>
      )}
    </div>
  )
}

function Choice({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} style={{
      fontFamily: font, fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
      background: active ? C.gold : 'transparent', color: active ? '#000' : C.dim,
      border: `1px solid ${active ? C.gold : C.line}`, fontWeight: active ? 600 : 400,
    }}>{children}</button>
  )
}
