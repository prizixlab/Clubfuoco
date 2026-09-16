'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrandRow } from '@/lib/partner'
import type { BrandEvent } from '@/app/api/portal/brands/[id]/events/route'
import { Badge, Card, ErrorLine, api, C, caps, font, mono } from '../../_ui'

// Events — the promoter's dated nights, deliberately a separate section from
// Offers above. An offer is a standing per-venue product; an event is one
// night. They are stored in different tables (partner_offers vs
// promoter_nights) and mixing them in one list would suggest an editing model
// that does not exist.
//
// Read-only on purpose: editing a night belongs on the Events desk
// (/portal/events), which owns pinning, publishing and the house-event flow.
// This answers "what is this promoter actually running?" without duplicating
// that surface.
export default function EventsPanel({ brand }: { brand: BrandRow }) {
  const [events, setEvents] = useState<BrandEvent[] | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(() => {
    api<{ events: BrandEvent[]; owner: string | null }>(`/api/portal/brands/${brand.id}/events`)
      .then(r => { setEvents(r.events); setOwner(r.owner) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load events'))
  }, [brand.id])
  useEffect(load, [load])

  const { upcoming, past, byVenue } = useMemo(() => {
    const all = events ?? []
    const up = all.filter(e => !e.past)
    const pa = all.filter(e => e.past).reverse()   // most recent first
    const counts = new Map<string, number>()
    for (const e of up) {
      const k = e.club_name ?? e.location_name ?? 'Unassigned venue'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return {
      upcoming: up,
      past: pa,
      byVenue: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [events])

  const shown = showPast ? past : upcoming

  return (
    <section style={{ marginTop: 32 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <span style={{ ...caps, color: C.gold, letterSpacing: '0.14em' }}>
            Events
            <span style={{ color: C.faint, marginLeft: 10, letterSpacing: '0.1em' }}>
              {events ? `${upcoming.length} upcoming${past.length ? ` · ${past.length} past` : ''}` : '…'}
            </span>
          </span>
          {past.length > 0 && (
            <div style={{ display: 'inline-flex', gap: 6 }}>
              <Tab active={!showPast} onClick={() => setShowPast(false)}>Upcoming</Tab>
              <Tab active={showPast} onClick={() => setShowPast(true)}>Past</Tab>
            </div>
          )}
        </div>

        <p style={{ margin: '-6px 0 16px', fontSize: 12.5, color: C.faint, lineHeight: 1.55, fontFamily: font }}>
          Dated nights this promoter runs — separate from the standing offers above.
          Read-only here; pin, publish and edit on the <a href="/portal/events" style={{ color: C.goldHi }}>Events desk</a>.
        </p>

        <ErrorLine error={error} />

        {!events && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

        {/* No promoter account yet — the only reason events can't be attributed. */}
        {events && !owner && (
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5, lineHeight: 1.6 }}>
            No promoter account is linked to this brand yet, so no events can belong to it.
            Set a login email above and grant access — events are attributed to that account.
          </p>
        )}

        {events && owner && events.length === 0 && (
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5 }}>
            This promoter hasn’t published any events yet.
          </p>
        )}

        {/* Venue spread — the fastest read on where a promoter actually works. */}
        {byVenue.length > 0 && !showPast && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
            {byVenue.map(([name, n]) => (
              <span key={name} style={{
                fontFamily: font, fontSize: 12, color: C.dim,
                border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 11px',
              }}>
                {name} <span style={{ color: C.goldHi, fontFamily: mono, fontSize: 11.5 }}>{n}</span>
              </span>
            ))}
          </div>
        )}

        {shown.length > 0 && (
          <div style={{ display: 'grid', gap: 7, maxHeight: 460, overflowY: 'auto' }}>
            {shown.map(e => <EventRow key={e.id} event={e} />)}
          </div>
        )}
      </Card>
    </section>
  )
}

function Tab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      ...caps, fontSize: 10, letterSpacing: '0.12em', cursor: 'pointer',
      background: active ? 'rgba(192,153,80,0.14)' : 'transparent',
      border: `1px solid ${active ? 'rgba(192,153,80,0.4)' : C.line}`,
      color: active ? C.goldHi : C.dim, borderRadius: 4, padding: '6px 11px',
    }}>
      {children}
    </button>
  )
}

// "2026-10-31" → "Sat 31 Oct". Split manually rather than via Date so the
// local timezone can't roll a calendar day backwards.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "23:45:00" → "23:45"; null stays null. */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

function EventRow({ event: e }: { event: BrandEvent }) {
  const times = [hhmm(e.open_time), hhmm(e.close_time)].filter(Boolean).join(' – ')
  // Anything that would stop a guest seeing this night, surfaced rather than
  // left to be discovered on the Events desk.
  const flags: React.ReactNode[] = []
  if (e.review_status !== 'approved') flags.push(<Badge key="r" color={C.gold}>{e.review_status}</Badge>)
  if (!e.is_published) flags.push(<Badge key="p" color={C.faint}>Unpublished</Badge>)
  if (e.visibility !== 'public') flags.push(<Badge key="v" color={C.faint}>{e.visibility}</Badge>)
  if (e.featured) flags.push(<Badge key="f" color={C.goldHi}>Featured</Badge>)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13,
      background: C.card, border: `1px solid ${C.line}`, borderRadius: 8,
      padding: '10px 13px', opacity: e.past ? 0.55 : 1,
    }}>
      <span style={{
        fontFamily: mono, fontSize: 11.5, color: C.goldHi, flexShrink: 0,
        width: 78, letterSpacing: '0.02em',
      }}>
        {formatDate(e.night_date)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13.5, fontWeight: 600, fontFamily: font, color: C.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }}>
            {e.title || 'Untitled night'}
          </span>
          {flags}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: C.dim, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.club_name ?? e.location_name ?? 'No venue'}{times ? ` · ${times}` : ''}
        </p>
      </div>

      <span style={{ fontFamily: mono, fontSize: 12.5, color: e.price_cents > 0 ? C.goldHi : C.faint, flexShrink: 0 }}>
        {e.price_cents > 0 ? `€${(e.price_cents / 100).toFixed(2)}` : 'Free'}
      </span>
    </div>
  )
}
