'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { MUSIC_OPTIONS, VIBE_OPTIONS, DRINK_CATEGORIES, BUDGET_NO_LIMIT } from '@/lib/preferences'

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const C = {
  bg:      '#F8F5EE',
  surface: '#FFFFFF',
  ink:     '#221E1A',
  ink2:    '#6E6356',
  ink3:    '#9F9486',
  accent:  '#8C2A2A',
  gold:    '#B8941E',
  line:    'rgba(34,30,26,0.08)',
  pillBg:  'rgba(34,30,26,0.05)',
  dark:    '#1A1612',
}

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

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function budgetTier(v: number) {
  if (v >= BUDGET_NO_LIMIT) return BUDGET_TIERS[3]
  if (v >= 80)  return BUDGET_TIERS[2]
  if (v >= 30)  return BUDGET_TIERS[1]
  return BUDGET_TIERS[0]
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 14px' }}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', color: C.gold, fontWeight: 600 }}>
        N° {n}
      </span>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.ink3 }}>
        {label}
      </span>
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 13px', borderRadius: 99, fontSize: 12.5,
        fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
        cursor: 'pointer', transition: 'all 0.15s',
        background: active ? C.ink : 'transparent',
        color:      active ? C.bg : C.ink2,
        border: `1px solid ${active ? C.ink : C.line}`,
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 44, height: 26, borderRadius: 99, border: 'none', flexShrink: 0,
        background: value ? C.gold : 'rgba(34,30,26,0.15)',
        position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
      }} />
    </button>
  )
}

/* ─── Component ─────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const router   = useRouter()
  const supabase = createClient()

  // Profile
  const [userId,   setUserId]   = useState('')
  const [fullName, setFullName] = useState('')
  const [phone,    setPhone]    = useState('')
  const [email,    setEmail]    = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [bDay,     setBDay]     = useState('')
  const [bMonth,   setBMonth]   = useState('')
  const [bYear,    setBYear]    = useState('')

  // Preferences
  const [budget, setBudget] = useState(55)
  const [drinks, setDrinks] = useState<string[]>([])
  const [music,  setMusic]  = useState<string[]>([])
  const [vibes,  setVibes]  = useState<string[]>([])
  const [notifs, setNotifs] = useState<NotifState>(
    Object.fromEntries(NOTIFS.map(n => [n.key, true]))
  )

  // UI state
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [emailMsg,  setEmailMsg]  = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  // Last-saved snapshot (for unsaved-changes detection) + last-saved prefs
  const [snapshot, setSnapshot] = useState('')
  const savedPrefs = useRef<any>({})

  function snapOf() {
    return JSON.stringify({
      fullName, phone, bDay, bMonth, bYear, budget,
      drinks: [...drinks].sort(),
      music:  [...music].sort(),
      vibes:  [...vibes].sort(),
    })
  }
  const dirty = !loading && snapOf() !== snapshot

  /* ── Load ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      setEmail(user.email ?? '')
      setNewEmail(user.email ?? '')

      const { data: profile } = await supabase
        .from('users')
        .select('full_name, phone, birthday, preferences')
        .eq('id', user.id)
        .single() as any

      let nextNotifs = Object.fromEntries(NOTIFS.map(n => [n.key, true])) as NotifState

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
        nextNotifs = Object.fromEntries(NOTIFS.map(x => [x.key, n[x.key] ?? true]))
        setNotifs(nextNotifs)
        savedPrefs.current = {
          budget: p.budget ?? 55,
          drinks: p.drinks ?? [],
          music_genres: p.music_genres ?? [],
          vibes: p.vibes ?? [],
          notifications: nextNotifs,
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  // Capture the saved snapshot once everything has loaded
  useEffect(() => {
    if (!loading && !snapshot) setSnapshot(snapOf())
  }, [loading])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Save (Personal / Account / Preferences) ──────────────────────────── */
  async function saveAll() {
    if (!userId) return
    setSaving(true)
    const birthday = (bDay && bMonth && bYear)
      ? `${bYear}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`
      : null
    const preferences = {
      budget,
      drinks,
      music_genres: music,
      vibes,
      notifications: notifs,
    }
    await (supabase as any).from('users').update({
      full_name: fullName,
      phone:     phone || null,
      birthday,
      preferences,
    }).eq('id', userId)
    savedPrefs.current = preferences
    setSnapshot(snapOf())
    setSaving(false)
  }

  function discard() {
    // Reload from server to restore last-saved values
    window.location.reload()
  }

  /* ── Notifications save instantly ─────────────────────────────────────── */
  async function toggleNotif(key: string, value: boolean) {
    const next = { ...notifs, [key]: value }
    setNotifs(next)
    if (!userId) return
    const merged = { ...savedPrefs.current, notifications: next }
    savedPrefs.current = merged
    await (supabase as any).from('users').update({ preferences: merged }).eq('id', userId)
  }

  /* ── Email ────────────────────────────────────────────────────────────── */
  async function verifyEmail() {
    if (!newEmail || newEmail === email) return
    setEmailMsg('')
    const { error } = await supabase.auth.updateUser({ email: newEmail })
    setEmailMsg(error ? error.message : `Confirmation link sent to ${newEmail}`)
  }

  /* ── Account actions ──────────────────────────────────────────────────── */
  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  async function deleteAccount() {
    setDeleting(true)
    try {
      const res = await apiFetch('/api/account/delete', { method: 'POST' })
      if (res.ok) {
        await supabase.auth.signOut()
        router.replace('/login')
      } else {
        setDeleting(false)
        setDeleteOpen(false)
      }
    } catch {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  function toggleMulti(setter: React.Dispatch<React.SetStateAction<string[]>>, v: string) {
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  /* ── Reusable bits ────────────────────────────────────────────────────── */
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
    padding: '12px 14px', fontSize: 15, color: C.ink, outline: 'none',
    fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
  }
  const fieldLabel: React.CSSProperties = {
    fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1px',
    textTransform: 'uppercase', color: C.ink3, margin: '0 0 7px',
  }

  /* Expandable preference row */
  function PrefRow({ rowKey, label, summary, count, children }: {
    rowKey: string; label: string; summary: string; count?: string
    children: React.ReactNode
  }) {
    const open = expanded === rowKey
    return (
      <div style={{ borderBottom: `1px solid ${C.line}` }}>
        <button
          type="button"
          onClick={() => setExpanded(open ? null : rowKey)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            padding: '15px 2px', display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 500, color: C.ink, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {label}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.ink3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {summary}
            </p>
          </div>
          {count && (
            <span style={{ fontSize: 11, color: C.gold, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
          )}
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.ink3, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            expand_more
          </span>
        </button>
        {open && <div style={{ padding: '2px 2px 18px' }}>{children}</div>}
      </div>
    )
  }

  /* ── Loading ──────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 36, color: C.ink3, animation: 'spin 1s linear infinite' }}>settings</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>

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
        <p style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.ink3 }}>
          N° 07 · IMPOSTAZIONI
        </p>
        <div style={{ width: 36 }} />
      </header>

      <div style={{ padding: '24px 20px 160px' }}>

        {/* Title block */}
        <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.gold, margin: '0 0 8px' }}>
          Your Account
        </p>
        <h1 style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontWeight: 400, fontSize: 38, color: C.ink, margin: '0 0 8px', lineHeight: 1.05 }}>
          Impostazioni
        </h1>
        <p style={{ fontSize: 13, color: C.ink2, margin: '0 0 6px', lineHeight: 1.5 }}>
          Personal details, preferences, and what we send you.
        </p>
        <p style={{ fontSize: 11.5, color: C.ink3, margin: '0 0 32px', lineHeight: 1.5 }}>
          Personal, Account &amp; Preferences need <span style={{ color: C.ink2, fontWeight: 500 }}>Save</span>. Notifications save instantly.
        </p>

        {/* ── N° 01 Personal ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionLabel n="01" label="Personal" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p style={fieldLabel}>Full name</p>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" style={inputStyle} />
            </div>
            <div>
              <p style={fieldLabel}>Birthday</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={bDay} onChange={e => setBDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="DD" inputMode="numeric" style={{ ...inputStyle, textAlign: 'center', width: 60, flexShrink: 0 }} />
                <span style={{ color: C.ink3 }}>/</span>
                <input value={bMonth} onChange={e => setBMonth(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="MM" inputMode="numeric" style={{ ...inputStyle, textAlign: 'center', width: 60, flexShrink: 0 }} />
                <span style={{ color: C.ink3 }}>/</span>
                <input value={bYear} onChange={e => setBYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" inputMode="numeric" style={{ ...inputStyle, textAlign: 'center', width: 84, flexShrink: 0 }} />
              </div>
            </div>
            <div>
              <p style={fieldLabel}>Phone</p>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" inputMode="tel" style={inputStyle} />
            </div>
          </div>
        </section>

        {/* ── N° 02 Account ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionLabel n="02" label="Account" />
          <p style={fieldLabel}>Email</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} inputMode="email" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
            <button
              type="button"
              onClick={verifyEmail}
              disabled={!newEmail || newEmail === email}
              style={{
                flexShrink: 0, padding: '0 18px', borderRadius: 12, border: 'none',
                background: (!newEmail || newEmail === email) ? C.pillBg : C.ink,
                color: (!newEmail || newEmail === email) ? C.ink3 : C.bg,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
              }}
            >
              Verify
            </button>
          </div>
          {emailMsg && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: emailMsg.includes('sent') ? C.gold : C.accent }}>
              {emailMsg}
            </p>
          )}
        </section>

        {/* ── N° 03 Nightlife Preferences ────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionLabel n="03" label="Nightlife Preferences" />

          <PrefRow rowKey="budget" label="Typical budget"
            summary={`${budgetTier(budget).label} · ${budgetTier(budget).range}`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {BUDGET_TIERS.map(t => (
                <Chip key={t.value} label={`${t.label} · ${t.range}`}
                  active={budgetTier(budget).value === t.value}
                  onClick={() => setBudget(t.value)} />
              ))}
            </div>
          </PrefRow>

          <PrefRow rowKey="drinks" label="Drinks I like"
            summary={drinks.length ? drinks.slice(0, 3).join(' · ') : 'None selected'}
            count={drinks.length ? `${drinks.length} selected` : undefined}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {DRINK_CATEGORIES.filter(c => c.items.length > 0).map(cat => (
                <div key={cat.key}>
                  <p style={{ ...fieldLabel, margin: '0 0 8px' }}>{cat.label}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {cat.items.map(item => (
                      <Chip key={item} label={item}
                        active={drinks.includes(item)}
                        onClick={() => toggleMulti(setDrinks, item)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PrefRow>

          <PrefRow rowKey="music" label="Music I like"
            summary={music.length ? music.slice(0, 3).join(' · ') : 'None selected'}
            count={music.length ? `${music.length} selected` : undefined}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MUSIC_OPTIONS.map(o => (
                <Chip key={o} label={o} active={music.includes(o)} onClick={() => toggleMulti(setMusic, o)} />
              ))}
            </div>
          </PrefRow>

          <PrefRow rowKey="vibe" label="My vibe"
            summary={vibes.length ? vibes.slice(0, 3).join(' · ') : 'None selected'}
            count={vibes.length ? `${vibes.length} selected` : undefined}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VIBE_OPTIONS.map(o => (
                <Chip key={o} label={o} active={vibes.includes(o)} onClick={() => toggleMulti(setVibes, o)} />
              ))}
            </div>
          </PrefRow>
        </section>

        {/* ── N° 04 Notifications ────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionLabel n="04" label="Notifications" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NOTIFS.map((n, i) => (
              <div key={n.key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 2px',
                borderBottom: i < NOTIFS.length - 1 ? `1px solid ${C.line}` : 'none',
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 500, color: C.ink }}>{n.label}</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.ink3 }}>{n.desc}</p>
                </div>
                <Toggle value={notifs[n.key]} onChange={v => toggleNotif(n.key, v)} />
              </div>
            ))}
          </div>
        </section>

        {/* ── N° 05 Account Actions ──────────────────────────────────────── */}
        <section style={{ marginBottom: 28 }}>
          <SectionLabel n="05" label="Account Actions" />
          <button
            type="button"
            onClick={signOut}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 12,
              background: C.surface, border: `1px solid ${C.line}`,
              color: C.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'Geist, -apple-system, system-ui, sans-serif', marginBottom: 10,
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 12,
              background: 'none', border: 'none',
              color: C.accent, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
            }}
          >
            Delete account
          </button>
        </section>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: C.ink3, margin: 0 }}>
          Club Fuoco · v1.0.0 · MMXXVI
        </p>
      </div>

      {/* ── Unsaved-changes bar ──────────────────────────────────────────── */}
      {dirty && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: C.dark,
          paddingTop: 14, paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 14px)',
          paddingLeft: 20, paddingRight: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            Unsaved changes
          </span>
          <button
            type="button"
            onClick={discard}
            style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            style={{ padding: '10px 20px', borderRadius: 10, background: C.gold, border: 'none', color: '#1A1008', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      {deleteOpen && (
        <>
          <div
            onClick={() => !deleting && setDeleteOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(26,22,18,0.55)' }}
          />
          <div style={{
            position: 'fixed', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)',
            zIndex: 50, background: C.surface, borderRadius: 18, padding: '24px 22px',
          }}>
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.accent, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
              This is permanent
            </p>
            <h2 style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontWeight: 400, fontSize: 26, color: C.ink, margin: '0 0 10px' }}>
              Delete account?
            </h2>
            <p style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55, margin: '0 0 22px' }}>
              All your reviews, Fiamme, and membership history will be erased. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: C.pillBg, border: 'none', color: C.ink, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
              >
                Keep account
              </button>
              <button
                type="button"
                onClick={deleteAccount}
                disabled={deleting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: C.accent, border: 'none', color: '#FFFFFF', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
