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

const HOME: Record<AccountType, string> = {
  user:  '/explore',
  club:  '/club-dashboard',
  dj:    '/dj-dashboard',
}

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [accountType, setAccountType] = useState<AccountType>('user')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Save account type to users table
    if (data.user) {
      await supabase
        .from('users')
        .update({ account_type: accountType })
        .eq('id', data.user.id)
    }

    // User accounts go through onboarding first
    router.push(accountType === 'user' ? '/onboarding' : HOME[accountType])
  }

  const selected = ACCOUNT_TYPES.find(a => a.type === accountType)!

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-container-padding bg-background py-xl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-xl">
          <span className="material-symbols-outlined text-[48px] text-primary bloom-glow mb-base block"
            style={{ fontVariationSettings: "'FILL' 1" }}>
            local_fire_department
          </span>
          <h1 className="font-display text-h1 text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
          <p className="font-body-md text-on-surface-variant mt-xs">
            {step === 1 ? 'How will you use Club Fuoco?' : `Signing up as ${selected.label}`}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex gap-xs justify-center mb-lg">
          {[1, 2].map(s => (
            <div key={s} className={`h-1 rounded-full transition-all ${s === step ? 'w-8 bg-primary' : 'w-4 bg-outline-variant/30'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-sm">
            {ACCOUNT_TYPES.map(a => (
              <button
                key={a.type}
                type="button"
                onClick={() => setAccountType(a.type)}
                className={`w-full text-left p-md rounded-xl border-2 transition-all active:scale-[0.98] ${
                  accountType === a.type ? a.activeColor : a.color
                }`}
              >
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
                    <p className={`font-h2 text-h2 ${accountType === a.type ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                      {a.label}
                    </p>
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

            <button
              onClick={() => setStep(2)}
              className="w-full h-14 bg-primary-container text-on-primary-container font-h2 text-h2 rounded-xl ignite-glow active:scale-[0.98] mt-sm"
            >
              Continue as {selected.label}
            </button>
          </div>
        )}

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

        <p className="text-center font-body-md text-on-surface-variant mt-md">
          Already a member?{' '}
          <Link href="/login" className="text-primary font-bold">Log in</Link>
        </p>
      </div>
    </div>
  )
}
