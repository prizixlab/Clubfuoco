'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PortalEvent } from '@/app/api/portal/events/route'
import type { DJOption } from '@/app/api/portal/djs/route'
import {
  Badge, Btn, Card, ErrorLine, Field, Modal, SectionLabel, StatTile, TextInput,
  api, C, caps, font, inputStyle, mono, serif,
} from '../_ui'

// The events desk. Two jobs:
//
//   PIN — choose what takes the TIER-1 HERO SPOT at the top of Explore, above
//   every venue shelf. There is no separate Events tab; events live in the one
//   feed. This is OUR call and is a different column from `featured`, which is
//   promotion a promoter buys. Both are shown so it stays obvious which is
//   which: "Pinned" is editorial, "Paid" is billed.
//
//   PUBLISH — run an event ourselves. A house event is an ordinary night with
//   no promoter behind it, so it inherits capacity, guest lists, QR passes and
//   the door pack rather than reimplementing them.

interface ClubOption { id: string; name: string }

function fmtDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return d
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export default function EventsPage() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming')
  const [events, setEvents] = useState<PortalEvent[] | null>(null)
  const [clubs, setClubs] = useState<ClubOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingLineup, setEditingLineup] = useState<PortalEvent | null>(null)
  const [editingHosts, setEditingHosts] = useState<PortalEvent | null>(null)

  const load = useCallback(() => {
    setEvents(null)
    api<{ events: PortalEvent[] }>(`/api/portal/events?scope=${scope}`)
      .then(r => setEvents(r.events))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [scope])
  useEffect(load, [load])

  useEffect(() => {
    api<ClubOption[]>('/api/portal/clubs').then(setClubs).catch(() => {})
  }, [])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setError(null)
    try {
      await api(`/api/portal/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally { setBusy(null) }
  }

  async function remove(ev: PortalEvent) {
    if (!confirm(`Delete “${ev.title ?? 'this event'}”? This cannot be undone.`)) return
    setBusy(ev.id); setError(null)
    try {
      await api(`/api/portal/events/${ev.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally { setBusy(null) }
  }

  const pinned = (events ?? []).filter(e => e.pinned_at)
  const live = (events ?? []).filter(e => e.live)
  const house = (events ?? []).filter(e => e.is_house)

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, margin: '8px 0 24px' }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 34, margin: '0 0 6px', color: C.text }}>Events</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: C.dim, fontFamily: font, maxWidth: 620, lineHeight: 1.5 }}>
            Pinning puts an event in the hero spot at the top of Explore, above every
            venue shelf. A pin is your choice; &ldquo;Paid&rdquo; is a promoter&rsquo;s
            purchased promotion. Pins always rank above paid.
          </p>
        </div>
        <Btn kind="primary" onClick={() => setCreating(true)}>Publish an event</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Live now" value={events ? live.length : '—'} />
        <StatTile label="Pinned" value={events ? pinned.length : '—'} />
        <StatTile label="Ours" value={events ? house.length : '—'} />
      </div>

      <ErrorLine error={error} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {(['upcoming', 'past'] as const).map(s => (
          <Btn key={s} small kind={scope === s ? 'primary' : 'ghost'} onClick={() => setScope(s)}>
            {s === 'upcoming' ? 'Upcoming' : 'Past'}
          </Btn>
        ))}
      </div>

      {events === null && <p style={{ color: C.faint, fontFamily: font, fontSize: 13.5 }}>Loading…</p>}

      {events !== null && events.length === 0 && (
        <Card>
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14, lineHeight: 1.6 }}>
            {scope === 'upcoming'
              ? 'No upcoming events. Every promoter night on record has already happened, so Explore shows no event hero until something is published here or a promoter schedules a new night.'
              : 'Nothing in the past.'}
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {(events ?? []).map(ev => (
          <Row key={ev.id} ev={ev} busy={busy === ev.id}
               onPatch={b => patch(ev.id, b)} onDelete={() => remove(ev)}
               onEditLineup={() => setEditingLineup(ev)}
               onEditHosts={() => setEditingHosts(ev)} />
        ))}
      </div>

      {creating && (
        <CreateModal clubs={clubs} onClose={() => setCreating(false)}
                     onDone={() => { setCreating(false); setScope('upcoming'); load() }} />
      )}

      {editingHosts && (
        <HostsModal ev={editingHosts} onClose={() => setEditingHosts(null)}
                    onSave={async next => {
                      await patch(editingHosts.id, { hosts: next })
                      setEditingHosts(null)
                    }} />
      )}

      {editingLineup && (
        <LineupModal ev={editingLineup} onClose={() => setEditingLineup(null)}
                     onSave={async next => {
                       await patch(editingLineup.id, { lineup: next })
                       setEditingLineup(null)
                     }} />
      )}
    </div>
  )
}

function Row({ ev, busy, onPatch, onDelete, onEditLineup, onEditHosts }: {
  ev: PortalEvent
  busy: boolean
  onPatch: (b: Record<string, unknown>) => void
  onDelete: () => void
  onEditLineup: () => void
  onEditHosts: () => void
}) {
  const isPinned = !!ev.pinned_at
  return (
    <div style={{
      background: C.card,
      // A pinned row is outlined in ember so the top of the feed is visible at
      // a glance rather than needing the badges read.
      border: `1px solid ${isPinned ? C.gold : C.line}`,
      borderRadius: 8, padding: '16px 18px',
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 92 }}>
        <div style={{ ...caps, color: C.gold, fontSize: 10, marginBottom: 4 }}>{fmtDate(ev.night_date)}</div>
        <div style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>{ev.night_date}</div>
      </div>

      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontFamily: font, fontSize: 15.5, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {ev.title ?? <span style={{ color: C.faint }}>Untitled</span>}
        </div>
        <div style={{ fontFamily: font, fontSize: 12.5, color: C.dim }}>
          {ev.club_name ?? ev.location_name ?? 'No venue set'}
          {' · '}{ev.total_capacity} cap
        </div>
        {ev.hosts.length > 0 && (
          <div style={{ fontFamily: font, fontSize: 12, color: C.dim, marginTop: 5 }}>
            Hosted by {ev.hosts.map(h => h.name).join(' × ')}
          </div>
        )}
        {ev.lineup.length > 0 && (
          <div style={{ fontFamily: font, fontSize: 12.5, color: C.text, marginTop: 5 }}>
            {ev.lineup.map(c => c.name).join(', ')}
          </div>
        )}
        {ev.pin_note && (
          <div style={{ fontFamily: font, fontSize: 12, color: C.faint, marginTop: 6, fontStyle: 'italic' }}>
            {ev.pin_note}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {isPinned && <Badge>Pinned{ev.pin_rank != null ? ` #${ev.pin_rank}` : ''}</Badge>}
        {ev.featured && <Badge color={C.goldHi}>Paid</Badge>}
        {ev.is_house && <Badge color={C.green}>Ours</Badge>}
        {!ev.live && (
          <Badge color={C.danger}>
            {!ev.is_published ? 'Unpublished'
              : ev.review_status !== 'approved' ? ev.review_status
              : ev.visibility !== 'public' ? ev.visibility
              : 'Past'}
          </Badge>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn small kind={isPinned ? 'ghost' : 'primary'} disabled={busy}
             onClick={() => onPatch({ pinned: !isPinned })}>
          {isPinned ? 'Unpin' : 'Pin'}
        </Btn>
        {isPinned && (
          <input
            type="number" min={0} placeholder="rank"
            defaultValue={ev.pin_rank ?? ''}
            disabled={busy}
            onBlur={e => {
              const raw = e.target.value.trim()
              const next = raw === '' ? null : Number(raw)
              if (next !== (ev.pin_rank ?? null)) onPatch({ pin_rank: next })
            }}
            className="cfp-input"
            style={{ ...inputStyle, width: 74, padding: '7px 9px', fontSize: 12.5 }}
          />
        )}
        <Btn small kind="ghost" disabled={busy} onClick={onEditLineup}>
          {ev.lineup.length > 0 ? 'Line-up' : 'Add DJs'}
        </Btn>
        <Btn small kind="ghost" disabled={busy} onClick={onEditHosts}>
          Hosts
        </Btn>
        <Btn small kind="ghost" disabled={busy}
             onClick={() => onPatch({ is_published: !ev.is_published })}>
          {ev.is_published ? 'Unpublish' : 'Publish'}
        </Btn>
        {ev.is_house && (
          <Btn small kind="danger" disabled={busy} onClick={onDelete}>Delete</Btn>
        )}
      </div>
    </div>
  )
}


type Credit = { id: string | null; name: string }

// DJ line-up picker. Searches the ~3,200-row catalogue by name and stores
// {id, name} where id is the RA artist id — the same key djs.ra_artist_id
// uses, so a credit resolves to a real artist instead of a typed string.
//
// Order is the billing order, so credits can be moved up and down; the API
// replaces the whole list rather than appending.
function LineupPicker({ value, onChange, source = 'djs', label = 'Line-up' }: {
  value: Credit[]
  onChange: (next: Credit[]) => void
  /** 'djs' searches the artist catalogue; 'brands' searches the promoter roster. */
  source?: 'djs' | 'brands'
  label?: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DJOption[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    // Debounced: this fires per keystroke otherwise, and the catalogue query
    // is an ILIKE across every row.
    timer.current = setTimeout(() => {
      setSearching(true)
      const req = source === 'brands'
        // The roster is a handful of rows, so it is fetched whole and filtered
        // here rather than given its own search endpoint.
        ? api<{ id: string; name: string; logo_url: string | null }[]>('/api/portal/brands')
            .then(bs => bs
              .filter(b => b.name.toLowerCase().includes(term.toLowerCase()))
              .slice(0, 20)
              .map(b => ({ id: b.id, name: b.name, image_url: b.logo_url, followers: null })))
        : api<{ djs: DJOption[] }>(`/api/portal/djs?q=${encodeURIComponent(term)}`).then(r => r.djs)
      req.then(setResults).catch(() => setResults([])).finally(() => setSearching(false))
    }, 220)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, source])

  function add(dj: DJOption) {
    if (value.some(c => c.id === dj.id)) return
    onChange([...value, { id: dj.id, name: dj.name }])
    setQ(''); setResults([])
  }

  function addFreeText() {
    const name = q.trim()
    if (!name) return
    onChange([...value, { id: null, name }])
    setQ(''); setResults([])
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    onChange(next)
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <span style={{ ...caps, display: 'block', color: C.dim, marginBottom: 8 }}>{label}</span>

      {value.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {value.map((c, i) => (
            <div key={`${c.id ?? 'x'}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: C.lifted, border: `1px solid ${C.line}`,
              borderRadius: 6, padding: '8px 10px',
            }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, width: 16 }}>{i + 1}</span>
              <span style={{ flex: 1, fontFamily: font, fontSize: 13.5, color: C.text }}>{c.name}</span>
              {!c.id && (
                <span style={{ ...caps, fontSize: 9, color: C.faint }} title="Not in the DJ catalogue — will not link to a DJ page">
                  free text
                </span>
              )}
              <Btn small kind="ghost" onClick={() => move(i, i - 1)} disabled={i === 0}>&uarr;</Btn>
              <Btn small kind="ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1}>&darr;</Btn>
              <Btn small kind="danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Btn>
            </div>
          ))}
        </div>
      )}

      <TextInput
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={source === 'brands' ? 'Search promoters, or type a name…' : 'Search DJs by name…'}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (results[0]) add(results[0]); else addFreeText() } }}
      />

      {q.trim().length >= 2 && (
        <div style={{
          marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 6,
          background: C.lifted, maxHeight: 220, overflowY: 'auto',
        }}>
          {searching && <div style={{ padding: 10, fontSize: 12.5, color: C.faint, fontFamily: font }}>Searching…</div>}
          {!searching && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 12.5, color: C.faint, fontFamily: font }}>
              No match.{' '}
              <button type="button" onClick={addFreeText}
                style={{ background: 'none', border: 'none', color: C.gold, cursor: 'pointer', font: 'inherit', padding: 0 }}>
                Add &ldquo;{q.trim()}&rdquo; anyway
              </button>
            </div>
          )}
          {results.map(dj => (
            <button key={dj.id} type="button" onClick={() => add(dj)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                background: 'none', border: 'none', borderBottom: `1px solid ${C.line}`,
                padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
              }}>
              <span style={{
                width: 26, height: 26, borderRadius: 13, flexShrink: 0,
                background: dj.image_url ? `center/cover url(${JSON.stringify(dj.image_url)})` : C.card,
                border: `1px solid ${C.line}`,
              }} />
              <span style={{ flex: 1, fontFamily: font, fontSize: 13.5, color: C.text }}>{dj.name}</span>
              {dj.followers != null && (
                <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>
                  {dj.followers.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateModal({ clubs, onClose, onDone }: {
  clubs: ClubOption[]; onClose: () => void; onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [clubId, setClubId] = useState('')
  const [locationName, setLocationName] = useState('')
  const [address, setAddress] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState('100')
  const [openTime, setOpenTime] = useState('')
  const [closeTime, setCloseTime] = useState('')
  const [lineup, setLineup] = useState<Credit[]>([])
  const [hosts, setHosts] = useState<Credit[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setError(null)
    try {
      await api('/api/portal/events', {
        method: 'POST',
        body: JSON.stringify({
          title, night_date: date,
          club_id: clubId || null,
          location_name: locationName || null,
          address: address || null,
          description: description || null,
          total_capacity: Number(capacity),
          lineup,
          hosts,
          open_time: openTime || null,
          close_time: closeTime || null,
        }),
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish')
      setSaving(false)
    }
  }

  return (
    <Modal title="Publish an event" onClose={onClose} width={560}>
      <SectionLabel>Ours to run</SectionLabel>
      <p style={{ margin: '-8px 0 20px', fontSize: 12.5, color: C.faint, fontFamily: font, lineHeight: 1.55 }}>
        Goes live immediately &mdash; no review queue, because the queue exists to check
        promoters&rsquo; submissions. It is always free to attend: with no promoter there is no
        Stripe account to pay, so a price would fail at the guest&rsquo;s checkout.
      </p>

      <Field label="Title">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Low Light Sessions" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label="Capacity">
          <TextInput type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />
        </Field>
      </div>

      <Field label="Venue" hint="Pick one of our venues, or leave blank and name the location below.">
        <select value={clubId} onChange={e => setClubId(e.target.value)}
                className="cfp-input" style={{ ...inputStyle }}>
          <option value="">— No venue —</option>
          {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      {!clubId && (
        <>
          <Field label="Location name">
            <TextInput value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="Rooftop, Poblenou" />
          </Field>
          <Field label="Address">
            <TextInput value={address} onChange={e => setAddress(e.target.value)} />
          </Field>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Doors"><TextInput type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} /></Field>
        <Field label="Closes"><TextInput type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} /></Field>
      </div>

      <LineupPicker value={hosts} onChange={setHosts} source="brands"
                    label="Hosted by" />

      <LineupPicker value={lineup} onChange={setLineup} />

      <Field label="Description">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                  className="cfp-input" style={{ ...inputStyle, resize: 'vertical' }} />
      </Field>

      <ErrorLine error={error} />

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={saving || !title.trim() || !date} onClick={submit}>
          {saving ? 'Publishing…' : 'Publish'}
        </Btn>
      </div>
    </Modal>
  )
}

/// Edit an existing event's billing. Works on promoter nights as well as house
/// events — adding a DJ is a listing correction, not a change to whose event it
/// is, so it is not restricted to `is_house` the way delete is.
function LineupModal({ ev, onClose, onSave }: {
  ev: PortalEvent; onClose: () => void; onSave: (next: Credit[]) => Promise<void>
}) {
  const [lineup, setLineup] = useState<Credit[]>(ev.lineup)
  const [saving, setSaving] = useState(false)

  return (
    <Modal title={`Line-up — ${ev.title ?? 'Untitled'}`} onClose={onClose} width={520}>
      <LineupPicker value={lineup} onChange={setLineup} />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={saving}
             onClick={async () => { setSaving(true); await onSave(lineup) }}>
          {saving ? 'Saving…' : 'Save line-up'}
        </Btn>
      </div>
    </Modal>
  )
}

/// Edit who runs the night. Same picker as the line-up, pointed at the promoter
/// roster instead of the DJ catalogue, because a host is usually a brand we
/// already know — and storing its id is what lets a host resolve to that
/// brand's logo and attribution clause later.
function HostsModal({ ev, onClose, onSave }: {
  ev: PortalEvent; onClose: () => void; onSave: (next: Credit[]) => Promise<void>
}) {
  const [hosts, setHosts] = useState<Credit[]>(ev.hosts)
  const [saving, setSaving] = useState(false)

  return (
    <Modal title={`Hosts — ${ev.title ?? 'Untitled'}`} onClose={onClose} width={520}>
      <LineupPicker value={hosts} onChange={setHosts} source="brands" label="Hosted by" />
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={saving}
             onClick={async () => { setSaving(true); await onSave(hosts) }}>
          {saving ? 'Saving…' : 'Save hosts'}
        </Btn>
      </div>
    </Modal>
  )
}
