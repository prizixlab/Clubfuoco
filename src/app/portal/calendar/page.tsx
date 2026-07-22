'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, api, C, caps, font, mono, serif } from '../_ui'

// What is running, night by night — the schedule the raw offer rows never
// showed, because "is it on tonight?" is the product of valid_days, the
// supplier's hide switch and the venue's conflict rule.
//
// Each night's entries can be suspended individually. That writes the offer's
// skipped_dates, which the consumer gate already honours, so a suspended night
// disappears from the app without touching the offer's weekly schedule.

interface Entry {
  offer_id:    string
  club_id:     string
  club_name:   string
  kind:        string
  kind_label:  string
  title:       string
  time_window: string
  brand:       { id: string; name: string; color: string }
  live:        boolean
  blocked:     'suspended' | 'supplier_hidden' | 'conflict_rule' | null
}
interface Day { date: string; weekday: string | null; live: number; entries: Entry[] }
interface Payload { from: string; days: number; today: string; calendar: Day[] }

const WHY: Record<string, string> = {
  suspended:       'Suspended for this night',
  supplier_hidden: 'Supplier hidden everywhere',
  conflict_rule:   'Excluded by this venue’s conflict rule',
}

function shiftDate(date: string, byDays: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + byDays)
  return d.toISOString().slice(0, 10)
}

export default function CalendarPage() {
  const [from, setFrom] = useState<string | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    const qs = from ? `?from=${from}&days=14` : '?days=14'
    api<Payload>(`/api/portal/calendar${qs}`)
      .then(d => { setData(d); if (!from) setFrom(d.from) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [from])
  useEffect(load, [load])

  return (
    <>
      <h1 style={{ margin: 0, fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
        What&rsquo;s <em style={{ fontStyle: 'italic', color: C.goldHi }}>on</em>
      </h1>
      <p style={{ margin: '8px 0 20px', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 640, lineHeight: 1.55 }}>
        Every offer resolved night by night — after valid days, the supplier&rsquo;s hide switch and
        the venue&rsquo;s conflict rule. Suspend a single night without touching the weekly schedule.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Btn small onClick={() => setFrom(f => shiftDate(f ?? data?.from ?? '', -14))}>← Earlier</Btn>
        <Btn small onClick={() => setFrom(data?.today ?? null)}>Today</Btn>
        <Btn small onClick={() => setFrom(f => shiftDate(f ?? data?.from ?? '', 14))}>Later →</Btn>
        {data && (
          <span style={{ fontFamily: mono, fontSize: 12, color: C.faint, marginLeft: 4 }}>
            {data.calendar[0]?.date} → {data.calendar[data.calendar.length - 1]?.date}
          </span>
        )}
      </div>

      <ErrorLine error={error} />
      {!data && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data?.calendar.map(day => (
          <DayCard key={day.date} day={day} today={data.today} onChanged={load} />
        ))}
      </div>
    </>
  )
}

function DayCard({ day, today, onChanged }: { day: Day; today: string; onChanged: () => void }) {
  const isToday = day.date === today
  return (
    <Card style={{ padding: 18, borderColor: isToday ? `${C.gold}55` : C.line }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: day.entries.length ? 14 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: serif, fontSize: 20, color: C.text }}>{day.weekday}</span>
          <span style={{ fontFamily: mono, fontSize: 12, color: C.dim }}>{day.date}</span>
          {isToday && <Badge color={C.gold}>Tonight</Badge>}
        </div>
        <Badge color={day.live ? C.green : C.faint}>
          {day.live} live
        </Badge>
      </div>

      {day.entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: C.faint, fontFamily: font }}>
          Nothing scheduled.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {day.entries.map(e => <EntryRow key={e.offer_id} entry={e} date={day.date} onChanged={onChanged} />)}
        </div>
      )}
    </Card>
  )
}

function EntryRow({ entry, date, onChanged }: { entry: Entry; date: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suspended = entry.blocked === 'suspended'

  async function toggle() {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/calendar', {
        method: 'PUT',
        body: JSON.stringify({ offer_id: entry.offer_id, date, suspended: !suspended }),
      })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update')
    }
    setBusy(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: entry.live ? C.lifted : 'transparent',
      border: `1px solid ${entry.live ? C.line : 'transparent'}`,
      borderRadius: 8, padding: '10px 12px',
      opacity: entry.live ? 1 : 0.62,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: entry.brand.color, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontFamily: font, fontSize: 14, color: C.text }}>
          {entry.club_name}
          <span style={{ color: C.faint }}> · {entry.kind_label}</span>
        </p>
        <p style={{ margin: '2px 0 0', fontFamily: font, fontSize: 12, color: C.dim }}>
          {entry.brand.name}
          {entry.time_window ? <span style={{ color: C.faint }}> · {entry.time_window}</span> : null}
        </p>
      </div>

      {/* Why it isn't running, so the operator knows which switch to flip. */}
      {!entry.live && (
        <span style={{ ...caps, fontSize: 9.5, color: suspended ? C.danger : C.faint, letterSpacing: '0.1em' }}>
          {WHY[entry.blocked ?? ''] ?? 'Not running'}
        </span>
      )}

      {/* Only the per-night switch belongs here. A supplier hidden everywhere,
          or excluded by a conflict rule, is not a per-night decision — those
          are fixed on Partners and Conflicts. */}
      {(entry.live || suspended) && (
        <Btn small kind={suspended ? 'primary' : 'ghost'} onClick={toggle} disabled={busy}>
          {busy ? '…' : suspended ? 'Restore' : 'Suspend'}
        </Btn>
      )}
      <ErrorLine error={error} />
    </div>
  )
}
