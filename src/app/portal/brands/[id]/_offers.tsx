'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrandRow, OfferRow } from '@/lib/partner'
import { Badge, Btn, Card, DayPicker, ErrorLine, Field, TextInput, inputStyle, api, C, caps, font, mono } from '../../_ui'

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
  const liveCount = offers?.filter(o => o.is_active).length ?? 0
  const inactiveCount = offers ? offers.length - liveCount : 0

  return (
    <section style={{ marginTop: 32 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <span style={{ ...caps, color: C.gold, letterSpacing: '0.14em' }}>
            Offers &amp; venues
            <span style={{ color: C.faint, marginLeft: 10, letterSpacing: '0.1em' }}>
              {offers ? `${liveCount} live${inactiveCount ? ` · ${inactiveCount} inactive` : ''}` : '…'}
            </span>
          </span>
          {otherBrands.length > 0 && <DuplicateFrom brandId={brand.id} sources={otherBrands} onDone={changed} />}
        </div>

        <ErrorLine error={error} />
        {offers && byClub.length === 0 && (
          <p style={{ margin: '4px 0 16px', color: C.dim, fontFamily: font, fontSize: 14 }}>
            No offers yet. Add a venue below{otherBrands.length ? ', or copy another brand’s set' : ''}.
          </p>
        )}

        <div style={{ display: 'grid', gap: 14 }}>
          {byClub.map(([clubId, clubOffers]) => (
            <ClubGroup key={clubId} brandId={brand.id} clubId={clubId} name={clubName(clubId)}
              offers={clubOffers} onChanged={changed} />
          ))}
        </div>

        <ClubPicker
          clubs={clubs.filter(c => !byClub.some(([id]) => id === c.id))}
          onPick={id => setDraftClubs(d => [...d, id])}
        />
      </Card>
    </section>
  )
}

// ── Club picker — dashed "add another venue" block opening a search panel ───
function ClubPicker({ clubs, onPick }: { clubs: Club[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const hits = clubs.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
  return (
    <div style={{ position: 'relative', marginTop: 14 }}>
      <button onClick={() => { setOpen(o => !o); setQ('') }} className="cfp-hover-lift" style={{
        width: '100%', background: 'transparent', border: '1px dashed rgba(255,255,255,0.18)',
        borderRadius: 8, padding: '18px 16px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <span style={{ color: C.goldHi, fontSize: 16, fontFamily: font }} aria-hidden>＋</span>
        <span style={{ ...caps, color: C.dim, letterSpacing: '0.14em' }}>Add another venue</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(100% + 8px)',
          zIndex: 50, width: 320,
          background: C.lifted, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}>
          <TextInput autoFocus placeholder="Search venues…" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
            {hits.map(c => (
              <button key={c.id} onClick={() => { onPick(c.id); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', color: C.text, fontFamily: font, fontSize: 13.5,
                  padding: '9px 8px', borderRadius: 4, cursor: 'pointer',
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
  const [error, setError] = useState<string | null>(null)
  async function run() {
    if (!from || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/portal/brands/${brandId}/offers`, {
        method: 'POST',
        body: JSON.stringify({ duplicate_from: from }),
      })
      setFrom('')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copy failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={from} onChange={e => setFrom(e.target.value)}
        style={{ ...inputStyle, width: 210, padding: '8px 10px', fontSize: 12.5 }}>
        <option value="">Copy offers from another brand…</option>
        {sources.map(b => <option key={b.id} value={b.id}>{b.name} ({b.offer_count})</option>)}
      </select>
      {from && <Btn small onClick={run} disabled={busy}>{busy ? 'Copying…' : 'Copy'}</Btn>}
      {error && <span style={{ fontSize: 12, color: C.danger, fontFamily: font }}>{error}</span>}
    </span>
  )
}

// ── One club's offers — draggable rows + inline add/edit ────────────────────
function ClubGroup({ brandId, clubId, name, offers, onChanged }: {
  brandId: string; clubId: string; name: string; offers: OfferRow[]; onChanged: () => void
}) {
  const [adding, setAdding] = useState(offers.length === 0)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  // Drop `dragged` at `target`'s position, then persist every row whose
  // sort_order changed. Sequential order within the club is all that matters.
  async function reorder(targetId: string) {
    setDragOver(null)
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
    <div style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.line}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: offers.length || adding ? 12 : 0 }}>
        <span style={{ ...caps, color: C.text, letterSpacing: '0.12em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 2v6m-6 3 6-3 6 3M5 22V11m14 11V11M3 22h18" />
          </svg>
          {name}
        </span>
        {!adding && <Btn small onClick={() => setAdding(true)}>Add offer</Btn>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {offers.map(o => (
          <div key={o.id}
            draggable
            onDragStart={() => setDragId(o.id)}
            onDragEnd={() => { setDragId(null); setDragOver(null) }}
            onDragOver={e => { e.preventDefault(); setDragOver(o.id) }}
            onDrop={() => reorder(o.id)}
            style={{
              opacity: dragId === o.id ? 0.35 : 1,
              // Drop indicator — an ember rule above the row being hovered.
              boxShadow: dragOver === o.id && dragId && dragId !== o.id ? `0 -2px 0 0 ${C.gold}` : 'none',
              borderRadius: 8, transition: 'opacity 0.15s',
            }}>
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
    </div>
  )
}

function OfferItem({ offer, onChanged }: { offer: OfferRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const isVip = offer.kind === 'vip_table'

  async function remove() {
    if (!confirm(`Delete "${offer.title}" permanently? (Deactivate keeps the data.)`)) return
    setBusy(true)
    try {
      await api(`/api/portal/offers/${offer.id}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
      setBusy(false)
    }
  }

  // Archive toggle — the data-preserving alternative to Delete. Inactive
  // offers vanish from /api/partner but stay editable here.
  async function setActive(active: boolean) {
    // Deactivating here writes LIVE (no review queue on the admin surface), so
    // one mis-click pulls the offer off the app immediately. Confirm it;
    // reactivating is additive and goes straight through.
    if (!active && !confirm(
      `Deactivate "${offer.title}"?\n\nIt stops being offered on the Club Fuoco app immediately. You can reactivate it any time — the offer's data is kept.`
    )) return
    setBusy(true)
    try {
      await api(`/api/portal/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) })
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed')
    } finally {
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
    <div className="cfp-hover-lift" style={{
      display: 'flex', alignItems: 'center', gap: 13,
      background: C.card, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: '12px 14px', cursor: 'grab',
      opacity: offer.is_active ? 1 : 0.55,
    }}>
      <span title="Drag to reorder" style={{ color: C.faint, fontSize: 14, userSelect: 'none' }} aria-hidden>⠿</span>

      {/* Kind chip — label-caps, outlined, never a filled pill */}
      <span style={{
        ...caps, fontSize: 9.5, color: isVip ? C.goldHi : C.green,
        border: `1px solid ${isVip ? 'rgba(235,192,115,0.35)' : 'rgba(143,214,165,0.3)'}`,
        borderRadius: 4, padding: '5px 7px', flexShrink: 0,
      }}>
        {isVip ? 'VIP' : 'Free'}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, fontFamily: font, color: C.text }}>{offer.title}</span>
          {!offer.is_active && <Badge color={C.faint}>Inactive</Badge>}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: C.dim, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {offer.subtitle} · {offer.valid_days}
        </p>
      </div>

      {isVip && (
        <span style={{ fontFamily: mono, fontSize: 13, color: C.goldHi, flexShrink: 0 }}>
          €{offer.price_eur}
        </span>
      )}

      <span style={{ display: 'inline-flex', gap: 8, flexShrink: 0 }}>
        <Btn small kind="ghost" onClick={() => setEditing(true)} disabled={busy}>Edit</Btn>
        {offer.is_active
          ? <Btn small kind="ghost" onClick={() => setActive(false)} disabled={busy}
              title="Hide from the front page but keep the data">Deactivate</Btn>
          : <Btn small onClick={() => setActive(true)} disabled={busy}>Reactivate</Btn>}
        <Btn small kind="danger" onClick={remove} disabled={busy}>Delete</Btn>
      </span>
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
    <div style={{ background: 'rgba(0,0,0,0.3)', border: `1px dashed rgba(255,255,255,0.18)`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
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
              <TextInput type="number" min={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="300" style={{ fontFamily: mono, fontSize: 13 }} />
            </Field>
          </div>
        )}
        <div style={half}>
          <Field label="Party size">
            <TextInput type="number" min={1} value={partySize} onChange={e => setPartySize(e.target.value)} placeholder={isVip ? '5' : 'optional'} style={{ fontFamily: mono, fontSize: 13 }} />
          </Field>
        </div>
        <div style={half}>
          <Field label="Time window"><TextInput value={timeWindow} maxLength={120} onChange={e => setTimeWindow(e.target.value)} /></Field>
        </div>
      </div>

      <Field label="Valid days" hint="Which nights this offer runs — drives the app’s “Tonight” view.">
        <DayPicker value={validDays} onChange={setValidDays} />
      </Field>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}>
          <Field label="Dress code"><TextInput value={dressCode} maxLength={200} placeholder="Smart casual — no sportswear" onChange={e => setDressCode(e.target.value)} /></Field>
        </div>
        <div style={half}>
          <Field label="Music"><TextInput value={music} maxLength={200} placeholder="Reggaeton · R&B · Top Hits" onChange={e => setMusic(e.target.value)} /></Field>
        </div>
      </div>

      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <Btn small kind="primary" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save offer'}</Btn>
        <Btn small kind="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </div>
  )
}
