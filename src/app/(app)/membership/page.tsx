'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import NavSpacer from '@/components/NavSpacer'
import MemberDashboard from '@/components/MemberDashboard'
import { getMe } from '@/lib/supabase/queries'
import type { User } from '@/types'

/* ─── Check icon ─────────────────────────────────────────────────────────── */

function Check({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <polyline
        points="1.5,6.5 5,10 11.5,3"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ─── Card definitions ───────────────────────────────────────────────────── */

const FREE = {
  id: 'free',
  kicker: '00 · OPEN',
  currentBadge: true,
  name: 'Libero',
  label: 'Free',
  price: '€0',
  period: 'always',
  tagline: 'Browse the city. Pay as you go.',
  perks: ['Browse & discover clubs', 'Book entry tickets', 'Basic crowd info'],
  partnerNote: false,
  cta: 'Current plan',
  // colours
  cardBg: '#FFFFFF',
  cardBorder: '1px solid rgba(34,30,26,0.08)',
  kickerColor: '#8C2A2A',
  nameColor: '#221E1A',
  labelColor: '#8C2A2A',
  priceColor: '#221E1A',
  periodColor: '#9F9486',
  taglineColor: '#6E6356',
  perkColor: '#221E1A',
  checkColor: '#221E1A',
  partnerColor: '',
  btnBg: 'transparent',
  btnBorder: '1px solid rgba(34,30,26,0.12)',
  btnColor: '#6E6356',
  badgeBg: '',
  badgeColor: '',
  badgeBorder: '',
  ruleColor: 'rgba(34,30,26,0.08)',
}

const GOLD = {
  id: 'gold',
  kicker: '01 · WARM',
  currentBadge: false,
  name: 'Oro',
  label: 'Gold',
  price: '€19',
  period: 'per month',
  tagline: 'Skip the line at the doors you love.',
  perks: ['Priority entry at partner clubs', '15% off bookings', '1 monthly guest pass', 'Early access to events'],
  partnerNote: true,
  cta: 'Upgrade to Gold',
  // colours
  cardBg: 'linear-gradient(155deg, rgb(247,233,200) 0%, rgb(239,212,154) 55%, rgb(216,176,106) 100%)',
  cardBorder: 'none',
  kickerColor: '#8A7240',
  nameColor: '#2A1B08',
  labelColor: '#8A7240',
  priceColor: '#2A1B08',
  periodColor: '#5A4520',
  taglineColor: '#2A1B08',
  perkColor: '#2A1B08',
  checkColor: '#2A1B08',
  partnerColor: '#5A4520',
  btnBg: '#8C2A2A',
  btnBorder: 'none',
  btnColor: '#F8F5EE',
  badgeBg: '',
  badgeColor: '',
  badgeBorder: '',
  ruleColor: 'rgba(42,27,8,0.15)',
}

const SAPPHIRE = {
  id: 'sapphire',
  kicker: '02 · DEEP',
  currentBadge: false,
  name: 'Zaffiro',
  label: 'Sapphire',
  price: '€49',
  period: 'per month',
  tagline: 'A concierge in your pocket, an afterhours in your DMs.',
  perks: [
    'Priority entry at partner clubs',
    '25% off bookings',
    'Guest list up to 4× / month',
    'Personal WhatsApp concierge',
    'Invite-only afterhours events',
  ],
  partnerNote: true,
  cta: 'Upgrade to Sapphire',
  badge: 'Most picked',
  // colours
  cardBg: 'radial-gradient(120% 100% at 0% 0%, rgb(26,42,94) 0%, rgb(14,26,68) 60%, rgb(5,13,44) 100%)',
  cardBorder: 'none',
  kickerColor: 'rgba(243,238,224,0.5)',
  nameColor: '#F3EEE0',
  labelColor: 'rgba(243,238,224,0.5)',
  priceColor: '#F3EEE0',
  periodColor: 'rgba(243,238,224,0.78)',
  taglineColor: '#F3EEE0',
  perkColor: '#F3EEE0',
  checkColor: '#F3EEE0',
  partnerColor: 'rgba(243,238,224,0.78)',
  btnBg: '#F3EEE0',
  btnBorder: 'none',
  btnColor: '#0E1A44',
  badgeBg: '#F3EEE0',
  badgeColor: '#0E1A44',
  badgeBorder: '1px solid rgba(14,26,68,0.15)',
  ruleColor: 'rgba(243,238,224,0.15)',
}

const BLACK = {
  id: 'black',
  kicker: '03 · ABSOLUTE',
  currentBadge: false,
  name: 'Nero',
  label: 'Black',
  price: '€500',
  period: 'per month',
  tagline: 'Every door, open. Every night, yours.',
  perks: [
    'Free VIP entry at all partner clubs',
    '30% off bookings',
    'Unlimited guest list',
    'Dedicated 24/7 concierge',
    'Private invite-only events',
    'First access to every new partner',
  ],
  partnerNote: true,
  cta: 'Request invitation',
  // colours
  cardBg: 'linear-gradient(rgb(10,10,10) 0%, rgb(5,5,5) 100%)',
  cardBorder: 'none',
  kickerColor: 'rgba(244,234,215,0.48)',
  nameColor: '#F4EAD7',
  labelColor: 'rgba(244,234,215,0.48)',
  priceColor: '#F4EAD7',
  periodColor: 'rgba(244,234,215,0.72)',
  taglineColor: '#F4EAD7',
  perkColor: '#F4EAD7',
  checkColor: '#F4EAD7',
  partnerColor: 'rgba(244,234,215,0.72)',
  btnBg: '#F4EAD7',
  btnBorder: 'none',
  btnColor: '#0A0A0A',
  badgeBg: '',
  badgeColor: '',
  badgeBorder: '',
  ruleColor: 'rgba(244,234,215,0.12)',
}

const PLANS = [FREE, GOLD, SAPPHIRE, BLACK]

type Plan = typeof FREE

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function MembershipPage() {
  const router = useRouter()
  const [banner, setBanner] = useState('')
  const params = useSearchParams()
  const [me, setMe]     = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMe().then(u => { setMe(u as User | null); setLoading(false) })
  }, [])

  useEffect(() => {
    if (params.get('success')) {
      const tier = params.get('tier') ?? ''
      setBanner(`Welcome to ${tier.charAt(0).toUpperCase() + tier.slice(1)}! Your membership is now active.`)
    } else if (params.get('cancelled')) {
      setBanner('Subscription cancelled — you can subscribe any time.')
    }
  }, [params])

  // Show tier-specific dashboard for paid members
  if (!loading && me && me.membership_tier !== 'free') {
    return <MemberDashboard user={me} />
  }

  return (
    <div style={{ padding: '24px 20px 40px', maxWidth: 480, margin: '0 auto' }}>

      {/* ── Title block ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <p style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9.5, fontWeight: 400,
          letterSpacing: '1.71px',
          textTransform: 'uppercase',
          color: '#8C2A2A',
          marginBottom: 10,
        }}>
          N° 04 · MEMBERSHIP
        </p>
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 56, fontWeight: 400, fontStyle: 'normal',
          lineHeight: 1.05, letterSpacing: '-1.12px',
          color: '#221E1A',
          margin: '0 0 8px',
        }}>
          Scegli la tua <em style={{ fontStyle: 'italic' }}>famiglia</em>
        </h1>
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 13, color: '#9F9486',
          margin: 0,
        }}>
          Choose your tier · Cancel anytime
        </p>
      </div>

      {/* ── Banners ─────────────────────────────────────────────────────── */}
      {banner && (
        <div style={{
          backgroundColor: params.get('success') ? 'rgba(140,42,42,0.07)' : '#F0EDE8',
          border: `1px solid ${params.get('success') ? 'rgba(140,42,42,0.2)' : '#DDD8D0'}`,
          borderRadius: 10, padding: '11px 16px',
          marginBottom: 20,
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          color: params.get('success') ? '#8C2A2A' : '#6E6356',
        }}>
          {banner}
        </div>
      )}

      {/* ── Cards ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {PLANS.map(plan => (
          <Card
            key={plan.id}
            plan={plan as Plan & { badge?: string }}
            onOpen={plan.id !== 'free' ? () => router.push(`/membership/${plan.id}`) : undefined}
          />
        ))}
      </div>

      {/* ── Footer notes ────────────────────────────────────────────────── */}
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          '— Cancel anytime, no questions asked.',
          '— Partner club benefits apply at partner venues only.',
          '— Black tier admission by invitation, after a short call.',
        ].map(line => (
          <p key={line} style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11, color: '#B0A898',
            margin: 0, lineHeight: 1.5,
          }}>
            {line}
          </p>
        ))}
      </div>

      <NavSpacer />
    </div>
  )
}

/* ─── Individual card ────────────────────────────────────────────────────── */

function Card({ plan, onOpen }: {
  plan: Plan & { badge?: string }
  onOpen?: () => void
}) {
  const isFree = plan.id === 'free'
  return (
    <div
      onClick={onOpen}
      style={{
        background: plan.cardBg,
        border: plan.cardBorder,
        borderRadius: 14,
        padding: '22px 22px 20px',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >

      {/* ── Top row: kicker + badge ───────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9, letterSpacing: '1.8px',
          textTransform: 'uppercase',
          color: plan.kickerColor,
        }}>
          {plan.kicker}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {plan.currentBadge && (
            <span style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 8, letterSpacing: '1.4px',
              textTransform: 'uppercase',
              color: '#9F9486',
              backgroundColor: 'rgba(34,30,26,0.05)',
              borderRadius: 999,
              padding: '2px 8px',
            }}>
              Current
            </span>
          )}
          {plan.badge && (
            <span style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 8.5, letterSpacing: '1.53px',
              textTransform: 'uppercase',
              backgroundColor: plan.badgeBg,
              color: plan.badgeColor,
              border: plan.badgeBorder,
              borderRadius: 999,
              padding: '3px 10px',
            }}>
              {plan.badge}
            </span>
          )}
        </div>
      </div>

      {/* ── Name (big italic) ─────────────────────────────────────────── */}
      <p style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 56, fontWeight: 400, fontStyle: 'italic',
        lineHeight: 1.0, letterSpacing: '-1.12px',
        color: plan.nameColor,
        margin: '0 0 6px',
      }}>
        {plan.name}
      </p>

      {/* ── Label + Price + Period ────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9.5, letterSpacing: '2.09px',
          textTransform: 'uppercase',
          color: plan.labelColor,
        }}>
          {plan.label}
        </span>
        <span style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 32, fontWeight: 400, letterSpacing: '-0.07px',
          color: plan.priceColor,
          lineHeight: 1,
        }}>
          {plan.price}
        </span>
        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 8.5, letterSpacing: '1.53px',
          textTransform: 'uppercase',
          color: plan.periodColor,
        }}>
          {plan.period}
        </span>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${plan.ruleColor}`, marginBottom: 14 }} />

      {/* ── Tagline ──────────────────────────────────────────────────── */}
      <p style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 17, fontStyle: 'italic', letterSpacing: '-0.07px',
        color: plan.taglineColor,
        margin: '0 0 14px',
        lineHeight: 1.4,
      }}>
        {plan.tagline}
      </p>

      {/* ── Perks ────────────────────────────────────────────────────── */}
      <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {plan.perks.map(perk => (
          <li key={perk} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <Check color={plan.checkColor} />
            <span style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13, letterSpacing: '-0.07px',
              color: plan.perkColor,
              lineHeight: 1.4,
            }}>
              {perk}
            </span>
          </li>
        ))}
      </ul>

      {/* ── Partner note ─────────────────────────────────────────────── */}
      {plan.partnerNote && (
        <p style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9, letterSpacing: '1.26px',
          textTransform: 'uppercase',
          color: plan.partnerColor,
          margin: '0 0 16px',
        }}>
          Benefits apply at partner clubs.
        </p>
      )}
      {!plan.partnerNote && <div style={{ height: 16 }} />}

      {/* ── CTA button ───────────────────────────────────────────────── */}
      <button
        onClick={e => { e.stopPropagation(); if (onOpen) onOpen() }}
        disabled={isFree}
        style={{
          width: '100%',
          height: 44,
          borderRadius: 10,
          border: isFree ? '1px solid rgba(34,30,26,0.10)' : 'none',
          background: isFree ? 'transparent' : plan.btnBg,
          color: plan.btnColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10.5, fontWeight: 400,
          letterSpacing: '1.89px',
          textTransform: 'uppercase' as const,
          cursor: isFree ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'opacity 0.15s',
        }}
      >
        {plan.cta}
        {!isFree && (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 5.5h7M6 2.5l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
    </div>
  )
}
