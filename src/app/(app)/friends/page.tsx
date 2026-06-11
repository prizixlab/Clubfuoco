'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import NavSpacer from '@/components/NavSpacer'
import type { FriendsData, FriendUser, FriendSearchResult } from '@/types'

const SERIF = "'Instrument Serif', Georgia, serif"
const C = {
  bg:    '#F8F5EE',
  ink:   '#221E1A',
  ink2:  'rgb(110,99,86)',
  ink3:  'rgb(159,148,134)',
  red:   'rgb(140,42,42)',
  white: '#FFFFFF',
  line:  'rgba(34,30,26,0.08)',
  pill:  'rgba(34,30,26,0.05)',
  redSoft: 'rgba(140,42,42,0.08)',
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function Avatar({ user, size = 44 }: { user: { full_name: string | null; avatar_url: string | null }; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
      background: C.redSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {user.avatar_url
        ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: size * 0.4, color: C.red }}>{initials(user.full_name)}</span>}
    </div>
  )
}

export default function FriendsPage() {
  const router = useRouter()
  const [data, setData] = useState<FriendsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FriendSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)   // id being acted on
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(async () => {
    setError('')
    try {
      const r = await apiFetch('/api/friends')
      const d = await r.json().catch(() => null)
      if (r.ok && d?.data) setData(d.data)
      else setError(d?.error ?? `Couldn't load friends (HTTP ${r.status})`)
    } catch (e: any) {
      setError(e?.message ?? 'Network error loading friends')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (query.trim().length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/friends/search?q=${encodeURIComponent(query.trim())}`)
        const d = await r.json()
        if (r.ok) setResults(d.data ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [query])

  async function sendRequest(userId: string) {
    setBusy(userId); setError('')
    try {
      const r = await apiFetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressee_id: userId }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setError(d?.error ?? `Request failed (HTTP ${r.status})`); return }
      setResults(rs => rs.map(x => x.id === userId ? { ...x, relation: 'outgoing' } : x))
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Network error sending request')
    } finally { setBusy(null) }
  }

  async function respond(friendshipId: string, action: 'accept' | 'decline') {
    setBusy(friendshipId); setError('')
    try {
      const r = await apiFetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendship_id: friendshipId, action }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        setError(d?.error ?? `Could not ${action} (HTTP ${r.status})`)
      }
      await load()
    } finally { setBusy(null) }
  }

  async function remove(friendshipId: string) {
    setBusy(friendshipId); setError('')
    try {
      const r = await apiFetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendship_id: friendshipId }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        setError(d?.error ?? `Could not remove (HTTP ${r.status})`)
      }
      await load()
    } finally { setBusy(null) }
  }

  const incoming = data?.incoming ?? []
  const outgoing = data?.outgoing ?? []
  const friends  = data?.friends ?? []

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <style>{`
        .friend-search { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; }
        .friend-search::placeholder { color: rgb(159,148,134); font-style: italic; opacity: 1; }
      `}</style>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, background: C.bg,
        padding: '14px 20px 12px', borderBottom: `1px solid ${C.line}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 24, color: C.ink }}>arrow_back</span>
        </button>
        <h1 style={{ margin: 0, fontFamily: SERIF, fontStyle: 'italic', fontSize: 26, color: C.ink }}>Friends</h1>
      </header>

      <div style={{ padding: '16px 20px 0' }}>
        {/* Add a friend */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 8px', fontSize: 9, letterSpacing: '2.34px', color: C.ink3, textTransform: 'uppercase' }}>
            Add a friend
          </p>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 18px',
            background: C.white, borderRadius: 18,
            border: `1px solid ${focused ? 'rgba(140,42,42,0.35)' : 'rgba(34,30,26,0.06)'}`,
            boxShadow: focused
              ? '0 0 0 4px rgba(140,42,42,0.06), 0 12px 30px rgba(34,30,26,0.12)'
              : '0 2px 6px rgba(34,30,26,0.05), 0 16px 34px rgba(34,30,26,0.09)',
            transform: focused ? 'translateY(-1px)' : 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: focused ? C.red : C.ink3, flexShrink: 0, transition: 'color 0.2s' }}>search</span>
            <input
              className="friend-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Search by name or email"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                padding: '17px 0', fontSize: 20, lineHeight: 1.1, color: C.ink, letterSpacing: '0.01em',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{ background: C.pill, border: 'none', cursor: 'pointer', flexShrink: 0, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Clear"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17, color: C.ink3 }}>close</span>
              </button>
            )}
          </div>
        </div>

        {/* Search results */}
        {query.trim().length >= 2 && (
          <div style={{ marginBottom: 24 }}>
            {searching && <p style={{ fontSize: 13, color: C.ink3, fontFamily: 'Geist, system-ui, sans-serif' }}>Searching…</p>}
            {!searching && results.length === 0 && (
              <p style={{ fontSize: 13, color: C.ink3, fontFamily: 'Geist, system-ui, sans-serif' }}>No one found for &ldquo;{query.trim()}&rdquo;</p>
            )}
            {results.map(r => (
              <Row key={r.id} user={r}>
                {r.relation === 'friends'  && <Tag>Friends</Tag>}
                {r.relation === 'outgoing' && <Tag>Requested</Tag>}
                {r.relation === 'incoming' && r.friendship_id && (
                  <ActionBtn onClick={() => respond(r.friendship_id!, 'accept')} busy={busy === r.friendship_id} filled>Accept</ActionBtn>
                )}
                {r.relation === 'none' && (
                  <ActionBtn onClick={() => sendRequest(r.id)} busy={busy === r.id} filled>Add</ActionBtn>
                )}
              </Row>
            ))}
          </div>
        )}

        {/* Error banner — surfaces API/DB failures instead of a silent empty page */}
        {error && (
          <div style={{ marginBottom: 20, padding: '12px 14px', background: 'rgba(140,42,42,0.08)', border: '1px solid rgba(140,42,42,0.25)', borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.red, fontFamily: 'Geist, system-ui, sans-serif' }}>{error}</p>
          </div>
        )}

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <Section title="Requests" count={incoming.length}>
            {incoming.map(f => (
              <Row key={f.friendship_id} user={f}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <ActionBtn onClick={() => respond(f.friendship_id, 'accept')} busy={busy === f.friendship_id} filled>Accept</ActionBtn>
                  <ActionBtn onClick={() => respond(f.friendship_id, 'decline')} busy={busy === f.friendship_id}>Decline</ActionBtn>
                </div>
              </Row>
            ))}
          </Section>
        )}

        {/* Sent requests (outgoing) — so the sender can see pending invites */}
        {outgoing.length > 0 && (
          <Section title="Sent" count={outgoing.length}>
            {outgoing.map(f => (
              <Row key={f.friendship_id} user={f}>
                <Tag>Pending</Tag>
              </Row>
            ))}
          </Section>
        )}

        {/* Friends list */}
        <Section title="Your Friends" count={friends.length}>
          {loading ? (
            <p style={{ fontSize: 13, color: C.ink3, fontFamily: 'Geist, system-ui, sans-serif' }}>Loading…</p>
          ) : friends.length === 0 ? (
            <p style={{ fontSize: 14, color: C.ink2, fontFamily: SERIF, fontStyle: 'italic' }}>
              No friends yet — search above to add people you go out with.
            </p>
          ) : (
            friends.map((f: FriendUser) => (
              <Row key={f.friendship_id} user={f}>
                <button
                  onClick={() => remove(f.friendship_id)}
                  disabled={busy === f.friendship_id}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, opacity: busy === f.friendship_id ? 0.4 : 1 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.ink3 }}>person_remove</span>
                </button>
              </Row>
            ))
          )}
        </Section>
      </div>

      <NavSpacer />
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ margin: '0 0 6px', fontSize: 9, letterSpacing: '2.34px', color: C.ink3, textTransform: 'uppercase' }}>
        {title}{count > 0 ? ` · ${count}` : ''}
      </p>
      <div style={{ height: 1, background: C.line, marginBottom: 8 }} />
      {children}
    </div>
  )
}

function Row({ user, children }: { user: { full_name: string | null; avatar_url: string | null }; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <Avatar user={user} />
      <p style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: SERIF, fontSize: 19, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {user.full_name ?? 'Member'}
      </p>
      {children}
    </div>
  )
}

function ActionBtn({ onClick, busy, filled, children }: { onClick: () => void; busy?: boolean; filled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '7px 14px', borderRadius: 99, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        fontFamily: 'Geist, system-ui, sans-serif', letterSpacing: '0.02em', opacity: busy ? 0.5 : 1,
        border: filled ? 'none' : `1px solid ${C.line}`,
        background: filled ? C.ink : 'transparent',
        color: filled ? C.bg : C.ink2,
      }}
    >
      {children}
    </button>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      padding: '6px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      fontFamily: 'Geist, system-ui, sans-serif', color: C.ink3, background: C.pill,
    }}>
      {children}
    </span>
  )
}
