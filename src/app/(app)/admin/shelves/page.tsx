'use client'
import { apiFetch } from '@/lib/api'
import { useEffect, useState } from 'react'

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ShelfRecord {
  id:          string
  title:       string
  subtitle:    string
  mode:        'auto' | 'manual'
  auto_filter: string
  auto_genre:  string | null
  auto_sort:   string
  place_ids:   string[]
  position:    number
  enabled:     boolean
}
interface Club { id: string; name: string; address?: string }

type Draft = Omit<ShelfRecord, 'id'> & { id?: string }

const BLANK: Draft = {
  title: '', subtitle: '', mode: 'auto',
  auto_filter: 'all', auto_genre: '', auto_sort: 'rating',
  place_ids: [], position: 3, enabled: true,
}

const FILTERS = [
  { v: 'all',      label: 'All venues' },
  { v: 'open',     label: 'Open right now' },
  { v: 'partner',  label: 'Partner clubs only' },
  { v: 'featured', label: 'Featured clubs only' },
  { v: 'genre',    label: 'By music genre / keyword' },
]
const SORTS = [
  { v: 'rating',  label: 'Highest rated' },
  { v: 'popular', label: 'Most reviewed' },
  { v: 'random',  label: 'Shuffled' },
]

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E8E2D8', borderRadius: 12, padding: 16, marginBottom: 12 }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9F9486', display: 'block', marginBottom: 6 }
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E8E2D8', fontSize: 14, boxSizing: 'border-box', background: '#FBFAF7' }
const btn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function AdminShelvesPage() {
  const [shelves, setShelves] = useState<ShelfRecord[]>([])
  const [clubs,   setClubs]   = useState<Club[]>([])
  const [draft,   setDraft]   = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState('')
  const [pickQuery, setPickQuery] = useState('')

  function flash(m: string) { setToast(m); setTimeout(() => setToast(''), 2500) }

  function load() {
    apiFetch('/api/admin/shelves')
      .then(r => r.json())
      .then(d => setShelves(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiFetch('/api/admin/clubs/list')
      .then(r => r.json())
      .then(d => setClubs(d.data ?? []))
      .catch(() => {})
  }, [])

  async function save() {
    if (!draft) return
    if (!draft.title.trim()) { flash('Title is required'); return }
    setSaving(true)
    try {
      const editing = !!draft.id
      const res = await apiFetch(
        editing ? `/api/admin/shelves/${draft.id}` : '/api/admin/shelves',
        {
          method:  editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(draft),
        },
      )
      if (!res.ok) { flash('Save failed'); return }
      setDraft(null)
      setPickQuery('')
      load()
      flash(editing ? 'Shelf updated' : 'Shelf created')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this shelf?')) return
    const res = await apiFetch(`/api/admin/shelves/${id}`, { method: 'DELETE' })
    if (res.ok) { load(); flash('Shelf deleted') }
    else flash('Delete failed')
  }

  const clubName = (id: string) => clubs.find(c => c.id === id)?.name ?? id
  const pickMatches = pickQuery.trim()
    ? clubs.filter(c => c.name.toLowerCase().includes(pickQuery.toLowerCase())).slice(0, 20)
    : []

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 80px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Explore Shelves</h1>
      <p style={{ fontSize: 13, color: '#6E6356', margin: '0 0 20px' }}>
        Custom rows shown on the Explore feed, alongside the default rows. Lower position = nearer the top.
      </p>

      {toast && (
        <div style={{ ...card, background: '#1F1B16', color: '#F8F5EE', padding: '10px 16px' }}>{toast}</div>
      )}

      {/* ── List ──────────────────────────────────────────────────────── */}
      {loading ? (
        <p style={{ color: '#9F9486' }}>Loading…</p>
      ) : shelves.length === 0 ? (
        <p style={{ color: '#9F9486', fontSize: 14 }}>No custom shelves yet.</p>
      ) : (
        shelves.map(s => (
          <div key={s.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {s.title}{' '}
                  {!s.enabled && <span style={{ fontSize: 11, color: '#B4452A' }}>· hidden</span>}
                </div>
                <div style={{ fontSize: 12, color: '#9F9486', marginTop: 2 }}>
                  pos {s.position} · {s.mode === 'manual'
                    ? `${s.place_ids.length} hand-picked venues`
                    : `auto — ${FILTERS.find(f => f.v === s.auto_filter)?.label}${s.auto_filter === 'genre' ? ` "${s.auto_genre}"` : ''}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button style={{ ...btn, background: '#F0EDE8', color: '#221E1A' }}
                  onClick={() => { setDraft({ ...s, auto_genre: s.auto_genre ?? '' }); setPickQuery('') }}>Edit</button>
                <button style={{ ...btn, background: '#FBEDEA', color: '#B4452A' }}
                  onClick={() => remove(s.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))
      )}

      {!draft && (
        <button style={{ ...btn, background: '#221E1A', color: '#F8F5EE', marginTop: 8 }}
          onClick={() => { setDraft({ ...BLANK }); setPickQuery('') }}>
          + New shelf
        </button>
      )}

      {/* ── Editor ────────────────────────────────────────────────────── */}
      {draft && (
        <div style={{ ...card, borderColor: '#221E1A', marginTop: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>
            {draft.id ? 'Edit shelf' : 'New shelf'}
          </h2>

          <div style={{ marginBottom: 14 }}>
            <label style={label}>Title</label>
            <input style={input} value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Techno Tonight" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Subtitle</label>
            <input style={input} value={draft.subtitle}
              onChange={e => setDraft({ ...draft, subtitle: e.target.value })} placeholder="e.g. Where the bass never stops" />
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Position</label>
              <input style={input} type="number" min={1} value={draft.position}
                onChange={e => setDraft({ ...draft, position: +e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Visible</label>
              <select style={input} value={draft.enabled ? 'yes' : 'no'}
                onChange={e => setDraft({ ...draft, enabled: e.target.value === 'yes' })}>
                <option value="yes">Shown</option>
                <option value="no">Hidden</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={label}>How is it filled?</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['auto', 'manual'] as const).map(m => (
                <button key={m} style={{
                  ...btn, flex: 1,
                  background: draft.mode === m ? '#221E1A' : '#F0EDE8',
                  color: draft.mode === m ? '#F8F5EE' : '#221E1A',
                }} onClick={() => setDraft({ ...draft, mode: m })}>
                  {m === 'auto' ? 'Automated rule' : 'Hand-pick venues'}
                </button>
              ))}
            </div>
          </div>

          {/* Auto config */}
          {draft.mode === 'auto' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>Which venues</label>
                <select style={input} value={draft.auto_filter}
                  onChange={e => setDraft({ ...draft, auto_filter: e.target.value })}>
                  {FILTERS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
                </select>
              </div>
              {draft.auto_filter === 'genre' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={label}>Genre / keyword</label>
                  <input style={input} value={draft.auto_genre ?? ''}
                    onChange={e => setDraft({ ...draft, auto_genre: e.target.value })}
                    placeholder="e.g. techno, house, rooftop" />
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <label style={label}>Order by</label>
                <select style={input} value={draft.auto_sort}
                  onChange={e => setDraft({ ...draft, auto_sort: e.target.value })}>
                  {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Manual venue picker */}
          {draft.mode === 'manual' && (
            <div style={{ marginBottom: 14 }}>
              <label style={label}>Venues in this shelf ({draft.place_ids.length})</label>
              {draft.place_ids.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {draft.place_ids.map((id, i) => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F0EDE8' }}>
                      <span style={{ fontSize: 12, color: '#9F9486', width: 18 }}>{i + 1}</span>
                      <span style={{ flex: 1, fontSize: 13 }}>{clubName(id)}</span>
                      <button style={{ ...btn, padding: '3px 8px', background: '#F0EDE8', color: '#6E6356' }}
                        onClick={() => i > 0 && setDraft({
                          ...draft,
                          place_ids: (() => { const a = [...draft.place_ids]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a })(),
                        })}>↑</button>
                      <button style={{ ...btn, padding: '3px 8px', background: '#FBEDEA', color: '#B4452A' }}
                        onClick={() => setDraft({ ...draft, place_ids: draft.place_ids.filter(x => x !== id) })}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <input style={input} value={pickQuery}
                onChange={e => setPickQuery(e.target.value)} placeholder="Search a venue to add…" />
              {pickMatches.length > 0 && (
                <div style={{ border: '1px solid #E8E2D8', borderRadius: 8, marginTop: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {pickMatches.map(c => {
                    const added = draft.place_ids.includes(c.id)
                    return (
                      <button key={c.id} disabled={added}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                          border: 'none', borderBottom: '1px solid #F0EDE8', background: '#fff',
                          fontSize: 13, cursor: added ? 'default' : 'pointer', opacity: added ? 0.4 : 1,
                        }}
                        onClick={() => setDraft({ ...draft, place_ids: [...draft.place_ids, c.id] })}>
                        {c.name}{added ? ' · added' : ''}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={{ ...btn, background: '#221E1A', color: '#F8F5EE', opacity: saving ? 0.6 : 1 }}
              disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save shelf'}
            </button>
            <button style={{ ...btn, background: '#F0EDE8', color: '#221E1A' }}
              onClick={() => { setDraft(null); setPickQuery('') }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
