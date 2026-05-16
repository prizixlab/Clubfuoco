'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { MUSIC_OPTIONS, VIBE_OPTIONS, DRINK_CATEGORIES, BUDGET_NO_LIMIT } from '@/lib/preferences'

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const C = {
  bg:        '#F8F5EE',
  card:      '#FFFFFF',
  ink:       '#2A2420',
  ink2:      '#6E6356',
  ink3:      '#9F9486',
  accent:    '#8C2A2A',
  accentDk:  '#6E2020',
  line:      'rgba(42,36,32,0.09)',
  pillBg:    'rgba(42,36,32,0.05)',
  bannerBg:  'rgba(140,42,42,0.045)',
}
const SERIF   = "'Instrument Serif', 'Bodoni Moda', Georgia, serif"
const MONO    = 'ui-monospace, SFMono-Regular, monospace'
const SANS    = 'Geist, -apple-system, system-ui, sans-serif'

/* ─── Static data ───────────────────────────────────────────────────────── */
const BUDGET_TIERS = [
  { label: 'Modesto',      range: 'Under €30',  value: 20  },
  { label: 'Equilibrato',  range: '€30 — €80',  value: 55  },
  { label: 'Generoso',     range: '€80 — €150', value: 110 },
  { label: 'Senza limiti', range: 'No limit',   value: BUDGET_NO_LIMIT },
]
const NOTIFS = [
  { key: 'openings',  label: "Tonight's openings", desc: 'A short note before doors open' },
  { key: 'curator',   label: 'Curator picks',      desc: 'One curated event each week'    },
  { key: 'guestlist', label: 'Guest list ready',   desc: 'When a friend lists you'        },
  { key: 'concierge', label: 'Concierge messages', desc: 'From your Fuoco host'           },
]
type NotifState = Record<string, boolean>

function budgetTier(v: number) {
  if (v >= BUDGET_NO_LIMIT) return BUDGET_TIERS[3]
  if (v >= 80) return BUDGET_TIERS[2]
  if (v >= 30) return BUDGET_TIERS[1]
  return BUDGET_TIERS[0]
}

/* ─── Small components ──────────────────────────────────────────────────── */
function SectionHead({ n, name }: { n: string; name: string }) {
  return (
    <div style={{ marginTop: 34, marginBottom: 12 }}>
      <div style={{ borderTop: `1px solid ${C.line}`, marginBottom: 12 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '2px', color: C.accent }}>
          N° {n}
        </span>
        <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 24, color: C.ink, lineHeight: 1 }}>
          {name}
        </span>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

const rowLabel: React.CSSProperties = {
  fontFamily: MONO, fontSize: 9, letterSpacing: '1.4px',
  textTransform: 'uppercase', color: C.ink3, margin: 0,
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 99, fontSize: 12.5, fontFamily: SANS,
      cursor: 'pointer', transition: 'all 0.15s',
      background: active ? C.ink : 'transparent',
      color: active ? C.bg : C.ink2,
      border: `1px solid ${active ? C.ink : C.line}`,
      fontWeight: active ? 500 : 400,
    }}>{label}</button>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} style={{
      width: 42, height: 25, borderRadius: 99, border: 'none', flexShrink: 0, padding: 0,
      background: value ? C.accent : 'rgba(42,36,32,0.14)',
      position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: value ? 20 : 3,
        width: 19, height: 19, borderRadius: '50%', background: '#FFFFFF',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)', transition: 'left 0.2s',
      }} />
    </button>
  )
}

export default function SettingsPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [userId,   setUserId]   = useState('')
  const [fullName, setFullName] = useState('')
  const [phone,    setPhone]    = useState('')
  const [email,    setEmail]    = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [bDay,   setBDay]   = useState('')
  const [bMonth, setBMonth] = useState('')
  const [bYear,  setBYear]  = useState('')

  const [budget, setBudget] = useState(55)
  const [drinks, setDrinks] = useState<string[]>([])
  const [music,  setMusic]  = useState<string[]>([])
  const [vibes,  setVibes]  = useState<string[]>([])
  const [notifs, setNotifs] = useState<NotifState>(Object.fromEntries(NOTIFS.map(n => [n.key, true])))

  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [emailMsg,   setEmailMsg]   = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [snapshot,   setSnapshot]   = useState('')
  const savedPrefs = useRef<any>({})

  function snapOf() {
    return JSON.stringify({
      fullName, phone, bDay, bMonth, bYear, budget,
      drinks: [...drinks].sort(), music: [...music].sort(), vibes: [...vibes].sort(),
    })
  }
  const dirty = !loading && !!snapshot && snapOf() !== snapshot

  /* ── Load ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      setEmail(user.email ?? ''); setNewEmail(user.email ?? '')

      const { data: profile } = await supabase
        .from('users').select('full_name, phone, birthday, preferences')
        .eq('id', user.id).single() as any

      if (profile) {
        setFullName(profile.full_name ?? '')
        setPhone(profile.phone ?? '')
        if (profile.birthday) {
          const [y, m, d] = (profile.birthday as string).split('-')
          setBYear(y); setBMonth(String(parseInt(m))); setBDay(String(parseInt(d)))
        }
        const p = profile.preferences ?? {}
        setBudget(p.budget ?? 55)
        setDrinks(p.drinks ?? [])
        setMusic(p.music_genres ?? [])
        setVibes(p.vibes ?? [])
        const n = p.notifications ?? {}
        const nx = Object.fromEntries(NOTIFS.map(x => [x.key, n[x.key] ?? true]))
        setNotifs(nx)
        savedPrefs.current = {
          budget: p.budget ?? 55, drinks: p.drinks ?? [],
          music_genres: p.music_genres ?? [], vibes: p.vibes ?? [], notifications: nx,
        }
      }
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!loading && !snapshot) setSnapshot(snapOf())
  }, [loading])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Actions ──────────────────────────────────────────────────────────── */
  async function saveAll() {
    if (!userId) return
    setSaving(true)
    const birthday = (bDay && bMonth && bYear)
      ? `${bYear}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}` : null
    const preferences = { budget, drinks, music_genres: music, vibes, notifications: notifs }
    await (supabase as any).from('users').update({
      full_name: fullName, phone: phone || null, birthday, preferences,
    }).eq('id', userId)
    savedPrefs.current = preferences
    setSnapshot(snapOf())
    setSaving(false)
  }

  async function toggleNotif(key: string, value: boolean) {
    const next = { ...notifs, [key]: value }
    setNotifs(next)
    if (!userId) return
    const merged = { ...savedPrefs.current, notifications: next }
    savedPrefs.current = merged
    await (supabase as any).from('users').update({ preferences: merged }).eq('id', userId)
  }

  async function verifyEmail() {
    if (!newEmail || newEmail === email) return
    setEmailMsg('')
    const { error } = await supabase.auth.updateUser({ email: newEmail })
    setEmailMsg(error ? error.message : `Confirmation link sent to ${newEmail}`)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  async function deleteAccount() {
    setDeleting(true)
    try {
      const res = await apiFetch('/api/account/delete', { method: 'POST' })
      if (res.ok) { await supabase.auth.signOut(); router.replace('/login') }
      else { setDeleting(false); setConfirmDel(false) }
    } catch { setDeleting(false); setConfirmDel(false) }
  }

  function toggleMulti(setter: React.Dispatch<React.SetStateAction<string[]>>, v: string) {
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  /* ── Reusable styles ──────────────────────────────────────────────────── */
  const serifInput: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none',
    outline: 'none', padding: 0, fontFamily: SERIF, fontSize: 21, color: C.ink,
  }

  /* Personal/Account field row */
  function FieldRow({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
    return (
      <div style={{ padding: '13px 16px', borderBottom: last ? 'none' : `1px solid ${C.line}` }}>
        <p style={{ ...rowLabel, marginBottom: 5 }}>{label}</p>
        {children}
      </div>
    )
  }

  /* Expandable preference row */
  function PrefRow({ k, label, value, sub, last, children }: {
    k: string; label: string; value: string; sub: string; last?: boolean; children: React.ReactNode
  }) {
    const open = expanded === k
    return (
      <div style={{ borderBottom: last && !open ? 'none' : `1px solid ${C.line}` }}>
        <button type="button" onClick={() => setExpanded(open ? null : k)} style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
        }}>
          <span style={{ flex: 1, fontFamily: SERIF, fontSize: 19, color: C.ink }}>{label}</span>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: C.accent, lineHeight: 1.3 }}>
              {value}
            </p>
            {sub && <p style={{ margin: '2px 0 0', fontFamily: MONO, fontSize: 8.5, letterSpacing: '1px', textTransform: 'uppercase', color: C.ink3 }}>{sub}</p>}
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.ink3, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            expand_more
          </span>
        </button>
        {open && <div style={{ padding: '0 16px 18px' }}>{children}</div>}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 34, color: C.ink3, animation: 'spin 1s linear infinite' }}>settings</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  const summary = (arr: string[]) => arr.length ? arr.slice(0, 3).join(' · ') : 'None yet'

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: SANS }}>

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, background: C.bg,
        borderBottom: `1px solid ${C.line}`,
        paddingTop: 'calc(env(safe-area-inset-top, 44px) + 10px)',
        paddingBottom: 12, paddingLeft: 16, paddingRight: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={() => router.back()} style={{ width: 36, height: 36, border: 'none', background: C.pillBg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.ink2 }}>arrow_back</span>
        </button>
        <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: '2px', textTransform: 'uppercase', color: C.accent }}>
          N° 07 · Impostazioni
        </p>
        <div style={{ width: 36 }} />
      </header>

      <div style={{ padding: '26px 20px 150px' }}>

        {/* Title block */}
        <p style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: C.ink3, margin: '0 0 6px' }}>
          Your Account
        </p>
        <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 46, color: C.ink, margin: '0 0 8px', lineHeight: 1 }}>
          Impostazioni
        </h1>
        <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, color: C.ink2, margin: '0 0 18px', lineHeight: 1.4 }}>
          Personal details, preferences, and what we send you.
        </p>

        {/* Info banner */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          background: C.bannerBg, border: `1px solid rgba(140,42,42,0.18)`,
          borderRadius: 12, padding: '12px 14px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.accent, flexShrink: 0, marginTop: 1 }}>info</span>
          <p style={{ margin: 0, fontSize: 12, color: C.ink2, lineHeight: 1.5 }}>
            Personal, Account &amp; Preferences need{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', color: C.accent, fontSize: 14 }}>Save</span>.
            {' '}Notifications save instantly.
          </p>
        </div>

        {/* ── N° 01 Personal ─────────────────────────────────────────────── */}
        <SectionHead n="01" name="Personal" />
        <Card>
          <FieldRow label="Full name">
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" style={serifInput} />
          </FieldRow>
          <FieldRow label="Birthday">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <input value={bDay}   onChange={e => setBDay(e.target.value.replace(/\D/g,'').slice(0,2))}   placeholder="DD"   inputMode="numeric" style={{ ...serifInput, width: 38, textAlign: 'center' }} />
              <span style={{ fontFamily: SERIF, fontSize: 19, color: C.ink3 }}>/</span>
              <input value={bMonth} onChange={e => setBMonth(e.target.value.replace(/\D/g,'').slice(0,2))} placeholder="MM"   inputMode="numeric" style={{ ...serifInput, width: 42, textAlign: 'center' }} />
              <span style={{ fontFamily: SERIF, fontSize: 19, color: C.ink3 }}>/</span>
              <input value={bYear}  onChange={e => setBYear(e.target.value.replace(/\D/g,'').slice(0,4))}  placeholder="YYYY" inputMode="numeric" style={{ ...serifInput, width: 64, textAlign: 'center' }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '1px', color: C.ink3, marginLeft: 6 }}>DD · MM · YYYY</span>
            </div>
          </FieldRow>
          <FieldRow label="Phone" last>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" inputMode="tel" style={serifInput} />
          </FieldRow>
        </Card>

        {/* ── N° 02 Account ──────────────────────────────────────────────── */}
        <SectionHead n="02" name="Account" />
        <Card>
          <div style={{ padding: '13px 16px' }}>
            <p style={{ ...rowLabel, marginBottom: 7 }}>Email</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} inputMode="email"
                style={{ ...serifInput, flex: 1, minWidth: 0, fontSize: 18 }} />
              <button type="button" onClick={verifyEmail} disabled={!newEmail || newEmail === email}
                style={{
                  flexShrink: 0, padding: '8px 16px', borderRadius: 99,
                  background: 'transparent',
                  border: `1px solid ${(!newEmail || newEmail === email) ? C.line : C.accent}`,
                  color: (!newEmail || newEmail === email) ? C.ink3 : C.accent,
                  fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase',
                  cursor: 'pointer',
                }}>
                Verify
              </button>
            </div>
            {emailMsg && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: emailMsg.includes('sent') ? C.accent : C.accent }}>
                {emailMsg}
              </p>
            )}
          </div>
        </Card>

        {/* ── N° 03 Nightlife Preferences ────────────────────────────────── */}
        <SectionHead n="03" name="Nightlife Preferences" />
        <Card>
          <PrefRow k="budget" label="Typical budget"
            value={budgetTier(budget).label} sub={budgetTier(budget).range}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {BUDGET_TIERS.map(t => (
                <Chip key={t.value} label={`${t.label} · ${t.range}`}
                  active={budgetTier(budget).value === t.value} onClick={() => setBudget(t.value)} />
              ))}
            </div>
          </PrefRow>
          <PrefRow k="drinks" label="Drinks I like"
            value={summary(drinks)} sub={drinks.length ? `${drinks.length} selected` : ''}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {DRINK_CATEGORIES.filter(c => c.items.length > 0).map(cat => (
                <div key={cat.key}>
                  <p style={{ ...rowLabel, marginBottom: 8 }}>{cat.label}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {cat.items.map(item => (
                      <Chip key={item} label={item} active={drinks.includes(item)} onClick={() => toggleMulti(setDrinks, item)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PrefRow>
          <PrefRow k="music" label="Music I like"
            value={summary(music)} sub={music.length ? `${music.length} selected` : ''}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MUSIC_OPTIONS.map(o => <Chip key={o} label={o} active={music.includes(o)} onClick={() => toggleMulti(setMusic, o)} />)}
            </div>
          </PrefRow>
          <PrefRow k="vibe" label="My vibe" last
            value={summary(vibes)} sub={vibes.length ? `${vibes.length} selected` : ''}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VIBE_OPTIONS.map(o => <Chip key={o} label={o} active={vibes.includes(o)} onClick={() => toggleMulti(setVibes, o)} />)}
            </div>
          </PrefRow>
        </Card>

        {/* ── N° 04 Notifications ────────────────────────────────────────── */}
        <SectionHead n="04" name="Notifications" />
        <Card>
          {NOTIFS.map((n, i) => (
            <div key={n.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
              borderBottom: i < NOTIFS.length - 1 ? `1px solid ${C.line}` : 'none',
            }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontFamily: SERIF, fontSize: 18, color: C.ink }}>{n.label}</p>
                <p style={{ margin: 0, fontSize: 11.5, color: C.ink3 }}>{n.desc}</p>
              </div>
              <Toggle value={notifs[n.key]} onChange={v => toggleNotif(n.key, v)} />
              <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '1px', color: C.ink3, width: 30 }}>
                {notifs[n.key] ? 'SAVED' : ''}
              </span>
            </div>
          ))}
        </Card>

        {/* ── N° 05 Account Actions ──────────────────────────────────────── */}
        <SectionHead n="05" name="Account Actions" />
        <button type="button" onClick={signOut} style={{
          width: '100%', padding: '15px 0', borderRadius: 14,
          background: C.card, border: `1px solid ${C.line}`,
          color: C.ink, fontFamily: MONO, fontSize: 10.5, letterSpacing: '2px', textTransform: 'uppercase',
          cursor: 'pointer', marginBottom: 14,
        }}>
          Sign out
        </button>

        {!confirmDel ? (
          <button type="button" onClick={() => setConfirmDel(true)} style={{
            width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: C.accent, fontFamily: MONO, fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase',
          }}>
            Delete account
          </button>
        ) : (
          <div style={{ background: C.bannerBg, border: `1px solid ${C.accent}`, borderRadius: 14, padding: '18px 18px 16px' }}>
            <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.accent, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>warning</span>
              This is permanent
            </p>
            <h3 style={{ margin: '0 0 8px', fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 23, color: C.accent }}>
              Delete account?
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>
              All your reviews, Fiamme, and membership history will be erased. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmDel(false)} disabled={deleting} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, background: C.card, border: `1px solid ${C.line}`,
                color: C.ink, fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer',
              }}>
                Keep account
              </button>
              <button type="button" onClick={deleteAccount} disabled={deleting} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, background: C.accentDk, border: 'none',
                color: '#FFFFFF', fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase',
                cursor: 'pointer', opacity: deleting ? 0.7 : 1,
              }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 30, paddingTop: 18 }}>
          <p style={{ textAlign: 'center', fontFamily: MONO, fontSize: 8.5, letterSpacing: '2px', textTransform: 'uppercase', color: C.ink3, margin: 0 }}>
            Club Fuoco · v1.0.0 · MMXXVI
          </p>
        </div>
      </div>

      {/* ── Unsaved-changes bar ──────────────────────────────────────────── */}
      {dirty && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: C.bg, borderTop: `1px solid ${C.line}`,
          boxShadow: '0 -8px 24px rgba(42,36,32,0.06)',
          paddingTop: 13, paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 13px)',
          paddingLeft: 18, paddingRight: 18,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.accent }}>
            Unsaved changes
          </span>
          <button type="button" onClick={() => window.location.reload()} style={{
            padding: '10px 16px', borderRadius: 10, background: 'transparent', border: `1px solid ${C.line}`,
            color: C.ink2, fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer',
          }}>
            Discard
          </button>
          <button type="button" onClick={saveAll} disabled={saving} style={{
            padding: '11px 20px', borderRadius: 10, background: C.accent, border: 'none',
            color: '#FFFFFF', fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}
