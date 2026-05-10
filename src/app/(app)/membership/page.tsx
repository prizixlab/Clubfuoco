'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = [
  {
    id: 'free',
    name: 'FREE',
    price: '€0',
    period: 'forever',
    color: 'border-outline-variant/30',
    badge: '',
    icon: null,
    partnerOnly: false,
    perks: [
      'Discover & browse clubs',
      'Book entry tickets',
      'Basic crowd info',
    ],
    cta: 'Current Plan',
    ctaStyle: 'bg-surface-container text-on-surface-variant cursor-default',
  },
  {
    id: 'gold',
    name: 'GOLD',
    price: '€19',
    period: '/month',
    color: 'border-yellow-500/40 ring-1 ring-yellow-500/40',
    badge: 'POPULAR',
    icon: 'workspace_premium',
    iconColor: 'text-yellow-400',
    partnerOnly: true,
    perks: [
      'Priority entry at partner clubs',
      '15% discount on bookings',
      'Monthly guest pass (×1)',
      'Early access to event announcements',
    ],
    cta: 'Subscribe — €19/mo',
    ctaStyle: 'bg-yellow-500/20 border border-yellow-500/40 text-yellow-300',
  },
  {
    id: 'sapphire',
    name: 'SAPPHIRE',
    price: '€49',
    period: '/month',
    color: 'border-primary/40 ring-1 ring-primary',
    badge: 'ELITE',
    icon: 'diamond',
    iconColor: 'text-primary',
    partnerOnly: true,
    perks: [
      'Priority entry at partner clubs',
      '25% discount on bookings',
      'Complimentary guest list access (up to 4×/month)',
      'Personal concierge via WhatsApp',
      'Invite-only afterhours events',
    ],
    cta: 'Subscribe — €49/mo',
    ctaStyle: 'bg-primary-container text-on-primary-container ignite-glow',
  },
  {
    id: 'black',
    name: 'BLACK',
    price: '€500',
    period: '/month',
    color: 'border-white/20 ring-2 ring-white/10',
    badge: 'ULTIMATE',
    icon: 'local_fire_department',
    iconColor: 'text-white',
    partnerOnly: true,
    perks: [
      'Free VIP entry at all partner clubs',
      '30% discount on all bookings',
      'Unlimited guest list access',
      'Dedicated 24/7 concierge',
      'Invite-only private events & afterhours',
      'First access to every new partner club',
    ],
    cta: 'Subscribe — €500/mo',
    ctaStyle: 'bg-white text-black font-extrabold',
    cardStyle: 'bg-gradient-to-br from-surface-container to-black',
  },
]

export default function MembershipPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [error,   setError]   = useState('')
  const [banner,  setBanner]  = useState('')
  const params = useSearchParams()

  useEffect(() => {
    if (params.get('success')) {
      const tier = params.get('tier') ?? ''
      setBanner(`🎉 Welcome to ${tier.charAt(0).toUpperCase() + tier.slice(1)}! Your membership is now active.`)
    } else if (params.get('cancelled')) {
      setBanner('Subscription cancelled — you can subscribe any time.')
    }
  }, [params])

  async function subscribe(planId: string) {
    if (planId === 'free') return
    setLoading(planId)
    setError('')
    try {
      const res  = await fetch('/api/memberships/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      if (data.data?.checkout_url) window.location.href = data.data.checkout_url
    } catch (e: any) {
      setError(e.message)
      setLoading(null)
    }
  }

  return (
    <div className="px-container-padding pt-base pb-lg">
      {/* Header */}
      <div className="text-center mb-lg">
        <span className="material-symbols-outlined text-[48px] text-primary bloom-glow mb-sm block"
          style={{ fontVariationSettings: "'FILL' 1" }}>
          workspace_premium
        </span>
        <h2 className="font-h1 text-h1 text-on-surface mb-xs">Membership</h2>
        <p className="font-body-md text-on-surface-variant max-w-[280px] mx-auto">
          Exclusive perks at Club Fuoco's partner venues — the best clubs in Barcelona.
        </p>
      </div>

      {banner && (
        <div className={`flex items-center gap-sm rounded-xl px-md py-sm mb-md border ${
          params.get('success')
            ? 'bg-primary/10 border-primary/30 text-primary'
            : 'bg-surface-container border-outline-variant/20 text-on-surface-variant'
        }`}>
          <p className="font-body-md">{banner}</p>
        </div>
      )}
      {error && <p className="font-body-md text-error text-center mb-md">{error}</p>}

      {/* Partner club note */}
      <div className="flex items-center gap-sm bg-surface-container rounded-xl px-md py-sm mb-lg border border-outline-variant/20">
        <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          verified
        </span>
        <p className="font-body-md text-on-surface-variant text-sm">
          Gold, Sapphire &amp; Black benefits apply at <span className="text-primary font-semibold">partner clubs only</span>. Look for the ✦ badge.
        </p>
      </div>

      {/* Plans */}
      <div className="space-y-gutter pt-sm">
        {PLANS.map(plan => {
          const isBlack = plan.id === 'black'
          return (
            <div key={plan.id} className="relative">
              {/* Badge sits outside the card so overflow:hidden can't clip it */}
              {plan.badge && (
                <div className="absolute -top-3 inset-x-0 flex justify-center z-10">
                  <span className={`px-sm py-[2px] rounded-full text-[10px] font-bold uppercase tracking-widest border
                    ${isBlack
                      ? 'bg-black border-white/30 text-white'
                      : plan.id === 'gold'
                        ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                        : 'bg-primary/20 border-primary/30 text-primary'}`}>
                    {plan.badge}
                  </span>
                </div>
              )}

              <div
                className={`p-md rounded-2xl border relative overflow-hidden glass-card ${plan.color}`}
                style={isBlack ? { background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)' } : undefined}
              >
                {isBlack && (
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 55%)' }} />
                )}

                {/* Header row */}
                <div className="flex justify-between items-start mb-md">
                  <div>
                    <h3 className={`font-h2 text-h2 tracking-widest ${isBlack ? 'text-white' : 'text-on-surface'}`}>
                      {plan.name}
                    </h3>
                    <div className="flex items-baseline gap-xs mt-xs">
                      <span className={`font-display text-[36px] font-extrabold leading-none
                        ${isBlack ? 'text-white' : plan.id === 'gold' ? 'text-yellow-300' : 'text-primary'}`}>
                        {plan.price}
                      </span>
                      <span className="font-body-md text-on-surface-variant">{plan.period}</span>
                    </div>
                  </div>
                  {plan.icon && (
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
                      ${isBlack ? 'bg-white/[0.06]' : plan.id === 'gold' ? 'bg-yellow-500/10' : 'bg-primary-container/30'}`}>
                      <span className={`material-symbols-outlined text-[26px] ${plan.iconColor ?? 'text-primary'}`}
                        style={{ fontVariationSettings: "'FILL' 1" }}>
                        {plan.icon}
                      </span>
                    </div>
                  )}
                </div>

                {/* Perks */}
                <ul className="space-y-sm mb-md">
                  {plan.perks.map(perk => (
                    <li key={perk} className="flex items-start gap-sm">
                      <span className={`material-symbols-outlined text-[16px] mt-[2px] flex-shrink-0
                        ${isBlack ? 'text-white' : plan.id === 'gold' ? 'text-yellow-400' : 'text-primary'}`}
                        style={{ fontVariationSettings: "'FILL' 1" }}>
                        check_circle
                      </span>
                      <span className={`font-body-md text-sm ${isBlack ? 'text-white/80' : 'text-on-surface-variant'}`}>
                        {perk}
                      </span>
                    </li>
                  ))}
                </ul>

                {plan.partnerOnly && plan.id !== 'free' && (
                  <p className={`text-[11px] mb-sm font-semibold uppercase tracking-widest
                    ${isBlack ? 'text-white/30' : 'text-on-surface-variant/40'}`}>
                    ✦ Partner clubs only
                  </p>
                )}

                <button
                  onClick={() => subscribe(plan.id)}
                  disabled={loading === plan.id || plan.id === 'free'}
                  className={`w-full h-12 rounded-xl font-h2 text-h2 flex items-center justify-center gap-sm active:scale-[0.98] transition-all duration-200 disabled:opacity-60 ${plan.ctaStyle}`}
                >
                  {loading === plan.id
                    ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Redirecting…</>
                    : plan.cta}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-center font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest mt-md px-md">
        Billed monthly · Cancel anytime · Managed via Stripe
      </p>
    </div>
  )
}
