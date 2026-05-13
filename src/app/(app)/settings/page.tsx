'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import NavSpacer from '@/components/NavSpacer'
import DrinkStep from '@/components/DrinkStep'
import { MUSIC_OPTIONS, VIBE_OPTIONS, BUDGET_NO_LIMIT } from '@/lib/preferences'

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS          = ['January','February','March','April','May','June','July','August','September','October','November','December']
const CURRENT_YEAR    = new Date().getFullYear()
const YEARS           = Array.from({ length: 82 }, (_, i) => CURRENT_YEAR - 17 - i)

// ── Helper components ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-sm">
      <h3 className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest px-xs">{title}</h3>
      <div className="glass-card rounded-2xl overflow-hidden divide-y divide-outline-variant/10">
        {children}
      </div>
    </div>
  )
}

function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="px-md py-sm space-y-sm">
      <div className="flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
        <span className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">{label}</span>
      </div>
      {children}
    </div>
  )
}

function PillSelect({ options, selected, onToggle, single }: {
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
  single?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-xs">
      {options.map(o => {
        const active = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`px-sm py-xs rounded-full text-sm font-medium transition-all active:scale-95 ${
              active
                ? 'bg-primary-container text-on-primary-container border border-primary/40'
                : 'bg-surface-container-high text-on-surface-variant/70 border border-transparent'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative w-12 h-6 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-surface-container-high'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${value ? 'left-[26px]' : 'left-0.5'}`} />
    </button>
  )
}

function BudgetSlider({ budget, setBudget }: { budget: number; setBudget: (v: number) => void }) {
  const noLimit  = budget >= BUDGET_NO_LIMIT
  const sliderVal = noLimit ? 200 : budget

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseInt(e.target.value)
    setBudget(v >= 200 ? BUDGET_NO_LIMIT : v)
  }

  return (
    <div className="space-y-md py-xs">
      <div className="text-center">
        <p className="font-display text-[44px] text-primary leading-none">{noLimit ? '∞' : `€${sliderVal}`}</p>
        <p className="font-body-md text-on-surface-variant/60 text-sm mt-xs">
          {noLimit ? 'No limit — VIP mode' : `under €${sliderVal} per night`}
        </p>
      </div>
      <div className="px-xs space-y-xs">
        <input
          type="range" min={10} max={200} step={5}
          value={sliderVal} onChange={handleChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary bg-surface-container-highest"
        />
        <div className="flex justify-between font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">
          <span>€10</span><span>€50</span><span>€100</span><span>€150</span><span>∞</span>
        </div>
      </div>
      <div className="flex gap-xs justify-center flex-wrap">
        {[20, 50, 100, 150].map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setBudget(v)}
            className={`px-sm py-xs rounded-full border font-label-sm text-label-sm transition-all active:scale-95 ${
              budget === v
                ? 'border-primary bg-primary-container/30 text-primary'
                : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant/60'
            }`}
          >
            €{v}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setBudget(BUDGET_NO_LIMIT)}
          className={`px-sm py-xs rounded-full border font-label-sm text-label-sm transition-all active:scale-95 ${
            noLimit
              ? 'border-primary bg-primary-container/30 text-primary'
              : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant/60'
          }`}
        >
          No limit
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  // Profile fields
  const [userId,   setUserId]   = useState('')
  const [fullName, setFullName] = useState('')
  const [phone,    setPhone]    = useState('')
  const [email,    setEmail]    = useState('')
  const [newEmail, setNewEmail] = useState('')

  // Birthday
  const [bDay,   setBDay]   = useState('')
  const [bMonth, setBMonth] = useState('')
  const [bYear,  setBYear]  = useState('')

  // Preferences (stored in users.preferences JSON)
  const [budget,       setBudget]       = useState<number>(50)
  const [drinks,       setDrinks]       = useState<string[]>([])
  const [musicGenres,  setMusicGenres]  = useState<string[]>([])
  const [vibes,        setVibes]        = useState<string[]>([])

  // Notification toggles
  const [notifBirthday,  setNotifBirthday]  = useState(true)
  const [notifNewClubs,  setNotifNewClubs]  = useState(true)
  const [notifGuestList, setNotifGuestList] = useState(true)
  const [notifEvents,    setNotifEvents]    = useState(true)

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [emailMsg, setEmailMsg] = useState('')

  // ── Load current data ──────────────────────────────────────────────────────
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

      if (profile) {
        setFullName(profile.full_name ?? '')
        setPhone(profile.phone ?? '')

        if (profile.birthday) {
          const [y, m, d] = (profile.birthday as string).split('-')
          setBYear(y); setBMonth(String(parseInt(m))); setBDay(String(parseInt(d)))
        }

        const p = profile.preferences ?? {}
        setBudget(p.budget ?? 50)
        setDrinks(p.drinks ?? [])
        setMusicGenres(p.music_genres ?? [])
        setVibes(p.vibes ?? [])

        const n = p.notifications ?? {}
        setNotifBirthday(n.birthday_deals ?? true)
        setNotifNewClubs(n.new_clubs ?? true)
        setNotifGuestList(n.guest_list ?? true)
        setNotifEvents(n.events ?? true)
      }
      setLoading(false)
    }
    load()
  }, [])

  function toggleMulti(setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  function toggleSingle(setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) {
    setter(prev => prev.includes(value) ? [] : [value])
  }

  // ── Save all ───────────────────────────────────────────────────────────────
  async function saveAll() {
    if (!userId) return
    setSaving(true)

    const birthday = (bDay && bMonth && bYear)
      ? `${bYear}-${String(bMonth).padStart(2,'0')}-${String(bDay).padStart(2,'0')}`
      : null

    const preferences = {
      budget,
      drinks,
      music_genres: musicGenres,
      vibes,
      notifications: {
        birthday_deals: notifBirthday,
        new_clubs:      notifNewClubs,
        guest_list:     notifGuestList,
        events:         notifEvents,
      },
    }

    await (supabase as any).from('users').update({
      full_name:   fullName,
      phone:       phone || null,
      birthday,
      preferences,
    }).eq('id', userId)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  // ── Change email ───────────────────────────────────────────────────────────
  async function changeEmail() {
    if (!newEmail || newEmail === email) return
    setEmailMsg('')
    const { error } = await supabase.auth.updateUser({ email: newEmail })
    if (error) {
      setEmailMsg(error.message)
    } else {
      setEmailMsg('Confirmation link sent to ' + newEmail)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[40px] text-primary animate-pulse">settings</span>
    </div>
  )

  return (
    <div className="px-container-padding pb-32 pt-base space-y-gutter">
      {/* Header */}
      <div className="flex items-center gap-md mb-md">
        <button onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center active:scale-90">
          <span className="material-symbols-outlined text-[20px] text-on-surface">arrow_back</span>
        </button>
        <h1 className="font-h1 text-h1 text-on-surface">Settings</h1>
      </div>

      {/* ── Personal ─────────────────────────────────────────────────── */}
      <Section title="Personal">
        <Row icon="badge" label="Full Name">
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Your name"
            className="vibe-input w-full"
          />
        </Row>

        <Row icon="cake" label="Birthday">
          <div className="flex gap-sm">
            <div className="flex-1 space-y-xs">
              <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Day</p>
              <select value={bDay} onChange={e => setBDay(e.target.value)}
                style={{ textAlignLast: 'center' }}
                className="w-full h-12 bg-surface-container-high rounded-xl border border-white/[0.06] text-center text-on-surface font-semibold text-[16px] appearance-none">
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="flex-[2] space-y-xs">
              <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Month</p>
              <select value={bMonth} onChange={e => setBMonth(e.target.value)}
                style={{ textAlignLast: 'center' }}
                className="w-full h-12 bg-surface-container-high rounded-xl border border-white/[0.06] text-center text-on-surface font-semibold text-[13px] appearance-none">
                <option value="">—</option>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex-[1.3] space-y-xs">
              <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Year</p>
              <select value={bYear} onChange={e => setBYear(e.target.value)}
                style={{ textAlignLast: 'center' }}
                className="w-full h-12 bg-surface-container-high rounded-xl border border-white/[0.06] text-center text-on-surface font-semibold text-[14px] appearance-none">
                <option value="">—</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </Row>

        <Row icon="phone" label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+34 600 000 000"
            className="vibe-input w-full"
          />
        </Row>
      </Section>

      {/* ── Email ────────────────────────────────────────────────────── */}
      <Section title="Account">
        <Row icon="email" label="Email Address">
          <div className="flex gap-sm">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="vibe-input flex-1 min-w-0"
            />
            <button
              type="button"
              onClick={changeEmail}
              disabled={newEmail === email || !newEmail}
              className="px-md h-12 bg-primary-container text-on-primary-container font-label-sm text-label-sm uppercase tracking-widest rounded-xl disabled:opacity-30 active:scale-95 transition-all flex-shrink-0"
            >
              Update
            </button>
          </div>
          {emailMsg && (
            <p className={`font-body-md text-sm ${emailMsg.includes('sent') ? 'text-green-400' : 'text-error'}`}>
              {emailMsg}
            </p>
          )}
        </Row>
      </Section>

      {/* ── Nightlife Preferences ─────────────────────────────────────── */}
      <Section title="Nightlife Preferences">
        <Row icon="payments" label="Typical Budget">
          <BudgetSlider budget={budget} setBudget={setBudget} />
        </Row>

        <Row icon="local_bar" label="Drinks I Like">
          <DrinkStep
            drinks={drinks}
            setDrinks={fn => setDrinks(prev => fn(prev))}
          />
        </Row>

        <Row icon="queue_music" label="Music I Like">
          <PillSelect
            options={MUSIC_OPTIONS}
            selected={musicGenres}
            onToggle={v => toggleMulti(setMusicGenres, v)}
          />
        </Row>

        <Row icon="bolt" label="My Vibe">
          <PillSelect
            options={VIBE_OPTIONS}
            selected={vibes}
            onToggle={v => toggleMulti(setVibes, v)}
          />
        </Row>
      </Section>

      {/* ── Notifications ─────────────────────────────────────────────── */}
      <Section title="Notifications">
        {[
          { label: 'Birthday deals & surprises', icon: 'cake',         val: notifBirthday,  set: setNotifBirthday  },
          { label: 'New clubs near me',          icon: 'location_on',  val: notifNewClubs,  set: setNotifNewClubs  },
          { label: 'Guest list openings',        icon: 'list_alt',     val: notifGuestList, set: setNotifGuestList },
          { label: 'Upcoming events',            icon: 'event',        val: notifEvents,    set: setNotifEvents    },
        ].map(({ label, icon, val, set }) => (
          <div key={label} className="flex items-center justify-between px-md py-sm">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
              <span className="font-body-md text-on-surface">{label}</span>
            </div>
            <Toggle value={val} onChange={set} />
          </div>
        ))}
      </Section>

      {/* ── Save button ───────────────────────────────────────────────── */}
      <div className="fixed bottom-20 left-0 right-0 px-container-padding">
        <button
          onClick={saveAll}
          disabled={saving}
          className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-60 transition-all flex items-center justify-center gap-sm"
        >
          {saving ? (
            <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
          ) : saved ? (
            <>
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              Saved!
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>
      <NavSpacer />
    </div>
  )
}
