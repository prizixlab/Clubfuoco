'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

type AccountType = 'user' | 'club' | 'dj'

const ACCOUNT_TYPES = [
  {
    type: 'user' as AccountType,
    icon: 'nightlife',
    label: 'Night Out',
    sublabel: 'I want to discover clubs',
    description: 'Explore Barcelona\'s nightlife, book tables, join guest lists and follow your favourite DJs.',
    color: 'border-primary-container/60 bg-primary-container/10',
    activeColor: 'border-primary bg-primary-container/30',
  },
  {
    type: 'club' as AccountType,
    icon: 'domain',
    label: 'Club / Venue',
    sublabel: 'I manage a venue',
    description: 'Manage your club\'s live status, guest lists, bookings and DJ lineup from one dashboard.',
    color: 'border-outline-variant/20 bg-surface-container',
    activeColor: 'border-primary bg-primary-container/30',
  },
  {
    type: 'dj' as AccountType,
    icon: 'queue_music',
    label: 'DJ / Artist',
    sublabel: 'I perform at clubs',
    description: 'Build your public profile, manage your gig schedule and grow your follower base.',
    color: 'border-outline-variant/20 bg-surface-container',
    activeColor: 'border-primary bg-primary-container/30',
  },
]

const SIGNUP_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '€0',
    icon: 'person',
    iconBg: 'bg-surface-container-high',
    iconColor: 'text-on-surface-variant/60',
    border: 'border-outline-variant/20',
    activeBorder: 'border-primary',
    activeBg: 'bg-primary-container/10',
    perks: ['Browse & discover clubs', 'Book entry tickets', 'Basic crowd info'],
  },
  {
    id: 'gold',
    name: 'Gold',
    price: '€19/mo',
    icon: 'workspace_premium',
    iconBg: 'bg-yellow-500/10',
    iconColor: 'text-yellow-400',
    border: 'border-yellow-500/20',
    activeBorder: 'border-yellow-400',
    activeBg: 'bg-yellow-500/10',
    badge: 'POPULAR',
    perks: ['Priority entry at partner clubs', '15% discount on bookings', 'Monthly guest pass'],
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    price: '€49/mo',
    icon: 'diamond',
    iconBg: 'bg-primary-container/30',
    iconColor: 'text-primary',
    border: 'border-primary/20',
    activeBorder: 'border-primary',
    activeBg: 'bg-primary-container/20',
    badge: 'ELITE',
    perks: ['25% discount on bookings', 'Guest list access (4×/mo)', 'WhatsApp concierge'],
  },
  {
    id: 'black',
    name: 'Black',
    price: '€500/mo',
    icon: 'local_fire_department',
    iconBg: 'bg-white/[0.06]',
    iconColor: 'text-white',
    border: 'border-white/10',
    activeBorder: 'border-white/40',
    activeBg: 'bg-white/[0.04]',
    badge: 'ULTIMATE',
    dark: true,
    perks: ['Free VIP entry everywhere', 'Unlimited guest lists', '24/7 dedicated concierge'],
  },
]

const HOME: Record<AccountType, string> = {
  user:  '/explore',
  club:  '/club-dashboard',
  dj:    '/dj-dashboard',
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 82 }, (_, i) => currentYear - 17 - i)

export default function SignupPage() {
  const router = useRouter()
  const [step,        setStep]        = useState<1 | 2 | 3 | 4>(1)
  const [accountType, setAccountType] = useState<AccountType>('user')
  const [fullName,    setFullName]    = useState('')
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [bDay,        setBDay]        = useState('')
  const [bMonth,      setBMonth]      = useState('')
  const [bYear,       setBYear]       = useState('')
  const [userId,      setUserId]      = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState('free')
  const [loading,     setLoading]     = useState(false)
  const [memberLoading, setMemberLoading] = useState(false)
  const [error,       setError]       = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, account_type: accountType } },
    })

    if (signUpError) { setError(signUpError.message); setLoading(false); return }

    if (data.user) {
      await supabase.from('users').update({ account_type: accountType }).eq('id', data.user.id)
      setUserId(data.user.id)
    }

    setLoading(false)
    if (accountType === 'user') {
      setStep(3) // birthday
    } else {
      router.push(HOME[accountType])
    }
  }

  async function handleBirthday(skip = false) {
    if (!skip && userId && bDay && bMonth && bYear) {
      const month = String(bMonth).padStart(2, '0')
      const day   = String(bDay).padStart(2, '0')
      await supabase.from('users').update({ birthday: `${bYear}-${month}-${day}` }).eq('id', userId)
    }
    setStep(4) // go to membership
  }

  async function handleMembership(planId: string) {
    if (planId === 'free') {
      router.push('/onboarding')
      return
    }
    setMemberLoading(true)
    try {
      const res  = await fetch('/api/memberships/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (data.data?.checkout_url) {
        window.location.href = data.data.checkout_url
      } else {
        router.push('/onboarding')
      }
    } catch {
      router.push('/onboarding')
    }
  }

  const selected    = ACCOUNT_TYPES.find(a => a.type === accountType)!
  const totalSteps  = accountType === 'user' ? 4 : 2
  const birthdaySet = bDay && bMonth && bYear

  const stepSubtitle: Record<number, string> = {
    1: 'How will you use Club Fuoco?',
    2: `Signing up as ${selected.label}`,
    3: 'One last thing',
    4: 'Choose your membership',
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-container-padding bg-background py-xl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-xl">
          <span className="material-symbols-outlined text-[48px] text-primary bloom-glow mb-base block"
            style={{ fontVariationSettings: "'FILL' 1" }}>
            local_fire_department
          </span>
          <h1 className="font-display text-h1 text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
          <p className="font-body-md text-on-surface-variant mt-xs">{stepSubtitle[step]}</p>
        </div>

        {/* Step indicator */}
        <div className="flex gap-xs justify-center mb-lg">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
            <div key={s} className={`h-1 rounded-full transition-all ${
              s === step ? 'w-8 bg-primary' : s < step ? 'w-4 bg-primary/40' : 'w-4 bg-outline-variant/30'
            }`} />
          ))}
        </div>

        {/* ── Step 1: Account type ── */}
        {step === 1 && (
          <div className="space-y-sm">
            {ACCOUNT_TYPES.map(a => (
              <button key={a.type} type="button" onClick={() => setAccountType(a.type)}
                className={`w-full text-left p-md rounded-xl border-2 transition-all active:scale-[0.98] ${
                  accountType === a.type ? a.activeColor : a.color
                }`}>
                <div className="flex items-center gap-sm">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    accountType === a.type ? 'bg-primary-container' : 'bg-surface-container-high'
                  }`}>
                    <span className={`material-symbols-outlined text-[24px] ${accountType === a.type ? 'text-on-primary-container' : 'text-on-surface-variant/60'}`}
                      style={accountType === a.type ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                      {a.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className={`font-h2 text-h2 ${accountType === a.type ? 'text-on-surface' : 'text-on-surface-variant'}`}>{a.label}</p>
                    <p className="font-body-md text-on-surface-variant/60 text-sm">{a.sublabel}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    accountType === a.type ? 'border-primary bg-primary' : 'border-outline-variant/40'
                  }`}>
                    {accountType === a.type && (
                      <span className="material-symbols-outlined text-[12px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                    )}
                  </div>
                </div>
                {accountType === a.type && (
                  <p className="font-body-md text-on-surface-variant/70 text-sm mt-sm leading-relaxed">{a.description}</p>
                )}
              </button>
            ))}
            <button onClick={() => setStep(2)}
              className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] mt-sm">
              Continue as {selected.label}
            </button>
          </div>
        )}

        {/* ── Step 2: Credentials ── */}
        {step === 2 && (
          <form onSubmit={handleSignup} className="space-y-gutter">
            <div className="glass-card p-sm rounded-xl flex items-center gap-sm mb-sm">
              <span className="material-symbols-outlined text-primary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                {selected.icon}
              </span>
              <span className="font-body-md text-on-surface">{selected.label}</span>
              <button type="button" onClick={() => setStep(1)} className="ml-auto font-label-sm text-label-sm text-primary uppercase tracking-widest">
                Change
              </button>
            </div>

            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Full Name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                required className="vibe-input w-full" placeholder="Alex Vance" />
            </div>
            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required className="vibe-input w-full" placeholder="you@example.com" />
            </div>
            <div className="space-y-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                required minLength={8} className="vibe-input w-full" placeholder="8+ characters" />
            </div>

            {error && <p className="font-body-md text-error text-center">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50">
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {/* ── Step 3: Birthday ── */}
        {step === 3 && (
          <div className="space-y-lg">
            <div className="text-center space-y-sm">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-primary-container/30 border border-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-[40px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>cake</span>
              </div>
              <div>
                <h2 className="font-h1 text-h1 text-on-surface">When's your birthday?</h2>
                <p className="font-body-md text-on-surface-variant/60 text-sm mt-xs leading-relaxed">
                  Unlock exclusive deals and surprises on your night out
                </p>
              </div>
            </div>

            <div className="flex gap-sm">
              <div className="flex-1 space-y-xs">
                <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Day</p>
                <select value={bDay} onChange={e => setBDay(e.target.value)} style={{ textAlignLast: 'center' }}
                  className="w-full h-16 bg-surface-container rounded-2xl border border-white/[0.06] text-center text-on-surface font-semibold text-[18px] appearance-none cursor-pointer focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="">—</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex-[2] space-y-xs">
                <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Month</p>
                <select value={bMonth} onChange={e => setBMonth(e.target.value)} style={{ textAlignLast: 'center' }}
                  className="w-full h-16 bg-surface-container rounded-2xl border border-white/[0.06] text-center text-on-surface font-semibold text-[15px] appearance-none cursor-pointer focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="">—</option>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="flex-[1.3] space-y-xs">
                <p className="text-center font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Year</p>
                <select value={bYear} onChange={e => setBYear(e.target.value)} style={{ textAlignLast: 'center' }}
                  className="w-full h-16 bg-surface-container rounded-2xl border border-white/[0.06] text-center text-on-surface font-semibold text-[16px] appearance-none cursor-pointer focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="">—</option>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-sm pt-sm">
              <button onClick={() => handleBirthday(false)} disabled={!birthdaySet}
                className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-30 transition-all">
                Continue 🎉
              </button>
              <button type="button" onClick={() => handleBirthday(true)}
                className="w-full py-sm font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Membership ── */}
        {step === 4 && (
          <div className="space-y-sm">
            {SIGNUP_PLANS.map(plan => {
              const isSelected = selectedPlan === plan.id
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full text-left p-md rounded-2xl border-2 transition-all active:scale-[0.98] relative
                    ${isSelected
                      ? `${plan.activeBorder} ${plan.activeBg}`
                      : `${plan.border} ${plan.dark ? 'bg-surface-container/50' : 'bg-surface-container'}`
                    }`}
                  style={plan.dark ? { background: isSelected ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.3)' } : undefined}
                >
                  {plan.badge && (
                    <span className={`absolute top-sm right-sm text-[9px] font-bold uppercase tracking-widest px-xs py-[2px] rounded-full border
                      ${plan.id === 'gold'
                        ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'
                        : plan.dark
                          ? 'border-white/20 text-white/60 bg-white/[0.05]'
                          : 'border-primary/30 text-primary bg-primary/10'
                      }`}>
                      {plan.badge}
                    </span>
                  )}

                  <div className="flex items-center gap-md">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${plan.iconBg}`}>
                      <span className={`material-symbols-outlined text-[22px] ${plan.iconColor}`}
                        style={{ fontVariationSettings: "'FILL' 1" }}>
                        {plan.icon}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-sm">
                        <span className={`font-h2 text-h2 ${plan.dark ? 'text-white' : 'text-on-surface'}`}>{plan.name}</span>
                        <span className={`font-label-sm text-[11px] ${plan.dark ? 'text-white/50' : 'text-on-surface-variant/60'}`}>{plan.price}</span>
                      </div>
                      <p className={`font-body-md text-xs mt-[2px] ${plan.dark ? 'text-white/50' : 'text-on-surface-variant/60'}`}>
                        {plan.perks[0]}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected
                        ? plan.dark ? 'border-white bg-white' : 'border-primary bg-primary'
                        : plan.dark ? 'border-white/20' : 'border-outline-variant/40'
                    }`}>
                      {isSelected && (
                        <span className={`material-symbols-outlined text-[12px] ${plan.dark ? 'text-black' : 'text-on-primary'}`}
                          style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded perks when selected */}
                  {isSelected && plan.perks.length > 1 && (
                    <ul className="mt-sm space-y-xs pl-[55px]">
                      {plan.perks.slice(1).map(perk => (
                        <li key={perk} className={`flex items-center gap-xs font-body-md text-xs ${plan.dark ? 'text-white/60' : 'text-on-surface-variant/70'}`}>
                          <span className={`material-symbols-outlined text-[12px] ${plan.dark ? 'text-white/50' : 'text-primary/60'}`}
                            style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                          {perk}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              )
            })}

            <div className="pt-sm space-y-sm">
              <button
                onClick={() => handleMembership(selectedPlan)}
                disabled={memberLoading}
                className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-sm transition-all"
              >
                {memberLoading
                  ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Setting up…</>
                  : selectedPlan === 'free' ? 'Start for Free' : `Subscribe to ${SIGNUP_PLANS.find(p => p.id === selectedPlan)?.name}`
                }
              </button>
              {selectedPlan !== 'free' && (
                <button type="button" onClick={() => router.push('/onboarding')}
                  className="w-full py-sm font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest">
                  Start free, upgrade later
                </button>
              )}
            </div>

            <p className="text-center font-label-sm text-[10px] text-on-surface-variant/30 uppercase tracking-widest pt-xs">
              Billed monthly · Cancel anytime
            </p>
          </div>
        )}

        {step < 3 && (
          <p className="text-center font-body-md text-on-surface-variant mt-md">
            Already a member?{' '}
            <Link href="/login" className="text-primary font-bold">Log in</Link>
          </p>
        )}
      </div>
    </div>
  )
}
