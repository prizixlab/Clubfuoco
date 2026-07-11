'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrandRow, OfferRow } from '@/lib/partner'
import { Btn, Card, ErrorLine, Field, TextInput, inputStyle, api, C, font, mono } from '../../_ui'

interface Club { id: string; name: string }

// Offers editor — the brand's per-club offer set, grouped by club. Add a club
// via the searchable picker, edit/remove offers inline, drag to reorder within
// a club, or bulk-copy another brand's offers to stand up a new partner fast.
export default function OffersEditor({ brand, onOffersChanged }: {
  brand: BrandRow
  onOffersChanged: () => void
}) {
  const [offers, setOffers] = useState<OfferRow[] | null>(null)
  const [clubs, setClubs]   = useState<Club[]>([])
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [error, setError]   = useState<string | null>(null)
  // Clubs with a section open but no saved offers yet (fresh from the picker).
  const [draftClubs, setDraftClubs] = useState<string[]>([])

  const load = useCallback(() => {
    api<OfferRow[]>(`/api/portal/brands/${brand.id}/offers`)
      .then(setOffers)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load offers'))
  }, [brand.id])

  useEffect(load, [load])
  useEffect(() => {
    api<Club[]>('/api/portal/clubs').then(setClubs).catch(() => setClubs([]))
    api<BrandRow[]>('/api/portal/brands').then(setBrands).catch(() => setBrands([]))
  }, [])

  const clubName = useMemo(() => {
    const m = new Map(clubs.map(c => [c.id, c.name]))
    return (id: string) => m.get(id) ?? id
  }, [clubs])

  const byClub = useMemo(() => {
    const m = new Map<string, OfferRow[]>()
    for (const o of offers ?? []) {
      if (!m.has(o.club_id)) m.set(o.club_id, [])
      m.get(o.club_id)!.push(o)
    }
    for (const id of draftClubs) if (!m.has(id)) m.set(id, [])
    return [...m.entries()].sort((a, b) => clubName(a[0]).localeCompare(clubName(b[0])))
  }, [offers, draftClubs, clubName])

  function changed() {
    load()
    onOffersChanged()
  }

  const otherBrands = brands.filter(b => b.id !== brand.id && b.offer_count > 0)

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: font }}>
          Offers <span style={{ color: C.faint, fontWeight: 400 }}>· {offers?.length ?? '…'}</span>
        </h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {otherBrands.length > 0 && <DuplicateFrom brandId={brand.id} sources={otherBrands} onDone={changed} />}
          <ClubPicker
            clubs={clubs.filter(c => !byClub.some(([id]) => id === c.id))}
            onPick={id => setDraftClubs(d => [...d, id])}
          />
        </div>
      </div>

      <ErrorLine error={error} />
      {offers && byClub.length === 0 && (
        <Card>
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>
            No offers yet. Pick a venue to add the first one{otherBrands.length ? ', or copy another brand’s set' : ''}.
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {byClub.map(([clubId, clubOffers]) => (
          <ClubGroup key={clubId} brandId={brand.id} clubId={clubId} name={clubName(clubId)}
            offers={clubOffers} onChanged={changed} />
        ))}
      </div>
    </section>
  )
}

// ── Club picker — searchable dropdown over the clubs table ──────────────────
function ClubPicker({ clubs, onPick }: { clubs: Club[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const hits = clubs.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
  return (
    <div style={{ position: 'relative' }}>
      <Btn kind="primary" onClick={() => { setOpen(o => !o); setQ('') }}>Add venue</Btn>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 280,
          background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          <TextInput autoFocus placeholder="Search venues…" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
            {hits.map(c => (
              <button key={c.id} onClick={() => { onPick(c.id); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', color: C.text, fontFamily: font, fontSize: 13.5,
                  padding: '8px 8px', borderRadius: 8, cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                {c.name}
              </button>
            ))}
            {hits.length === 0 && <p style={{ margin: 8, fontSize: 12.5, color: C.faint, fontFamily: font }}>No matches.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Duplicate another brand's offers ─────────────────────────────────────────
function DuplicateFrom({ brandId, sources, onDone }: {
  brandId: string; sources: BrandRow[]; onDone: () => void
}) {
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    if (!from || busy) return
    setBusy(true)
    try {
      await api(`/api/portal/brands/${brandId}/offers`, {
        method: 'POST',
        body: JSON.stringify({ duplicate_from: from }),
      })
      setFrom('')
      onDone()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Copy failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <select value={from} onChange={e => setFrom(e.target.value)}
        style={{ ...inputStyle, width: 190, padding: '8px 10px', fontSize: 13 }}>
        <option value="">Copy offers from…</option>
        {sources.map(b => <option key={b.id} value={b.id}>{b.name} ({b.offer_count})</option>)}
      </select>
      {from && <Btn small onClick={run} disabled={busy}>{busy ? 'Copying…' : 'Copy'}</Btn>}
    </span>
  )
}

// ── One club's offers — draggable rows + inline add/edit ────────────────────
function ClubGroup({ brandId, clubId, name, offers, onChanged }: {
  brandId: string; clubId: string; name: string; offers: OfferRow[]; onChanged: () => void
}) {
  const [adding, setAdding] = useState(offers.length === 0)
  const [dragId, setDragId] = useState<string | null>(null)

  // Drop `dragged` at `target`'s position, then persist every row whose
  // sort_order changed. Sequential order within the club is all that matters.
  async function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return
    const ids = offers.map(o => o.id)
    const fromIdx = ids.indexOf(dragId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...offers]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    const patches = next
      .map((o, i) => ({ id: o.id, sort_order: i, changed: o.sort_order !== i }))
      .filter(p => p.changed)
    try {
      await Promise.all(patches.map(p =>
        api(`/api/portal/offers/${p.id}`, { method: 'PATCH', body: JSON.stringify({ sort_order: p.sort_order }) })
      ))
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reorder failed')
    }
  }

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: offers.length || adding ? 12 : 0 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, fontFamily: font }}>{name}</h3>
        {!adding && <Btn small onClick={() => setAdding(true)}>Add offer</Btn>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {offers.map(o => (
          <div key={o.id}
            draggable
            onDragStart={() => setDragId(o.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => reorder(o.id)}
            style={{ opacity: dragId === o.id ? 0.4 : 1 }}>
            <OfferItem offer={o} onChanged={onChanged} />
          </div>
        ))}
      </div>

      {adding && (
        <div style={{ marginTop: offers.length ? 12 : 0 }}>
          <OfferForm
            initial={{ club_id: clubId, sort_order: offers.length }}
            onCancel={() => setAdding(false)}
            onSave={async draft => {
              await api(`/api/portal/brands/${brandId}/offers`, { method: 'POST', body: JSON.stringify(draft) })
              setAdding(false)
              onChanged()
            }}
          />
        </div>
      )}
    </Card>
  )
}

function OfferItem({ offer, onChanged }: { offer: OfferRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const isVip = offer.kind === 'vip_table'

  async function remove() {
    if (!confirm(`Delete "${offer.title}"?`)) return
    setBusy(true)
    try {
      await api(`/api/portal/offers/${offer.id}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <OfferForm
        initial={offer}
        onCancel={() => setEditing(false)}
        onSave={async draft => {
          const { club_id: _c, sort_order: _s, ...patch } = draft
          await api(`/api/portal/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
          setEditing(false)
          onChanged()
        }}
      />
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.line}`,
      borderRadius: 10, padding: '10px 12px', cursor: 'grab',
    }}>
      <span title="Drag to reorder" style={{ color: C.faint, fontSize: 14, userSelect: 'none' }}>⠿</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, fontFamily: font }}>{offer.title}</span>
          <span style={{ fontSize: 11, color: isVip ? C.gold : C.green, fontFamily: mono }}>
            {isVip ? `VIP · €${offer.price_eur}` : 'FREE'}
          </span>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: C.dim, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {offer.subtitle} · {offer.valid_days}
        </p>
      </div>
      <Btn small kind="ghost" onClick={() => setEditing(true)} disabled={busy}>Edit</Btn>
      <Btn small kind="danger" onClick={remove} disabled={busy}>Delete</Btn>
    </div>
  )
}

// ── Offer form (create + edit) ───────────────────────────────────────────────
type Draft = {
  club_id:     string
  kind:        'free_guestlist' | 'vip_table'
  title:       string
  subtitle:    string
  price_eur:   number | null
  party_size:  number | null
  time_window: string
  valid_days:  string
  dress_code:  string
  music:       string
  sort_order?: number
}

function OfferForm({ initial, onSave, onCancel }: {
  initial: Partial<Draft> & { club_id: string }
  onSave: (draft: Draft) => Promise<void>
  onCancel: () => void
}) {
  const [kind, setKind]           = useState<Draft['kind']>(initial.kind ?? 'free_guestlist')
  const isVip = kind === 'vip_table'
  const [title, setTitle]         = useState(initial.title ?? (initial.kind === 'vip_table' ? 'VIP Table' : 'Free Guestlist'))
  const [subtitle, setSubtitle]   = useState(initial.subtitle ?? '')
  const [price, setPrice]         = useState(initial.price_eur?.toString() ?? '')
  const [partySize, setPartySize] = useState(initial.party_size?.toString() ?? '')
  const [timeWindow, setTimeWindow] = useState(initial.time_window ?? 'Door open till closing')
  const [validDays, setValidDays] = useState(initial.valid_days ?? '')
  const [dressCode, setDressCode] = useState(initial.dress_code ?? '')
  const [music, setMusic]         = useState(initial.music ?? '')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  function switchKind(k: Draft['kind']) {
    setKind(k)
    // Only swap the default titles — keep anything the operator typed.
    if (title === 'Free Guestlist' || title === 'VIP Table') {
      setTitle(k === 'vip_table' ? 'VIP Table' : 'Free Guestlist')
    }
    if (k === 'vip_table' && timeWindow === 'Door open till closing') setTimeWindow('Reservation for the night')
    if (k === 'free_guestlist' && timeWindow === 'Reservation for the night') setTimeWindow('Door open till closing')
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave({
        club_id:     initial.club_id,
        kind,
        title:       title.trim(),
        subtitle:    subtitle.trim(),
        price_eur:   isVip ? Number(price) : null,
        party_size:  partySize ? Number(partySize) : null,
        time_window: timeWindow.trim(),
        valid_days:  validDays.trim(),
        dress_code:  dressCode.trim(),
        music:       music.trim(),
        ...(initial.sort_order !== undefined ? { sort_order: initial.sort_order } : {}),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setBusy(false)
    }
  }

  const valid =
    title.trim() && subtitle.trim() && validDays.trim() && dressCode.trim() &&
    music.trim() && timeWindow.trim() && (!isVip || (Number(price) > 0))

  const half: React.CSSProperties = { flex: 1, minWidth: 150 }

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Btn small kind={!isVip ? 'primary' : 'ghost'} onClick={() => switchKind('free_guestlist')}>Free Guestlist</Btn>
        <Btn small kind={isVip ? 'primary' : 'ghost'} onClick={() => switchKind('vip_table')}>VIP Table</Btn>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}>
          <Field label="Title"><TextInput value={title} maxLength={60} onChange={e => setTitle(e.target.value)} /></Field>
        </div>
        <div style={{ ...half, flex: 2 }}>
          <Field label="Subtitle" hint={isVip ? 'e.g. “From €300 · 5 people · Fully consumable on bottles”' : 'e.g. “Free till 1:00 AM”'}>
            <TextInput value={subtitle} maxLength={200} onChange={e => setSubtitle(e.target.value)} />
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {isVip && (
          <div style={half}>
            <Field label="Price (EUR)">
              <TextInput type="number" min={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="300" />
            </Field>
          </div>
        )}
        <div style={half}>
          <Field label="Party size">
            <TextInput type="number" min={1} value={partySize} onChange={e => setPartySize(e.target.value)} placeholder={isVip ? '5' : 'optional'} />
          </Field>
        </div>
        <div style={half}>
          <Field label="Time window"><TextInput value={timeWindow} maxLength={120} onChange={e => setTimeWindow(e.target.value)} /></Field>
        </div>
        <div style={half}>
          <Field label="Valid days"><TextInput value={validDays} maxLength={120} placeholder="Tue, Thu – Sun" onChange={e => setValidDays(e.target.value)} /></Field>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}>
          <Field label="Dress code"><TextInput value={dressCode} maxLength={200} placeholder="Smart casual — no sportswear" onChange={e => setDressCode(e.target.value)} /></Field>
        </div>
        <div style={half}>
          <Field label="Music"><TextInput value={music} maxLength={200} placeholder="Reggaeton · R&B · Top Hits" onChange={e => setMusic(e.target.value)} /></Field>
        </div>
      </div>

      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <Btn small kind="primary" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save offer'}</Btn>
        <Btn small kind="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </div>
  )
}
