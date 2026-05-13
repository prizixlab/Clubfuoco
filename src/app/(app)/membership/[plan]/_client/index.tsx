'use client'
import { apiFetch } from '@/lib/api'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Capacitor } from '@capacitor/core'

/* ─── Plan configs ───────────────────────────────────────────────────────── */

const CONFIGS = {
  gold: {
    id: 'gold',
    kicker: '01 · WARM',
    breadcrumb: 'Gold · Membership',
    name: 'Oro',
    label: 'Gold',
    price: '€19',
    pricePlain: 19,
    period: '/ per month',
    periodShort: '/mo',
    tagline: 'Skip the line at the doors you love.',
    perks: [
      'Priority entry at partner clubs',
      '15% off bookings',
      '1 monthly guest pass',
      'Early access to events',
    ],
    cta: 'Upgrade to Gold',
    // hero
    heroBg: 'linear-gradient(160deg, rgb(247,233,200) 0%, rgb(235,208,146) 40%, rgb(216,176,106) 100%)',
    dotOverlay: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
    kickerColor: 'rgba(90,69,32,0.7)',
    breadcrumbColor: '#8A7240',
    nameColor: '#2A1B08',
    priceColor: '#2A1B08',
    taglineColor: 'rgba(42,27,8,0.75)',
    // content (cream section)
    sectionLabelColor: '#8A7240',
    numColor: '#8A7240',
    perkColor: '#2A1B08',
    partnerColor: 'rgba(42,27,8,0.55)',
    ruleColor: 'rgba(42,27,8,0.10)',
    // bottom bar
    barBg: 'linear-gradient(rgb(247,233,200) 0%, rgb(235,208,146) 40%, rgb(216,176,106) 100%)',
    barPriceColor: '#2A1B08',
    barPeriodColor: 'rgba(42,27,8,0.6)',
    btnBg: '#8C2A2A',
    btnColor: '#F8F5EE',
    // compare highlight
    compareHighlightBg: 'rgba(42,27,8,0.08)',
    compareHighlightColor: '#2A1B08',
  },
  sapphire: {
    id: 'sapphire',
    kicker: '02 · DEEP',
    breadcrumb: 'Sapphire · Membership',
    name: 'Zaffiro',
    label: 'Sapphire',
    price: '€49',
    pricePlain: 49,
    period: '/ per month',
    periodShort: '/mo',
    tagline: 'A concierge in your pocket, an afterhours in your DMs.',
    perks: [
      'Priority entry at partner clubs',
      '25% off bookings',
      'Guest list up to 4× / month',
      'Personal WhatsApp concierge',
      'Invite-only afterhours events',
    ],
    cta: 'Upgrade to Sapphire',
    heroBg: 'radial-gradient(120% 100% at 0% 0%, rgb(26,42,94) 0%, rgb(14,26,68) 60%, rgb(5,13,44) 100%)',
    dotOverlay: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
    kickerColor: 'rgba(243,238,224,0.4)',
    breadcrumbColor: 'rgba(243,238,224,0.5)',
    nameColor: '#F3EEE0',
    priceColor: '#F3EEE0',
    taglineColor: 'rgba(243,238,224,0.7)',
    sectionLabelColor: 'rgba(243,238,224,0.5)',
    numColor: 'rgba(243,238,224,0.4)',
    perkColor: '#F3EEE0',
    partnerColor: 'rgba(243,238,224,0.5)',
    ruleColor: 'rgba(243,238,224,0.12)',
    barBg: 'radial-gradient(120% 100% at 0% 0%, rgb(26,42,94) 0%, rgb(14,26,68) 60%, rgb(5,13,44) 100%)',
    barPriceColor: '#F3EEE0',
    barPeriodColor: 'rgba(243,238,224,0.6)',
    btnBg: '#F3EEE0',
    btnColor: '#0E1A44',
    compareHighlightBg: 'rgba(26,42,94,0.12)',
    compareHighlightColor: '#0E1A44',
  },
  black: {
    id: 'black',
    kicker: '03 · ABSOLUTE',
    breadcrumb: 'Black · Membership',
    name: 'Nero',
    label: 'Black',
    price: '€500',
    pricePlain: 500,
    period: '/ per month',
    periodShort: '/mo',
    tagline: 'Every door, open. Every night, yours.',
    perks: [
      'Free VIP entry at all partner clubs',
      '30% off bookings',
      'Unlimited guest list',
      'Dedicated 24/7 concierge',
      'Private invite-only events',
      'First access to every new partner',
    ],
    cta: 'Request invitation',
    heroBg: 'linear-gradient(rgb(10,10,10) 0%, rgb(5,5,5) 100%)',
    dotOverlay: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
    kickerColor: 'rgba(244,234,215,0.4)',
    breadcrumbColor: 'rgba(244,234,215,0.45)',
    nameColor: '#F4EAD7',
    priceColor: '#F4EAD7',
    taglineColor: 'rgba(244,234,215,0.65)',
    sectionLabelColor: 'rgba(244,234,215,0.4)',
    numColor: 'rgba(244,234,215,0.35)',
    perkColor: '#F4EAD7',
    partnerColor: 'rgba(244,234,215,0.45)',
    ruleColor: 'rgba(244,234,215,0.10)',
    barBg: 'linear-gradient(rgb(10,10,10) 0%, rgb(5,5,5) 100%)',
    barPriceColor: '#F4EAD7',
    barPeriodColor: 'rgba(244,234,215,0.55)',
    btnBg: '#F4EAD7',
    btnColor: '#0A0A0A',
    compareHighlightBg: 'rgba(10,10,10,0.08)',
    compareHighlightColor: '#221E1A',
  },
}

const COMPARE = [
  { id: 'free',     label: 'Free',     price: '€0',   mo: '/mo' },
  { id: 'gold',     label: 'Gold',     price: '€19',  mo: '/mo' },
  { id: 'sapphire', label: 'Sapphire', price: '€49',  mo: '/mo' },
  { id: 'black',    label: 'Black',    price: '€500', mo: '/mo' },
]

/* ─── Check icon ─────────────────────────────────────────────────────────── */
function Check({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <polyline points="1.5,6.5 5,10 11.5,3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function MembershipDetailPage() {
  const router = useRouter()
  const params = useParams()
  const planId = params.plan as string

  const cfg = CONFIGS[planId as keyof typeof CONFIGS]
  if (!cfg) {
    router.replace('/membership')
    return null
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function subscribe() {
    setLoading(true)
    setError('')
    try {
      const res  = await apiFetch('/api/memberships/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan: cfg.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')

      const secret = data.data?.client_secret as string | undefined

      if (!secret) throw new Error('No payment secret returned')

      // ── Native iOS → Payment Sheet with Apple Pay ──────────────────
      if (Capacitor.isNativePlatform()) {
        const { Stripe } = await import('@capacitor-community/stripe')

        await Stripe.initialize({
          publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
        })

        await Stripe.createPaymentSheet({
          paymentIntentClientSecret: secret,
          merchantDisplayName:       'Club Fuoco',
          enableApplePay:            true,
          applePayMerchantId:        process.env.NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID ?? 'merchant.com.clubfuoco.app',
          countryCode:               'IT',
          currencyCode:              'eur',
          style:                     cfg.id === 'black' ? 'alwaysDark' : undefined,
        })

        const { paymentResult } = await Stripe.presentPaymentSheet()

        if (paymentResult === 'paymentSheetCompleted') {
          // Webhook confirms the subscription — navigate to success
          router.replace(`/membership?success=1&tier=${cfg.id}`)
        } else if (paymentResult === 'paymentSheetCanceled') {
          // User dismissed the sheet — do nothing
          setLoading(false)
        } else {
          throw new Error('Payment failed. Please try again.')
        }
        return
      }

      // ── Web fallback → Stripe.js confirmCardPayment / redirect ─────
      const { loadStripe } = await import('@stripe/stripe-js')
      const stripeJs = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
      if (!stripeJs) throw new Error('Stripe could not be loaded')

      const { error: stripeError } = await stripeJs.confirmPayment({
        clientSecret: secret,
        confirmParams: {
          return_url: `${window.location.origin}/membership?success=1&tier=${cfg.id}`,
        },
      })

      if (stripeError) throw new Error(stripeError.message ?? 'Payment failed')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', flexDirection: 'column',
      background: cfg.heroBg,
      overscrollBehavior: 'none',
    }}>

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

        {/* Hero section */}
        <div style={{
          position: 'relative',
          padding: '64px 20px 36px',
          background: cfg.heroBg,
        }}>
          {/* dot texture */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: cfg.dotOverlay,
            backgroundSize: '20px 20px',
            pointerEvents: 'none',
          }} />

          {/* Back button */}
          <button
            onClick={() => router.back()}
            style={{
              position: 'absolute', top: 16, left: 16,
              width: 32, height: 32,
              background: 'rgba(255,255,255,0.12)',
              border: 'none', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: cfg.nameColor,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Kicker + breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, position: 'relative' }}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.8px', textTransform: 'uppercase', color: cfg.kickerColor }}>
              {cfg.kicker}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, color: cfg.kickerColor }}>·</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '2.09px', textTransform: 'uppercase', color: cfg.breadcrumbColor }}>
              {cfg.breadcrumb}
            </span>
          </div>

          {/* Big italic name */}
          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 72, fontWeight: 400, fontStyle: 'italic',
            lineHeight: 0.95, letterSpacing: '-1.5px',
            color: cfg.nameColor,
            margin: '0 0 16px',
            position: 'relative',
          }}>
            {cfg.name}
          </p>

          {/* Price row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 12, position: 'relative' }}>
            <span style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 32, letterSpacing: '-0.07px',
              color: cfg.priceColor,
            }}>
              {cfg.price}
            </span>
            <span style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11, letterSpacing: '1.32px',
              textTransform: 'uppercase',
              color: cfg.taglineColor,
            }}>
              {cfg.period}
            </span>
          </div>

          {/* Tagline */}
          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 17, fontStyle: 'italic', letterSpacing: '-0.07px',
            color: cfg.taglineColor,
            margin: 0, lineHeight: 1.4,
            position: 'relative',
          }}>
            {cfg.tagline}
          </p>
        </div>

        {/* Content: cream background */}
        <div style={{ background: '#F8F5EE' }}>

          {/* What's included */}
          <section style={{ padding: '24px 20px 20px' }}>
            <p style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 9, letterSpacing: '1.62px',
              textTransform: 'uppercase',
              color: '#6E6356',
              margin: '0 0 16px',
            }}>
              What's included
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cfg.perks.map((perk, i) => (
                <div key={perk} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <span style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10, color: '#B0A898',
                    flexShrink: 0, marginTop: 1, minWidth: 16,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 14, color: '#221E1A',
                    lineHeight: 1.4,
                  }}>
                    {perk}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Divider */}
          <div style={{ margin: '0 20px', borderTop: '1px solid rgba(34,30,26,0.07)' }} />

          {/* Partner note */}
          <section style={{ padding: '16px 20px' }}>
            <p style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 9.5, letterSpacing: '1.33px',
              textTransform: 'uppercase',
              color: '#B0A898',
              margin: 0, lineHeight: 1.6,
            }}>
              Benefits apply at partner clubs.{' '}
              <span style={{ color: '#8C2A2A' }}>
                See the full list of 124 venues in Italy →
              </span>
            </p>
          </section>

          {/* Divider */}
          <div style={{ margin: '0 20px', borderTop: '1px solid rgba(34,30,26,0.07)' }} />

          {/* How it compares */}
          <section style={{ padding: '24px 20px 32px' }}>
            <p style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 9, letterSpacing: '1.62px',
              textTransform: 'uppercase',
              color: '#6E6356',
              margin: '0 0 16px',
            }}>
              How it compares
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {COMPARE.map(tier => {
                const isActive = tier.id === cfg.id
                return (
                  <div
                    key={tier.id}
                    onClick={() => tier.id !== 'free' ? router.push(`/membership/${tier.id}`) : router.push('/membership')}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 10,
                      background: isActive ? cfg.compareHighlightBg : 'transparent',
                      border: isActive ? `1px solid ${cfg.compareHighlightColor}20` : '1px solid rgba(34,30,26,0.07)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 8, letterSpacing: '1.4px',
                      textTransform: 'uppercase',
                      color: isActive ? cfg.compareHighlightColor : '#9F9486',
                    }}>
                      {tier.label}
                    </span>
                    <span style={{
                      fontFamily: '"Instrument Serif", Georgia, serif',
                      fontSize: 22, letterSpacing: '-0.5px',
                      color: isActive ? '#221E1A' : '#9F9486',
                      lineHeight: 1,
                    }}>
                      {tier.price}
                    </span>
                    <span style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 8, letterSpacing: '1px',
                      textTransform: 'uppercase',
                      color: isActive ? '#6E6356' : '#C8BFB2',
                    }}>
                      {tier.mo}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>

      {/* ── Sticky bottom bar ───────────────────────────────────────── */}
      <div style={{
        background: cfg.barBg,
        padding: '10px 20px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        borderTop: `1px solid ${cfg.ruleColor}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 24, letterSpacing: '-0.07px',
            color: cfg.barPriceColor,
          }}>
            {cfg.price}
          </span>
          <span style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 9, letterSpacing: '1.32px',
            textTransform: 'uppercase',
            color: cfg.barPeriodColor,
          }}>
            per month
          </span>
        </div>

        {error && (
          <p style={{ fontFamily: 'Inter', fontSize: 11, color: '#8C2A2A', flex: 1, textAlign: 'center' }}>{error}</p>
        )}

        <button
          onClick={subscribe}
          disabled={loading}
          style={{
            height: 44,
            padding: '0 20px',
            borderRadius: 10,
            border: 'none',
            background: cfg.btnBg,
            color: cfg.btnColor,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 10.5, fontWeight: 400,
            letterSpacing: '1.89px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            opacity: loading ? 0.6 : 1,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? (
            <span className="material-symbols-outlined" style={{ fontSize: 15, fontVariationSettings: "'FILL' 0, 'wght' 300", animation: 'spin 1s linear infinite' }}>
              progress_activity
            </span>
          ) : (
            <>
              {cfg.cta}
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 5.5h7M6 2.5l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
