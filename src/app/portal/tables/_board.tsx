'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, SectionLabel, TextInput, api, C, caps, font, mono, serif } from '../_ui'

// VIP tables, one product each.
//
// Every listing — one of our promoters' VIP offers, or one Fourvenues zone at
// the venue — is its own product and shows on its own. When two listings are
// the SAME physical table, group them into one table here and choose who gets
// its buy button. Nothing is decided per venue any more: one promoter selling
// a table no longer hides everybody else's.

type Seller = 'auto' | 'offer' | 'fourvenues' | 'none'

interface Offer {
  id: string; title: string; subtitle: string; price_eur: number | null; valid_days: string
  live: boolean; table_id: string | null
  brand: { name: string; color: string; hidden: boolean }
}
interface Zone {
  key: string; name: string; brand_name: string; price_from: number | null
  nights: number; next_night: string | null; table_id: string | null
}
interface Table {
  id: string; name: string; seller: Seller; seller_offer_id: string | null
  effective_seller: Seller; fourvenues_zones: string[]; offer_ids: string[]
}
interface Club { club_id: string; club_name: string; tables: Table[]; offers: Offer[]; zones: Zone[] }
interface Payload { migrated: boolean; catalog: boolean; clubs: Club[] }

const euros = (n: number | null) => n == null ? '—' : `€${Number.isInteger(n) ? n : n.toFixed(2)}`

/**
 * The whole per-table board: shared by /portal/tables and the VIP section of
 * /portal/conflicts, so a table conflict is settled the same way from either.
 * `compact` drops the page heading (the Conflicts page has its own).
 */
export function TablesBoard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [onlyMixed, setOnlyMixed] = useState(compact)

  const load = useCallback(() => {
    api<Payload>('/api/portal/tables')
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  const clubs = useMemo(() => (data?.clubs ?? []).filter(c =>
    (!q || c.club_name.toLowerCase().includes(q.toLowerCase()))
    && (!onlyMixed || (c.offers.length > 0 && c.zones.length > 0) || c.tables.length > 0)
  ), [data, q, onlyMixed])

  return (
    <>
      {!compact && (
      <h1 style={{ margin: 0, fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
        VIP <em style={{ fontStyle: 'italic', color: C.goldHi }}>tables</em>
      </h1>
      )}
      <p style={{ margin: compact ? '0 0 20px' : '8px 0 20px', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 680, lineHeight: 1.55 }}>
        Every table is its own product, whether one of our promoters sells it or Fourvenues does.
        Listings on their own all show. When two listings are the <strong style={{ color: C.goldHi, fontWeight: 500 }}>same
        table</strong>, group them and pick who gets the buy button. The other listings for that table stop showing.
      </p>

      {data && !data.migrated && (
        <Card style={{ borderColor: `${C.danger}66`, marginBottom: 16 }}>
          <p style={{ margin: 0, fontFamily: font, fontSize: 13.5, color: C.danger, lineHeight: 1.5 }}>
            Grouping needs <code style={{ fontFamily: mono }}>supabase/migrations/20261008_table_products.sql</code> applied
            in the SQL editor. Until then every listing shows on its own, which is the safe default.
          </p>
        </Card>
      )}
      {data && !data.catalog && (
        <p style={{ fontFamily: font, fontSize: 13, color: C.faint }}>
          The Fourvenues catalog couldn’t be read just now, so its zones aren’t listed.
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <TextInput placeholder="Search venues" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <label style={{ fontFamily: font, fontSize: 13, color: C.dim, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyMixed} onChange={e => setOnlyMixed(e.target.checked)} />
          Only venues sold by both us and Fourvenues, or already grouped
        </label>
      </div>

      <ErrorLine error={error} />
      {!data && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
      {data && clubs.length === 0 && (
        <Card><p style={{ margin: 0, fontSize: 14, color: C.dim, fontFamily: font }}>No VIP listings match.</p></Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {clubs.map(c => <ClubCard key={c.club_id} club={c} canGroup={!!data?.migrated} onSaved={load} />)}
      </div>
    </>
  )
}

function ClubCard({ club, canGroup, onSaved }: { club: Club; canGroup: boolean; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loose = {
    offers: club.offers.filter(o => !o.table_id),
    zones:  club.zones.filter(z => !z.table_id),
  }
  // Unresolved: a grouped table still showing two sellers, or live tables
  // from us AND Fourvenues at this venue that nobody has compared yet.
  const clashes = club.tables.filter(t => isClash(t, club)).length
  const unchecked = loose.offers.some(o => o.live) && loose.zones.some(z => z.nights > 0)

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true); setError(null)
    try {
      await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    setBusy(false)
  }

  // Add a loose listing to a table (or a new one named after it).
  function addTo(target: string, item: { offer?: Offer; zone?: Zone }) {
    if (target === 'new') {
      const name = item.zone?.name ?? item.offer?.title ?? 'VIP table'
      return call('/api/portal/tables', 'POST', {
        club_id: club.club_id, name,
        ...(item.offer ? { offer_ids: [item.offer.id] } : {}),
        ...(item.zone ? { fourvenues_zones: [item.zone.key] } : {}),
      })
    }
    const t = club.tables.find(x => x.id === target)
    if (!t) return
    return call(`/api/portal/tables/${t.id}`, 'PATCH', item.offer
      ? { offer_ids: [...t.offer_ids, item.offer.id] }
      : { fourvenues_zones: [...t.fourvenues_zones, item.zone!.key] })
  }

  return (
    <Card>
      <SectionLabel right={
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {clashes > 0 && <Badge color={C.danger}>{clashes} clash{clashes === 1 ? '' : 'es'}</Badge>}
          {unchecked && <Badge color={C.goldHi}>Ours + Fourvenues: same table?</Badge>}
          {club.offers.length > 0 && <Badge>{club.offers.length} ours</Badge>}
          {club.zones.length > 0 && <Badge color={C.dim}>{club.zones.length} Fourvenues</Badge>}
          {club.tables.length > 0 && <Badge color={C.goldHi}>{club.tables.length} grouped</Badge>}
        </span>
      }>
        {club.club_name}
      </SectionLabel>

      {club.tables.map(t => (
        <TableBlock key={t.id} table={t} club={club} busy={busy}
          onPatch={body => call(`/api/portal/tables/${t.id}`, 'PATCH', body)}
          onDelete={() => call(`/api/portal/tables/${t.id}`, 'DELETE')} />
      ))}

      {(loose.offers.length > 0 || loose.zones.length > 0) && (
        <>
          <p style={{ ...caps, color: C.faint, margin: '14px 0 8px', letterSpacing: '0.12em' }}>
            Separate products: each shows on its own
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loose.offers.map(o => (
              <Row key={o.id} left={<OfferLabel o={o} />}
                right={canGroup && <AddTo tables={club.tables} disabled={busy} onPick={t => addTo(t, { offer: o })} />} />
            ))}
            {loose.zones.map(z => (
              <Row key={z.key} left={<ZoneLabel z={z} />}
                right={canGroup && <AddTo tables={club.tables} disabled={busy} onPick={t => addTo(t, { zone: z })} />} />
            ))}
          </div>
        </>
      )}
      <ErrorLine error={error} />
    </Card>
  )
}

function TableBlock({ table, club, busy, onPatch, onDelete }: {
  table: Table; club: Club; busy: boolean
  onPatch: (body: Record<string, unknown>) => void; onDelete: () => void
}) {
  const members = club.offers.filter(o => table.offer_ids.includes(o.id))
  const zones = club.zones.filter(z => table.fourvenues_zones.includes(z.key))
  const [name, setName] = useState(table.name)
  const fellBack = table.seller === 'offer' && table.effective_seller === 'auto'
  const clash = isClash(table, club)

  const choices: { key: string; label: string; active: boolean; body: Record<string, unknown> }[] = [
    { key: 'auto', label: 'Every listing', active: table.seller === 'auto', body: { seller: 'auto' } },
    ...members.map(o => ({
      key: o.id, label: `${o.brand.name} · ${euros(o.price_eur)}`,
      active: table.seller === 'offer' && table.seller_offer_id === o.id,
      body: { seller: 'offer', seller_offer_id: o.id },
    })),
    ...(zones.length ? [{ key: 'fv', label: 'Fourvenues', active: table.seller === 'fourvenues', body: { seller: 'fourvenues' } }] : []),
    { key: 'none', label: 'Nobody', active: table.seller === 'none', body: { seller: 'none' } },
  ]

  return (
    <div style={{ border: `1px solid ${clash ? `${C.danger}88` : `${C.gold}44`}`, borderRadius: 10, padding: 14, marginBottom: 10, background: C.lifted }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={name} onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== table.name) onPatch({ name: name.trim() }) }}
          style={{
            flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`,
            color: C.text, fontFamily: font, fontSize: 15, padding: '4px 0', outline: 'none',
          }} />
        {clash && <Badge color={C.danger}>Clash — pick a seller</Badge>}
        <Btn small kind="ghost" disabled={busy} onClick={onDelete} title="Ungroup — every listing becomes its own product again">Ungroup</Btn>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {members.map(o => (
          <Row key={o.id} left={<OfferLabel o={o} />} right={
            <Btn small kind="ghost" disabled={busy}
              onClick={() => onPatch({ offer_ids: table.offer_ids.filter(id => id !== o.id) })}>Remove</Btn>
          } />
        ))}
        {zones.map(z => (
          <Row key={z.key} left={<ZoneLabel z={z} />} right={
            <Btn small kind="ghost" disabled={busy}
              onClick={() => onPatch({ fourvenues_zones: table.fourvenues_zones.filter(k => k !== z.key) })}>Remove</Btn>
          } />
        ))}
        {members.length + zones.length === 0 && (
          <p style={{ margin: 0, fontFamily: font, fontSize: 13, color: C.faint }}>No listings in this table yet.</p>
        )}
      </div>

      <p style={{ ...caps, color: C.gold, margin: '14px 0 8px', letterSpacing: '0.12em' }}>Who gets the buy button</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {choices.map(c => (
          <button key={c.key} disabled={busy || c.active} onClick={() => onPatch(c.body)} style={{
            fontFamily: font, fontSize: 13, padding: '7px 13px', borderRadius: 999,
            cursor: busy || c.active ? 'default' : 'pointer',
            background: c.active ? C.gold : 'transparent', color: c.active ? '#000' : C.dim,
            border: `1px solid ${c.active ? C.gold : C.line}`, fontWeight: c.active ? 600 : 400,
          }}>{c.label}</button>
        ))}
      </div>
      {fellBack && (
        <p style={{ margin: '10px 0 0', fontFamily: font, fontSize: 12.5, color: C.danger }}>
          The chosen listing isn’t live (archived or its promoter is hidden), so every listing shows for now.
        </p>
      )}
    </div>
  )
}

/** A grouped table where more than one seller is still on sale: 'Every
 *  listing' with two or more live listings across us and Fourvenues. */
function isClash(t: Table, club: Club): boolean {
  if (t.effective_seller !== 'auto') return false
  const ours = club.offers.filter(o => t.offer_ids.includes(o.id) && o.live).length
  const fv = club.zones.some(z => t.fourvenues_zones.includes(z.key) && z.nights > 0) ? 1 : 0
  return ours + fv > 1
}

function Row({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      border: `1px solid ${C.line}`, borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>{left}</div>
      {right}
    </div>
  )
}

function OfferLabel({ o }: { o: Offer }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: font, fontSize: 13.5, color: o.live ? C.text : C.faint }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: o.brand.color, flexShrink: 0 }} />
      <span>{o.brand.name}</span>
      <span style={{ color: C.dim }}>· {o.title}</span>
      <span style={{ fontFamily: mono, color: C.goldHi }}>{euros(o.price_eur)}</span>
      <span style={{ color: C.faint, fontSize: 12 }}>{o.valid_days}</span>
      {!o.live && <Badge color={C.faint}>{o.brand.hidden ? 'promoter hidden' : 'archived'}</Badge>}
    </span>
  )
}

function ZoneLabel({ z }: { z: Zone }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: font, fontSize: 13.5, color: z.nights ? C.text : C.faint }}>
      <Badge color={C.dim}>Fourvenues</Badge>
      <span>{z.name}</span>
      <span style={{ fontFamily: mono, color: C.goldHi }}>from {euros(z.price_from)}</span>
      <span style={{ color: C.faint, fontSize: 12 }}>
        {z.nights ? `${z.brand_name} · ${z.nights} night${z.nights === 1 ? '' : 's'} on sale` : 'nothing on sale now'}
      </span>
    </span>
  )
}

function AddTo({ tables, disabled, onPick }: { tables: Table[]; disabled: boolean; onPick: (target: string) => void }) {
  return (
    <select disabled={disabled} value="" onChange={e => { if (e.target.value) onPick(e.target.value) }} style={{
      background: C.card, color: C.dim, border: `1px solid ${C.line}`, borderRadius: 8,
      fontFamily: font, fontSize: 12.5, padding: '6px 8px', cursor: 'pointer',
    }}>
      <option value="">Same table as…</option>
      {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      <option value="new">New table from this</option>
    </select>
  )
}
