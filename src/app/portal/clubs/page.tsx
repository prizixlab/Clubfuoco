'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, TextInput, api, C, caps, font, mono, serif } from '../_ui'
import ClubDetailModal from './_detail'

interface ClubSummary {
  id: string
  name: string
  neighborhood: string | null
  address: string | null
  cover_image_url: string | null
  is_active: boolean
  is_partner: boolean
  is_featured: boolean
  rating: number | null
}

type Scope = 'all' | 'active' | 'partner'
const PAGE = 30

// Clubs tab — browse all venues, search + page through them, click one to open
// its full detail/edit modal. Editing writes to the clubs table via the portal
// service routes.
export default function ClubsPage() {
  const [q, setQ]           = useState('')
  const [scope, setScope]   = useState<Scope>('all')
  const [page, setPage]     = useState(0)
  const [clubs, setClubs]   = useState<ClubSummary[] | null>(null)
  const [total, setTotal]   = useState(0)
  const [error, setError]   = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // Debounce the search box so we don't fire a request per keystroke.
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(0) }, 280)
    return () => clearTimeout(t)
  }, [q])

  const reqId = useRef(0)
  const load = useCallback(() => {
    const mine = ++reqId.current
    setClubs(null)
    const params = new URLSearchParams({ q: debouncedQ, limit: String(PAGE), offset: String(page * PAGE) })
    if (scope !== 'all') params.set('scope', scope)
    api<{ clubs: ClubSummary[]; total: number }>(`/api/portal/clubs/browse?${params}`)
      .then(res => {
        if (mine !== reqId.current) return   // a newer request already fired
        setClubs(res.clubs)
        setTotal(res.total)
        setError(null)
      })
      .catch(e => { if (mine === reqId.current) setError(e instanceof Error ? e.message : 'Failed to load clubs') })
  }, [debouncedQ, scope, page])
  useEffect(load, [load])

  const pages = Math.ceil(total / PAGE)

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Clubs</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Every venue in the catalog. Click a club to view and edit its details.
        </p>
      </div>

      {/* Search + scope filter */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <TextInput placeholder="Search by name, neighborhood, or address…" value={q}
            onChange={e => setQ(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'active', 'partner'] as Scope[]).map(s => (
            <Btn key={s} small kind={scope === s ? 'primary' : 'ghost'}
              onClick={() => { setScope(s); setPage(0) }}>
              {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Partner'}
            </Btn>
          ))}
        </div>
      </div>

      <ErrorLine error={error} />

      <p style={{ ...caps, color: C.faint, margin: '0 0 12px', letterSpacing: '0.12em' }}>
        {clubs ? `${total.toLocaleString()} club${total === 1 ? '' : 's'}` : 'Loading…'}
      </p>

      {/* List */}
      <div style={{ display: 'grid', gap: 10 }}>
        {clubs?.map(c => (
          <button key={c.id} onClick={() => setOpenId(c.id)} className="cfp-hover-lift" style={{
            textAlign: 'left', cursor: 'pointer',
            background: C.card, border: `1px solid ${C.line}`, borderRadius: 8,
            padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 52, height: 40, borderRadius: 6, background: 'rgba(0,0,0,0.4)',
              border: `1px solid ${C.line}`, flexShrink: 0, overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {c.cover_image_url
                ? <img src={c.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ ...caps, fontSize: 8, color: C.faint }}>—</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 600, fontFamily: font, color: C.text }}>{c.name}</span>
                {c.rating != null && <span style={{ fontFamily: mono, fontSize: 12, color: C.gold }}>★ {c.rating}</span>}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.dim, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.neighborhood || c.address || '—'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {c.is_partner  && <Badge>Partner</Badge>}
              {c.is_featured && <Badge color={C.goldHi}>Featured</Badge>}
              <Badge color={c.is_active ? C.green : C.faint}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
            </div>
          </button>
        ))}
        {clubs && clubs.length === 0 && (
          <Card><p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>No clubs match “{debouncedQ}”.</p></Card>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 24 }}>
          <Btn kind="ghost" small disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</Btn>
          <span style={{ ...caps, color: C.dim, letterSpacing: '0.12em' }}>Page {page + 1} of {pages}</span>
          <Btn kind="ghost" small disabled={page >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>Next →</Btn>
        </div>
      )}

      {openId && (
        <ClubDetailModal
          clubId={openId}
          onClose={() => setOpenId(null)}
          onSaved={load}
        />
      )}
    </>
  )
}
