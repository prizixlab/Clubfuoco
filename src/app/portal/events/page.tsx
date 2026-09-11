'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/// Everything about one event, flattened into one lowercase string to match
/// against: title, venue (ours and RA's spelling of it), every stop on a
/// route, hosts, the line-up, the pin note, the door price — and the date in
/// every form somebody might type it.
///
/// The date is the reason this is a string rather than a field-by-field
/// compare. "2026-09-11", "fri 11 sep", "11 september 2026" and "september"
/// are all the same night to the person searching, so all of them go in.
function haystack(ev: PortalEvent): string {
  const parts: (string | null | undefined)[] = [
    ev.title,
    ev.club_name,
    ev.location_name,
    ...ev.stops.map(s => s.name),
    ...ev.hosts.map(h => h.name),
    ...ev.lineup.map(c => c.name),
    ev.pin_note,
    ev.cost_label,
    ev.source === 'scraped' ? 'ra scraped' : 'ours',
    ev.is_house ? 'house ours' : null,
    ev.featured ? 'paid featured' : null,
    ev.pinned_at ? 'pinned' : null,
    ev.night_date,
    fmtDate(ev.night_date),
  ]
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ev.night_date)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    parts.push(
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      d.toLocaleDateString('en-US', { month: 'long' }),
    )
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/// Every term must appear somewhere in the row, so "opium saturday" narrows
/// rather than widening — the way a person expects two words to behave.
function matches(hay: string, terms: string[]): boolean {
  return terms.every(t => hay.includes(t))
}

type SourceFilter = 'all' | 'ours' | 'scraped'

export default function EventsPage() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming')
  const [source, setSource] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<PortalEvent[] | null>(null)
  const [clubs, setClubs] = useState<ClubOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingLineup, setEditingLineup] = useState<PortalEvent | null>(null)
  const [editingHosts, setEditingHosts] = useState<PortalEvent | null>(null)
  const [editingRoute, setEditingRoute] = useState<PortalEvent | null>(null)

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
  const ours = (events ?? []).filter(e => e.source === 'ours')
  const scraped = (events ?? []).filter(e => e.source === 'scraped')
  const bySource = source === 'all' ? (events ?? []) : source === 'ours' ? ours : scraped

  // Search runs over the whole loaded scope, client-side: the rows are already
  // here, so filtering as you type costs nothing and beats a round trip per
  // keystroke. Re-indexed only when the event list itself changes.
  const index = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of events ?? []) m.set(e.id, haystack(e))
    return m
  }, [events])

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = terms.length === 0
    ? bySource
    : bySource.filter(e => matches(index.get(e.id) ?? '', terms))

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
        <StatTile label="Scraped" value={events ? scraped.length : '—'} />
      </div>

      <ErrorLine error={error} />

      {/* One box over everything on the row: title, venue, host, line-up, the
          door price, and the date in whatever form you'd type it. */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <TextInput
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, club, host, DJ, date…"
          aria-label="Search events"
          style={{ padding: '12px 96px 12px 14px' }}
        />
        <div style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none',
        }}>
          {terms.length > 0 && (
            <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>
              {shown.length}
            </span>
          )}
          {query !== '' && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                color: C.dim, fontSize: 15, lineHeight: 1, padding: 4, fontFamily: font,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['upcoming', 'past'] as const).map(s => (
          <Btn key={s} small kind={scope === s ? 'primary' : 'ghost'} onClick={() => setScope(s)}>
            {s === 'upcoming' ? 'Upcoming' : 'Past'}
          </Btn>
        ))}
        {/* Ours is a handful, the scrape is hundreds — without this split the
            four nights we actually run are lost in the listing. */}
        <span style={{ width: 1, height: 20, background: C.line, margin: '0 4px' }} />
        {([
          ['all', `All${events ? ` ${events.length}` : ''}`],
          ['ours', `Ours${events ? ` ${ours.length}` : ''}`],
          ['scraped', `Scraped${events ? ` ${scraped.length}` : ''}`],
        ] as const).map(([key, label]) => (
          <Btn key={key} small kind={source === key ? 'primary' : 'ghost'} onClick={() => setSource(key)}>
            {label}
          </Btn>
        ))}
      </div>

      {events === null && <p style={{ color: C.faint, fontFamily: font, fontSize: 13.5 }}>Loading…</p>}

      {/* A search that finds nothing is a different answer from an empty desk,
          and says which of the two filters is hiding the rows. */}
      {events !== null && events.length > 0 && shown.length === 0 && (
        <Card>
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14, lineHeight: 1.6 }}>
            Nothing matches <strong style={{ color: C.text }}>{query}</strong>
            {source !== 'all' && <> in <strong style={{ color: C.text }}>{source}</strong></>}.
            {' '}
            <button onClick={() => { setQuery(''); setSource('all') }} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: C.gold, fontFamily: font, fontSize: 14, textDecoration: 'underline',
            }}>Clear the filters</button>
            {' '}or try the {scope === 'upcoming' ? 'past' : 'upcoming'} scope.
          </p>
        </Card>
      )}

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
        {shown.map(ev => (
          <Row key={ev.id} ev={ev} busy={busy === ev.id}
               onPatch={b => patch(ev.id, b)} onDelete={() => remove(ev)}
               onEditLineup={() => setEditingLineup(ev)}
               onEditHosts={() => setEditingHosts(ev)}
               onEditRoute={() => setEditingRoute(ev)} />
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

      {editingRoute && (
        <RouteModal ev={editingRoute} clubs={clubs} onClose={() => setEditingRoute(null)}
                    onSave={async next => {
                      await patch(editingRoute.id, { stops: next })
                      setEditingRoute(null)
                    }} />
      )}
    </div>
  )
}

function Row({ ev, busy, onPatch, onDelete, onEditLineup, onEditHosts, onEditRoute }: {
  ev: PortalEvent
  busy: boolean
  onPatch: (b: Record<string, unknown>) => void
  onDelete: () => void
  onEditLineup: () => void
  onEditHosts: () => void
  onEditRoute: () => void
}) {
  const isPinned = !!ev.pinned_at
  const isScraped = ev.source === 'scraped'
  return (
    <div style={{
      background: C.card,
      // A pinned row is outlined in ember so the top of the feed is visible at
      // a glance rather than needing the badges read.
      border: `1px solid ${isPinned ? C.gold : C.line}`,
      // Scraped rows are the bulk of the list and none of them are ours — held
      // back so the eye lands on the nights we actually run.
      opacity: isScraped ? 0.78 : 1,
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
          {/* On a route the venue column is only the FIRST stop, so showing it
              alone would misdescribe the night as happening at one place. */}
          {ev.stops.length > 0
            ? routeLine(ev.stops)
            : (ev.club_name ?? ev.location_name ?? 'No venue set')}
          {/* RA rarely prints a capacity, so "0 cap" would be a lie on most
              scraped rows — the door price is what it does give us. */}
          {ev.total_capacity > 0 && <>{' · '}{ev.total_capacity} cap</>}
          {ev.cost_label && <>{' · '}{ev.cost_label}</>}
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
        {isScraped && <Badge color={C.faint}>RA</Badge>}
        {/* Whether the scrape tied this listing to one of our venues. An
            unmatched one is at a venue we don't carry. */}
        {isScraped && !ev.club_id && <Badge color={C.faint}>Unmatched venue</Badge>}
        {!isScraped && !ev.live && (
          <Badge color={C.danger}>
            {!ev.is_published ? 'Unpublished'
              : ev.review_status !== 'approved' ? ev.review_status
              : ev.visibility !== 'public' ? ev.visibility
              : 'Past'}
          </Badge>
        )}
      </div>

      {/* A scraped listing is someone else's event on someone else's site. We
          can look at it, not pin, edit or unpublish it — none of those columns
          exist behind an RA row. The link out is the only action it has. */}
      {isScraped ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {ev.attending != null && ev.attending > 0 && (
            <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>
              {ev.attending} going
            </span>
          )}
          {ev.ra_url && (
            <a href={ev.ra_url} target="_blank" rel="noopener noreferrer"
               style={{ ...caps, fontSize: 10, color: C.gold, textDecoration: 'none', letterSpacing: '0.12em' }}>
              Open on RA ↗
            </a>
          )}
        </div>
      ) : (
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
        <Btn small kind="ghost" disabled={busy} onClick={onEditRoute}>
          {ev.stops.length > 0 ? `Route (${ev.stops.length})` : 'Route'}
        </Btn>
        <Btn small kind="ghost" disabled={busy}
             onClick={() => onPatch({ is_published: !ev.is_published })}>
          {ev.is_published ? 'Unpublish' : 'Publish'}
        </Btn>
        {ev.is_house && (
          <Btn small kind="danger" disabled={busy} onClick={onDelete}>Delete</Btn>
        )}
      </div>
      )}
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

type Stop = { club_id: string | null; name: string; start: string | null; end: string | null; note: string | null }

/** "22:00 → 05:00 · Bastión Beach Club → Opium" */
function routeLine(stops: Stop[]): string {
  return stops.map(s => s.name).join(' → ')
}

// Route editor: one night, several venues, in order.
//
// The beach-strip night is the case this exists for — 22:00 at the beach club,
// then 00:00 to 05:00 at the club proper. Modelled as one event rather than
// two, so the guest reserves once, gets one pass, and is counted once.
//
// Order is the route, so stops move up and down; the API replaces the whole
// list. Two stops minimum, matching the DB constraint — a one-stop route is
// just an ordinary night.
function RoutePicker({ value, onChange, clubs }: {
  value: Stop[]
  onChange: (next: Stop[]) => void
  clubs: ClubOption[]
}) {
  const blank: Stop = { club_id: null, name: '', start: null, end: null, note: null }

  function set(i: number, patch: Partial<Stop>) {
    onChange(value.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    onChange(next)
  }

  if (value.length === 0) {
    return (
      <Field label="Route" hint="For a night that moves — a beach club first, then the club proper. One event, one reservation, one pass.">
        <Btn small kind="ghost" onClick={() => onChange([{ ...blank }, { ...blank }])}>
          Add a route
        </Btn>
      </Field>
    )
  }

  return (
    <Field label="Route" hint="Doors and closing are taken from the first stop’s start and the last stop’s end — don’t set them separately.">
      <div style={{ display: 'grid', gap: 10 }}>
        {value.map((stop, i) => (
          <div key={i} style={{
            border: `1px solid ${C.line}`, borderRadius: 8, padding: '12px 12px 10px',
            display: 'grid', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...caps, fontSize: 10, color: C.gold, minWidth: 44 }}>Stop {i + 1}</span>
              <select
                value={stop.club_id ?? ''}
                onChange={e => {
                  const id = e.target.value || null
                  // Selecting one of our venues also fills the display name, so
                  // a stop is never saved as an id with a blank label.
                  set(i, { club_id: id, name: id ? (clubs.find(c => c.id === id)?.name ?? stop.name) : stop.name })
                }}
                className="cfp-input"
                style={{ ...inputStyle, flex: 1, padding: '7px 9px', fontSize: 12.5 }}
              >
                <option value="">— Not one of our venues —</option>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Btn small kind="ghost" onClick={() => move(i, i - 1)} disabled={i === 0}>↑</Btn>
              <Btn small kind="ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1}>↓</Btn>
              <Btn small kind="ghost" onClick={() => onChange(value.filter((_, n) => n !== i))}>✕</Btn>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <TextInput
                value={stop.name}
                onChange={e => set(i, { name: e.target.value })}
                placeholder="Bastión Beach Club"
                disabled={!!stop.club_id}
              />
              <TextInput type="time" value={stop.start ?? ''} onChange={e => set(i, { start: e.target.value || null })} />
              <TextInput type="time" value={stop.end ?? ''} onChange={e => set(i, { end: e.target.value || null })} />
            </div>

            <TextInput
              value={stop.note ?? ''}
              onChange={e => set(i, { note: e.target.value || null })}
              placeholder="What happens here — “Sunset set & dinner”"
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn small kind="ghost" disabled={value.length >= 6}
               onClick={() => onChange([...value, { ...blank }])}>
            + Add stop
          </Btn>
          <Btn small kind="ghost" onClick={() => onChange([])}>Clear route</Btn>
          <span style={{ fontFamily: font, fontSize: 12, color: C.faint, marginLeft: 'auto' }}>
            {value.filter(s => s.name.trim()).length < 2
              ? 'A route needs at least two named stops'
              : routeLine(value.filter(s => s.name.trim()))}
          </span>
        </div>
      </div>
    </Field>
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
  const [stops, setStops] = useState<Stop[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A route owns the venue and the times, so the single-venue fields come off
  // the form entirely rather than sitting there being ignored on submit.
  const isRoute = stops.length > 0

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
          stops,
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

      {!isRoute && (
        <>
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
        </>
      )}

      <RoutePicker value={stops} onChange={setStops} clubs={clubs} />

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

/// Turn an existing night into a route, or edit the one it has. Saving
/// re-derives the venue and the door times from the first and last stop — see
/// the note in the PATCH route — so the card can never say 23:00 at Opium while
/// the route starts at 22:00 on the beach.
function RouteModal({ ev, clubs, onClose, onSave }: {
  ev: PortalEvent; clubs: ClubOption[]; onClose: () => void; onSave: (next: Stop[]) => Promise<void>
}) {
  const [stops, setStops] = useState<Stop[]>(ev.stops)
  const [saving, setSaving] = useState(false)

  const named = stops.filter(s => s.name.trim())
  const valid = stops.length === 0 || named.length >= 2

  return (
    <Modal title={`Route — ${ev.title ?? 'Untitled'}`} onClose={onClose} width={600}>
      <RoutePicker value={stops} onChange={setStops} clubs={clubs} />
      {stops.length > 0 && (
        <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: C.faint, fontFamily: font, lineHeight: 1.55 }}>
          Saving moves the event to <strong>{named[0]?.name || 'the first stop'}</strong> and sets its
          hours to {named[0]?.start ?? '—'}&ndash;{named[named.length - 1]?.end ?? '—'}. Guests still
          reserve once and carry one pass; the door scans them at the first stop.
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={saving || !valid}
             onClick={async () => { setSaving(true); await onSave(stops) }}>
          {saving ? 'Saving…' : 'Save route'}
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
