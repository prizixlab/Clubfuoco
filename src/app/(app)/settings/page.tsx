'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { MUSIC_OPTIONS, VIBE_OPTIONS, DRINK_CATEGORIES, BUDGET_NO_LIMIT } from '@/lib/preferences'
import { useAuth } from '@/contexts/AuthContext'
import { Iap, isIapAvailable } from '@/lib/iap'
import { useLocale, type LocaleSetting } from '@/contexts/LocaleContext'

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
const NOTIF_KEYS = ['openings', 'curator', 'guestlist', 'concierge'] as const
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

/* Custom touch slider — native <input range> doesn't drag on iOS WebView */
const SLIDER_MIN = 10
const SLIDER_MAX = 200
const SLIDER_STEP = 5
function BudgetSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  // keep onChange fresh inside the long-lived native listeners
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // value here is already clamped to 10–200 (200 = ∞)
  const pct = ((value - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100

  // Native, NON-PASSIVE touch listeners. React's synthetic onTouch* handlers
  // are registered passive, so preventDefault() there is a no-op and the
  // -webkit-overflow-scrolling momentum scroller steals the drag. Attaching
  // directly with { passive: false } lets preventDefault() actually work.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    const posToValue = (clientX: number) => {
      const rect = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN)
      return Math.round(raw / SLIDER_STEP) * SLIDER_STEP
    }
    const onTouch = (e: TouchEvent) => {
      e.preventDefault()        // genuinely blocks the scroll now
      const t = e.touches[0] ?? e.changedTouches[0]
      if (t) onChangeRef.current(posToValue(t.clientX))
    }

    el.addEventListener('touchstart', onTouch, { passive: false })
    el.addEventListener('touchmove',  onTouch, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouch)
      el.removeEventListener('touchmove',  onTouch)
    }
  }, [])

  // Desktop / mouse fallback
  const posToValueMouse = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return value
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN)
    return Math.round(raw / SLIDER_STEP) * SLIDER_STEP
  }
  const onMouse = useCallback((e: React.MouseEvent) => {
    if (e.type === 'mousemove' && e.buttons !== 1) return
    onChange(posToValueMouse(e.clientX))
  }, [onChange]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={trackRef}
      onMouseDown={onMouse}
      onMouseMove={onMouse}
      style={{
        position: 'relative', height: 40, display: 'flex', alignItems: 'center',
        cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
        touchAction: 'none',  // critical — prevents scroll stealing
      }}
    >
      {/* track background */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 3,
        background: 'rgba(42,36,32,0.13)', borderRadius: 2,
      }} />
      {/* filled portion */}
      <div style={{
        position: 'absolute', left: 0, width: `${pct}%`, height: 3,
        background: C.accent, borderRadius: 2,
      }} />
      {/* thumb */}
      <div style={{
        position: 'absolute', left: `calc(${pct}% - 12px)`,
        width: 24, height: 24, borderRadius: '50%',
        background: C.accent,
        boxShadow: '0 2px 8px rgba(140,42,42,0.4)',
        pointerEvents: 'none',
      }} />
    </div>
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
  const { user: authUser } = useAuth()
  const { t, setting, setLocaleSetting } = useLocale()

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
  const [notifs, setNotifs] = useState<NotifState>(Object.fromEntries(NOTIF_KEYS.map(k => [k, true])))

  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [emailMsg,   setEmailMsg]   = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [snapshot,   setSnapshot]   = useState('')
  const [tier,       setTier]       = useState('free')
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
    if (!authUser) return   // layout already guards; wait if not ready yet
    ;(async () => {
      const user = authUser
      setUserId(user.id)
      setEmail(user.email ?? ''); setNewEmail(user.email ?? '')

      const { data: profile } = await supabase
        .from('users').select('full_name, phone, birthday, preferences, membership_tier')
        .eq('id', user.id).single() as any

      if (profile) {
        setFullName(profile.full_name ?? '')
        setTier(profile.membership_tier ?? 'free')
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
        const nx = Object.fromEntries(NOTIF_KEYS.map(k => [k, n[k] ?? true]))
        setNotifs(nx)
        savedPrefs.current = {
          budget: p.budget ?? 55, drinks: p.drinks ?? [],
          music_genres: p.music_genres ?? [], vibes: p.vibes ?? [], notifications: nx,
        }
      }
      setLoading(false)
    })()
  }, [authUser])  // eslint-disable-line react-hooks/exhaustive-deps

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

  // Cancelling an Apple subscription must go through Apple's own system sheet —
  // the app cannot cancel it server-side. This opens Apple's "Manage
  // Subscriptions" UI, where the user can cancel Club Fuoco.
  async function cancelSubscription() {
    if (isIapAvailable()) {
      try {
        await Iap.manageSubscriptions()
      } catch {
        window.open('https://apps.apple.com/account/subscriptions', '_blank')
      }
    } else {
      window.open('https://apps.apple.com/account/subscriptions', '_blank')
    }
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
        <style>{`
          .budget-slider{-webkit-appearance:none;appearance:none;height:3px;background:rgba(42,36,32,0.13);border-radius:2px;outline:none;}
          .budget-slider::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#8C2A2A;cursor:pointer;box-shadow:0 2px 8px rgba(140,42,42,0.35);}
          .budget-slider::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#8C2A2A;cursor:pointer;border:none;box-shadow:0 2px 8px rgba(140,42,42,0.35);}
          .budget-slider::-webkit-slider-runnable-track{height:3px;border-radius:2px;}
        `}</style>
      </div>
    )
  }

  const summary = (arr: string[]) => arr.length ? arr.slice(0, 3).join(' · ') : t('settings.noneYet')

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: SANS }}>
      <style>{`
        .budget-slider{-webkit-appearance:none;appearance:none;height:3px;background:rgba(42,36,32,0.13);border-radius:2px;outline:none;width:100%;}
        .budget-slider::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#8C2A2A;cursor:pointer;box-shadow:0 2px 8px rgba(140,42,42,0.35);}
        .budget-slider::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#8C2A2A;cursor:pointer;border:none;box-shadow:0 2px 8px rgba(140,42,42,0.35);}
        .budget-slider::-webkit-slider-runnable-track{height:3px;border-radius:2px;}
      `}</style>

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
        {dirty ? (
          <button type="button" onClick={saveAll} disabled={saving} style={{
            height: 34, padding: '0 16px', borderRadius: 99, border: 'none',
            background: C.accent, color: '#FFF',
            fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase',
            cursor: 'pointer', opacity: saving ? 0.7 : 1,
          }}>
            {saving ? '…' : t('settings.save')}
          </button>
        ) : (
          <div style={{ width: 36 }} />
        )}
      </header>

      <div style={{ padding: '26px 20px 150px' }}>

        {/* Title block */}
        <p style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: C.ink3, margin: '0 0 6px' }}>
          {t('settings.yourAccount')}
        </p>
        <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 46, color: C.ink, margin: '0 0 8px', lineHeight: 1 }}>
          Impostazioni
        </h1>
        <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, color: C.ink2, margin: '0 0 18px', lineHeight: 1.4 }}>
          {t('settings.subtitle')}
        </p>

        {/* Info banner */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          background: C.bannerBg, border: `1px solid rgba(140,42,42,0.18)`,
          borderRadius: 12, padding: '12px 14px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.accent, flexShrink: 0, marginTop: 1 }}>info</span>
          <p style={{ margin: 0, fontSize: 12, color: C.ink2, lineHeight: 1.5 }}>
            {t('settings.infoNote')}
          </p>
        </div>

        {/* ── N° 01 Personal ─────────────────────────────────────────────── */}
        <SectionHead n="01" name={t('settings.personal')} />
        <Card>
          <FieldRow label={t('settings.fullName')}>
            <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" style={serifInput} />
          </FieldRow>
          <FieldRow label={t('settings.birthday')}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <input value={bDay}   onChange={e => setBDay(e.target.value.replace(/\D/g,'').slice(0,2))}   placeholder="DD"   inputMode="numeric" style={{ ...serifInput, width: 38, textAlign: 'center' }} />
              <span style={{ fontFamily: SERIF, fontSize: 19, color: C.ink3 }}>/</span>
              <input value={bMonth} onChange={e => setBMonth(e.target.value.replace(/\D/g,'').slice(0,2))} placeholder="MM"   inputMode="numeric" style={{ ...serifInput, width: 42, textAlign: 'center' }} />
              <span style={{ fontFamily: SERIF, fontSize: 19, color: C.ink3 }}>/</span>
              <input value={bYear}  onChange={e => setBYear(e.target.value.replace(/\D/g,'').slice(0,4))}  placeholder="YYYY" inputMode="numeric" style={{ ...serifInput, width: 64, textAlign: 'center' }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '1px', color: C.ink3, marginLeft: 6 }}>DD · MM · YYYY</span>
            </div>
          </FieldRow>
          <FieldRow label={t('settings.phone')} last>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" inputMode="tel" style={serifInput} />
          </FieldRow>
        </Card>

        {/* ── N° 02 Account ──────────────────────────────────────────────── */}
        <SectionHead n="02" name={t('settings.account')} />
        <Card>
          <div style={{ padding: '13px 16px' }}>
            <p style={{ ...rowLabel, marginBottom: 7 }}>{t('settings.email')}</p>
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
                {t('settings.verify')}
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
        <SectionHead n="03" name={t('settings.nightlifePrefs')} />
        <Card>
          <PrefRow k="budget" label={t('settings.typicalBudget')}
            value={budget >= BUDGET_NO_LIMIT ? '∞' : `€${budget}`}
            sub={budget >= BUDGET_NO_LIMIT ? t('settings.noLimit') : t('settings.perNight')}>
            <div style={{ paddingTop: 4 }}>
              {/* value display */}
              <div style={{ textAlign: 'center', marginBottom: 18 }}>
                <p style={{ margin: 0, fontFamily: SERIF, fontStyle: 'italic', fontSize: 54, color: C.ink, lineHeight: 1 }}>
                  {budget >= BUDGET_NO_LIMIT ? '∞' : `€${budget}`}
                </p>
                <p style={{ margin: '5px 0 0', fontFamily: MONO, fontSize: 8.5, letterSpacing: '2px', textTransform: 'uppercase', color: C.ink3 }}>
                  {budget >= BUDGET_NO_LIMIT ? t('settings.vipMode') : t('settings.perNight')}
                </p>
              </div>
              {/* slider */}
              <BudgetSlider
                value={budget >= BUDGET_NO_LIMIT ? 200 : budget}
                onChange={v => setBudget(v >= 200 ? BUDGET_NO_LIMIT : v)}
              />
              {/* tick labels */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                {['€10', '€50', '€100', '€150', '∞'].map(l => (
                  <span key={l} style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '1px', color: C.ink3 }}>{l}</span>
                ))}
              </div>
            </div>
          </PrefRow>
          <PrefRow k="drinks" label={t('settings.drinksILike')}
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
          <PrefRow k="music" label={t('settings.musicILike')}
            value={summary(music)} sub={music.length ? `${music.length} selected` : ''}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MUSIC_OPTIONS.map(o => <Chip key={o} label={o} active={music.includes(o)} onClick={() => toggleMulti(setMusic, o)} />)}
            </div>
          </PrefRow>
          <PrefRow k="vibe" label={t('settings.myVibe')} last
            value={summary(vibes)} sub={vibes.length ? `${vibes.length} selected` : ''}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VIBE_OPTIONS.map(o => <Chip key={o} label={o} active={vibes.includes(o)} onClick={() => toggleMulti(setVibes, o)} />)}
            </div>
          </PrefRow>
        </Card>

        {/* ── N° 04 Notifications ────────────────────────────────────────── */}
        <SectionHead n="04" name={t('settings.notifications')} />
        <Card>
          {NOTIF_KEYS.map((k, i) => (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
              borderBottom: i < NOTIF_KEYS.length - 1 ? `1px solid ${C.line}` : 'none',
            }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontFamily: SERIF, fontSize: 18, color: C.ink }}>
                  {t(`notif.${k}.label` as any)}
                </p>
                <p style={{ margin: 0, fontSize: 11.5, color: C.ink3 }}>
                  {t(`notif.${k}.desc` as any)}
                </p>
              </div>
              <Toggle value={notifs[k]} onChange={v => toggleNotif(k, v)} />
              <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '1px', color: C.ink3, width: 40 }}>
                {notifs[k] ? t('settings.saved') : ''}
              </span>
            </div>
          ))}
        </Card>

        {/* ── N° 05 Language ─────────────────────────────────────────────── */}
        <SectionHead n="05" name={t('settings.language')} />
        <Card>
          {(['en', 'es', 'device'] as LocaleSetting[]).map((opt, i, arr) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLocaleSetting(opt)}
              style={{
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '15px 16px',
                borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                textAlign: 'left',
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 19, color: C.ink }}>
                {t(`settings.lang.${opt}` as any)}
              </span>
              {setting === opt && (
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.accent }}>
                  check
                </span>
              )}
            </button>
          ))}
        </Card>

        {/* ── N° 06 Account Actions ──────────────────────────────────────── */}
        <SectionHead n="06" name={t('settings.accountActions')} />

        {tier !== 'free' && (
          <>
            <button type="button" onClick={cancelSubscription} style={{
              width: '100%', padding: '15px 0', borderRadius: 14,
              background: C.card, border: `1px solid ${C.line}`,
              color: C.ink, fontFamily: MONO, fontSize: 10.5, letterSpacing: '2px', textTransform: 'uppercase',
              cursor: 'pointer', marginBottom: 6,
            }}>
              {t('settings.cancelSubscription')}
            </button>
            <p style={{
              margin: '0 0 14px', fontSize: 11, lineHeight: 1.5, color: C.ink2,
              fontFamily: 'Inter, sans-serif', textAlign: 'center',
            }}>
              {t('settings.cancelSubNote')}
            </p>
          </>
        )}

        <button type="button" onClick={signOut} style={{
          width: '100%', padding: '15px 0', borderRadius: 14,
          background: C.card, border: `1px solid ${C.line}`,
          color: C.ink, fontFamily: MONO, fontSize: 10.5, letterSpacing: '2px', textTransform: 'uppercase',
          cursor: 'pointer', marginBottom: 14,
        }}>
          {t('settings.signOut')}
        </button>

        {!confirmDel ? (
          <button type="button" onClick={() => setConfirmDel(true)} style={{
            width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: C.accent, fontFamily: MONO, fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase',
          }}>
            {t('settings.deleteAccount')}
          </button>
        ) : (
          <div style={{ background: C.bannerBg, border: `1px solid ${C.accent}`, borderRadius: 14, padding: '18px 18px 16px' }}>
            <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.accent, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>warning</span>
              {t('settings.permanent')}
            </p>
            <h3 style={{ margin: '0 0 8px', fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 23, color: C.accent }}>
              {t('settings.deleteQuestion')}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>
              {t('settings.deleteWarning')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmDel(false)} disabled={deleting} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, background: C.card, border: `1px solid ${C.line}`,
                color: C.ink, fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer',
              }}>
                {t('settings.keepAccount')}
              </button>
              <button type="button" onClick={deleteAccount} disabled={deleting} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, background: C.accentDk, border: 'none',
                color: '#FFFFFF', fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase',
                cursor: 'pointer', opacity: deleting ? 0.7 : 1,
              }}>
                {deleting ? t('settings.deleting') : t('settings.yesDelete')}
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

      {/* ── Unsaved indicator (dot only — save is in header) ────────────── */}
      {dirty && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: C.bg, borderTop: `1px solid ${C.line}`,
          boxShadow: '0 -8px 24px rgba(42,36,32,0.06)',
          paddingTop: 11, paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 11px)',
          paddingLeft: 18, paddingRight: 18,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.accent }}>
            {t('settings.unsavedChanges')}
          </span>
          <button type="button" onClick={() => window.location.reload()} style={{
            padding: '9px 14px', borderRadius: 10, background: 'transparent', border: `1px solid ${C.line}`,
            color: C.ink2, fontFamily: MONO, fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer',
          }}>
            {t('settings.discard')}
          </button>
        </div>
      )}
    </div>
  )
}
