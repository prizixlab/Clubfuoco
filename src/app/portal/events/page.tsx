'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PortalEvent } from '@/app/api/portal/events/route'
import {
  Badge, Btn, Card, ErrorLine, Field, Modal, SectionLabel, StatTile, TextInput,
  api, C, caps, font, inputStyle, mono, serif,
} from '../_ui'

// The events desk. Two jobs:
//
//   PIN — choose what heads the consumer Events tab. This is OUR call and is a
//   different column from `featured`, which is promotion a promoter buys. The
//   two are shown side by side here precisely so it stays obvious which is
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
            What the app&rsquo;s Events tab shows, and in what order. A pin is your choice;
            &ldquo;Paid&rdquo; is a promoter&rsquo;s purchased promotion. Pins always rank above paid.
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
              ? 'No upcoming events. Every promoter night on record has already happened, so the app’s Events tab is empty until something is published here or a promoter schedules a new night.'
              : 'Nothing in the past.'}
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {(events ?? []).map(ev => (
          <Row key={ev.id} ev={ev} busy={busy === ev.id}
               onPatch={b => patch(ev.id, b)} onDelete={() => remove(ev)} />
        ))}
      </div>

      {creating && (
        <CreateModal clubs={clubs} onClose={() => setCreating(false)}
                     onDone={() => { setCreating(false); setScope('upcoming'); load() }} />
      )}
    </div>
  )
}

function Row({ ev, busy, onPatch, onDelete }: {
  ev: PortalEvent
  busy: boolean
  onPatch: (b: Record<string, unknown>) => void
  onDelete: () => void
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
