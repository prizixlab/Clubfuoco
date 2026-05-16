'use client'
import { getMe, getMyBookings, getPlaceFavorites } from '@/lib/supabase/queries'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import NavSpacer from '@/components/NavSpacer'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/types'

// ─── Tier themes (pixel-perfect from Figma) ──────────────────────────────────

type TierKey = 'free' | 'gold' | 'sapphire' | 'black'

interface TierTheme {
  cardGradient: string
  cardBorder:   string
  accent:       string   // initials, last name, tier label
  accentSoft:   string   // subtitles, handles
  accentFaded:  string   // corner labels
  accentBadge:  string   // tier badge bg
  firstNameColor: string
  avatarBg:     string
  noBg:         string   // "N°" chip bg on avatar
  label:        string
  memberLabel:  string
  upgradeTagline?: string
  upgradeDetail?:  string
}

const TIERS: Record<TierKey, TierTheme> = {
  free: {
    cardGradient: 'linear-gradient(135deg, rgb(242,238,233) 0%, rgb(255,255,255) 100%)',
    cardBorder:   'rgba(34, 30, 26, 0.12)',
    accent:       'rgb(140, 42, 42)',
    accentSoft:   'rgba(34, 30, 26, 0.45)',
    accentFaded:  'rgba(34, 30, 26, 0.3)',
    accentBadge:  'rgba(140, 42, 42, 0.08)',
    firstNameColor: 'rgb(34, 30, 26)',
    avatarBg:     'rgba(140, 42, 42, 0.08)',
    noBg:         'rgb(248, 245, 238)',
    label:        'Libero',
    memberLabel:  'Free Member',
    upgradeTagline: 'Skip the line.',
    upgradeDetail:  'Oro · €19 / mese — priority entry & 15% off.',
  },
  gold: {
    cardGradient: 'linear-gradient(155deg, rgb(42,24,16) 0%, rgb(74,44,14) 38%, rgb(140,90,30) 72%, rgb(194,139,61) 110%)',
    cardBorder:   'rgba(255, 224, 165, 0.32)',
    accent:       'rgb(255, 232, 181)',
    accentSoft:   'rgba(255, 232, 181, 0.65)',
    accentFaded:  'rgba(255, 232, 181, 0.45)',
    accentBadge:  'rgba(255, 232, 181, 0.1)',
    firstNameColor: 'rgb(255, 241, 210)',
    avatarBg:     'rgba(255, 232, 181, 0.14)',
    noBg:         'rgb(42, 24, 16)',
    label:        'Oro',
    memberLabel:  'Gold Member',
    upgradeTagline: 'Bring more friends.',
    upgradeDetail:  'Zaffiro · €49 / mese — 25% off & WhatsApp concierge.',
  },
  sapphire: {
    cardGradient: 'linear-gradient(135deg, rgb(14,27,74) 0%, rgb(31,53,144) 45%, rgb(74,107,196) 100%)',
    cardBorder:   'rgba(194, 217, 255, 0.45)',
    accent:       'rgb(221, 230, 255)',
    accentSoft:   'rgba(221, 230, 255, 0.65)',
    accentFaded:  'rgba(221, 230, 255, 0.45)',
    accentBadge:  'rgba(221, 230, 255, 0.1)',
    firstNameColor: 'rgb(234, 238, 251)',
    avatarBg:     'rgba(221, 230, 255, 0.14)',
    noBg:         'rgb(14, 27, 74)',
    label:        'Zaffiro',
    memberLabel:  'Sapphire Member',
    upgradeTagline: 'Open every door.',
    upgradeDetail:  'Nero · €500 / mese — by invitation only.',
  },
  black: {
    cardGradient: 'linear-gradient(135deg, rgb(5,5,5) 0%, rgb(26,22,20) 60%, rgb(42,31,18) 100%)',
    cardBorder:   'rgba(232, 182, 91, 0.32)',
    accent:       'rgb(232, 182, 91)',
    accentSoft:   'rgba(232, 182, 91, 0.6)',
    accentFaded:  'rgba(232, 182, 91, 0.45)',
    accentBadge:  'rgba(232, 182, 91, 0.1)',
    firstNameColor: 'rgb(240, 228, 210)',
    avatarBg:     'rgba(232, 182, 91, 0.1)',
    noBg:         'rgb(5, 5, 5)',
    label:        'Nero',
    memberLabel:  'Black Member',
  },
}

const SERIF = '"Instrument Serif", Georgia, serif'

function apiOrigin() {
  if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') {
    return 'https://clubfuoco.vercel.app'
  }
  return typeof window !== 'undefined' ? window.location.origin : 'https://clubfuoco.vercel.app'
}

async function addMembershipToWallet(userId: string) {
  const url = `${apiOrigin()}/api/membership/wallet/${userId}`
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank')
  }
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [nights,  setNights]  = useState<number | null>(null)
  const [saved,   setSaved]   = useState<number | null>(null)

  const supabase = createClient()

  useEffect(() => {
    getMe()
      .then(d => { setProfile(d ?? null); setLoading(false) })
      .catch(() => setLoading(false))

    getMyBookings()
      .then(d => setNights(d.bookings.length ?? 0))
      .catch(() => setNights(0))

    getPlaceFavorites()
      .then(d => setSaved(d.length ?? 0))
      .catch(() => setSaved(0))
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const tier   = (profile?.membership_tier ?? 'free') as TierKey
  const t      = TIERS[tier]

  const nameParts  = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  const firstName  = nameParts[0] ?? ''
  const lastName   = nameParts.slice(1).join(' ')
  const initials   = nameParts.map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'
  const memberYear = profile?.created_at ? new Date(profile.created_at).getFullYear() : null

  // Generate a member number from user id
  const memberNum = profile?.id
    ? String((profile.id.charCodeAt(0) * 7 + profile.id.charCodeAt(profile.id.length - 1) * 3) % 999 + 1).padStart(3, '0')
    : '001'

  if (loading) {
    return (
      <div style={{ background: 'rgb(248,245,238)', minHeight: '100vh' }}>
        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ height: 11, width: 160, background: 'rgba(34,30,26,0.1)', borderRadius: 4 }} />
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(34,30,26,0.08)' }} />
          </div>
          <div style={{ height: 294, borderRadius: 16, background: 'rgba(34,30,26,0.08)', marginBottom: 20 }} className="animate-pulse" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, marginBottom: 20 }}>
            {[0,1,2].map(i => <div key={i} style={{ height: 69, background: 'rgba(34,30,26,0.06)' }} className="animate-pulse" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: 'rgb(248,245,238)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top header: CLUB FUOCO · ACCOUNT ─────────────────────────── */}
      <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9.5, letterSpacing: '2.66px', color: 'rgb(159,148,134)', textTransform: 'uppercase', fontWeight: 400 }}>
          CLUB&nbsp;FUOCO&nbsp;·&nbsp;ACCOUNT
        </span>
        {/* Settings gear button */}
        <button
          onClick={() => router.push('/settings')}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgb(255,255,255)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer', color: 'rgb(110,99,86)',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'rgb(110,99,86)' }}>settings</span>
        </button>
      </div>

      {/* ── Membership Card ───────────────────────────────────────────── */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{
          position: 'relative',
          borderRadius: 16,
          background: t.cardGradient,
          border: `1px solid ${t.cardBorder}`,
          padding: '16px 20px 48px',
          overflow: 'hidden',
          minHeight: 280,
        }}>
          {/* Corner labels — absolute */}
          <span style={{ position: 'absolute', top: 12, left: 14, fontSize: 8.5, letterSpacing: '1.87px', color: t.accentFaded, textTransform: 'uppercase' }}>
            N°&nbsp;{memberNum.slice(0, 2)}
          </span>
          <span style={{ position: 'absolute', top: 12, right: 14, fontSize: 8.5, letterSpacing: '1.87px', color: t.accentFaded, textTransform: 'uppercase' }}>
            BARCELONA
          </span>
          <span style={{ position: 'absolute', bottom: 16, left: 14, fontSize: 8.5, letterSpacing: '1.87px', color: t.accentFaded, textTransform: 'uppercase' }}>
            EST.&nbsp;{memberYear ?? '—'}
          </span>
          <span style={{ position: 'absolute', bottom: 16, right: 14, fontSize: 8.5, letterSpacing: '1.87px', color: t.accentFaded, textTransform: 'uppercase' }}>
            N°&nbsp;{memberNum}
          </span>

          {/* Card content — centred vertically */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, paddingTop: 24 }}>

            {/* Avatar circle */}
            <div style={{ position: 'relative', width: 84, height: 84, marginBottom: 4 }}>
              <div style={{
                width: 84, height: 84, borderRadius: '50%',
                background: t.avatarBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontFamily: SERIF, fontSize: 42, fontStyle: 'italic', color: t.accent, lineHeight: 1 }}>
                    {initials}
                  </span>
                )}
              </div>
            </div>

            {/* SOCIO · MEMBER label */}
            <p style={{ margin: 0, fontSize: 9.5, letterSpacing: '2.28px', color: t.accentSoft, textTransform: 'uppercase' }}>
              SOCIO&nbsp;·&nbsp;{t.memberLabel.toUpperCase()}
            </p>

            {/* Name */}
            <div style={{ lineHeight: 1.05, margin: 0 }}>
              {(firstName || (!firstName && !lastName)) && (
                <span style={{ fontFamily: SERIF, fontSize: 36, letterSpacing: '-0.54px', color: t.firstNameColor, display: 'block' }}>
                  {firstName || 'Member'}
                </span>
              )}
              {lastName && (
                <em style={{ fontFamily: SERIF, fontSize: 36, fontStyle: 'italic', letterSpacing: '-0.54px', color: t.accent, display: 'block' }}>
                  {lastName}
                </em>
              )}
            </div>

            {/* Handle / email */}
            <p style={{ margin: 0, fontSize: 10, letterSpacing: '1.2px', color: t.accentSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {profile?.email ?? ''}
            </p>

            {/* Tier badge pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: t.accentBadge,
              padding: '3px 10px 3px 8px',
              borderRadius: 100,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(140,42,42)', flexShrink: 0, display: 'inline-block' }} />
              <em style={{ fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: t.accent }}>
                {t.label}
              </em>
              <span style={{ fontSize: 9.5, letterSpacing: '1.71px', color: t.accentSoft }}>
                /&nbsp;{t.memberLabel}
              </span>
            </div>

            {/* Add to Wallet — only for paid tiers */}
            {tier !== 'free' && (
              <button
                onClick={() => profile?.id && addMembershipToWallet(profile.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(0,0,0,0.35)',
                  border: `1px solid ${t.accentFaded}`,
                  borderRadius: 8,
                  padding: '7px 13px',
                  cursor: 'pointer',
                  marginTop: 4,
                }}
              >
                {/* Apple Wallet logo mark */}
                <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
                  <rect x="0.5" y="0.5" width="17" height="13" rx="2.5" stroke={t.accentFaded}/>
                  <path d="M4 5h3.5M4 8h2M10 5h4M10 8h4" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round"/>
                  <circle cx="13.5" cy="7" r="2" fill={t.accent} fillOpacity="0.18" stroke={t.accent} strokeWidth="0.8"/>
                </svg>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '1.6px',
                  textTransform: 'uppercase', color: t.accent,
                }}>
                  Add to Wallet
                </span>
              </button>
            )}

          </div>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {([
            { value: nights !== null ? nights : '—', it: 'Notti fuori',    en: 'Nights out'   },
            { value: saved  !== null ? saved  : '—', it: 'Locali salvati', en: 'Saved clubs'  },
            { value: memberYear ?? '—',               it: 'Socio dal',      en: 'Member since' },
          ] as { value: number | string; it: string; en: string }[]).map(({ value, it, en }, i) => (
            <>
              {i > 0 && (
                <div key={`div-${i}`} style={{ width: 1, height: 57, background: 'rgba(34,30,26,0.08)', flexShrink: 0 }} />
              )}
              <div key={en} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 8px' }}>
                <span style={{ fontFamily: SERIF, fontSize: 30, color: 'rgb(140,42,42)', letterSpacing: '-0.3px', lineHeight: 1, display: 'block', marginBottom: 2 }}>
                  {value}
                </span>
                <span style={{ fontFamily: SERIF, fontSize: 13, fontStyle: 'italic', color: 'rgb(34,30,26)', letterSpacing: '-0.07px', display: 'block', marginBottom: 1 }}>
                  {it}
                </span>
                <span style={{ fontSize: 8.5, color: 'rgb(159,148,134)', letterSpacing: '1.7px', textTransform: 'uppercase' }}>
                  {en}
                </span>
              </div>
            </>
          ))}
        </div>
      </div>

      {/* ── Upgrade Banner ────────────────────────────────────────────── */}
      {t.upgradeTagline && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px', fontSize: 8.5, letterSpacing: '2.04px', color: 'rgb(140,42,42)', textTransform: 'uppercase', fontWeight: 400 }}>
                PROSSIMO LIVELLO
              </p>
              <p style={{ margin: '0 0 2px' }}>
                <em style={{ fontFamily: SERIF, fontSize: 20, fontStyle: 'italic', color: 'rgb(34,30,26)', letterSpacing: '-0.07px' }}>
                  {t.upgradeTagline}
                </em>
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'rgb(110,99,86)', letterSpacing: '-0.07px', lineHeight: 1.4 }}>
                {t.upgradeDetail}
              </p>
            </div>
            <Link
              href="/membership"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'rgb(140,42,42)', color: 'rgb(255,255,255)',
                fontSize: 10, fontWeight: 600, letterSpacing: '1.8px', textTransform: 'uppercase',
                padding: '0 16px', height: 32, borderRadius: 8,
                textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              UPGRADE
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* ── Menu sections ─────────────────────────────────────────────── */}
      <div style={{ padding: '0 20px 0', flex: 1 }}>

        {/* Thin separator */}
        <div style={{ height: 1, background: 'rgba(34,30,26,0.08)', marginBottom: 16 }} />

        {/* N° 02 · IL TUO ACCOUNT */}
        <p style={{ margin: '0 0 8px', fontSize: 9, letterSpacing: '2.34px', color: 'rgb(159,148,134)', textTransform: 'uppercase' }}>
          N°&nbsp;02&nbsp;·&nbsp;IL TUO ACCOUNT
        </p>

        {[
          { n: '01', icon: 'confirmation_number', label: 'My Bookings',  sub: nights !== null ? `${nights} bookings` : '—',       href: '/bookings'   },
          { n: '02', icon: 'favorite',            label: 'Saved Clubs',  sub: saved !== null  ? `${saved} saved`    : '—',       href: '/saved'      },
          { n: '03', icon: 'workspace_premium',   label: 'Membership',   sub: `${t.label} · ${t.memberLabel}`,                   href: '/membership' },
        ].map(({ n, icon, label, sub, href }, i) => (
          <Link
            key={label}
            href={href}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '16px 0',
              borderTop: i > 0 ? '1px solid rgba(34,30,26,0.08)' : 'none',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 9, color: 'rgb(159,148,134)', letterSpacing: '1.62px', width: 18, flexShrink: 0 }}>{n}</span>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(140,42,42,0.08)', flexShrink: 0,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'rgb(140,42,42)', fontVariationSettings: "'FILL' 1" }}>{icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 19, color: 'rgb(34,30,26)', letterSpacing: '-0.095px', lineHeight: 1.2, fontFamily: SERIF }}>{label}</p>
              {label === 'Membership' ? (
                <p style={{ margin: 0, fontSize: 11.5, letterSpacing: '0.115px', lineHeight: 1 }}>
                  <em style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'rgb(110,99,86)', fontSize: 13 }}>{t.label}</em>
                  <span style={{ color: 'rgb(159,148,134)' }}>&nbsp;·&nbsp;{t.memberLabel}</span>
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: 11.5, color: 'rgb(159,148,134)', letterSpacing: '0.115px' }}>{sub}</p>
              )}
            </div>
            <span style={{ fontSize: 14, color: 'rgb(159,148,134)', flexShrink: 0 }}>→</span>
          </Link>
        ))}

        {/* N° 03 · PREFERENZE */}
        <div style={{ height: 1, background: 'rgba(34,30,26,0.16)', margin: '4px 0 16px' }} />
        <p style={{ margin: '0 0 8px', fontSize: 9, letterSpacing: '2.34px', color: 'rgb(159,148,134)', textTransform: 'uppercase' }}>
          N°&nbsp;03&nbsp;·&nbsp;PREFERENZE
        </p>

        {[
          { n: '04', icon: 'tune',                 label: 'Settings',              sub: 'Notifications · privacy · language', href: '/settings' },
          { n: '05', icon: 'help_outline',          label: 'Help & Support',        sub: 'FAQ · contact concierge',            href: '/legal/help' },
          { n: '06', icon: 'gavel',                 label: 'House Rules & Privacy', sub: 'Terms · privacy · GDPR',             href: '/legal/terms' },
        ].map(({ n, icon, label, sub, href }, i) => (
          <Link
            key={label}
            href={href}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '16px 0',
              borderTop: i > 0 ? '1px solid rgba(34,30,26,0.08)' : 'none',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 9, color: 'rgb(159,148,134)', letterSpacing: '1.62px', width: 18, flexShrink: 0 }}>{n}</span>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(140,42,42,0.08)', flexShrink: 0,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'rgb(140,42,42)', fontVariationSettings: "'FILL' 1" }}>{icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 19, color: 'rgb(34,30,26)', letterSpacing: '-0.095px', lineHeight: 1.2, fontFamily: SERIF }}>{label}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'rgb(159,148,134)', letterSpacing: '0.115px' }}>{sub}</p>
            </div>
            <span style={{ fontSize: 14, color: 'rgb(159,148,134)', flexShrink: 0 }}>→</span>
          </Link>
        ))}

        {/* Sign out */}
        <div style={{ height: 1, background: 'rgba(34,30,26,0.08)', margin: '8px 0' }} />
        <button
          onClick={signOut}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 11, fontWeight: 600, letterSpacing: '2.42px',
            color: 'rgb(140,42,42)', background: 'transparent',
            border: 'none', cursor: 'pointer', padding: '16px 0',
            textTransform: 'uppercase',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3M10 11l3-3-3-3M13 8H6" stroke="rgb(140,42,42)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Sign out
        </button>

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(34,30,26,0.08)', marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
          <span style={{ fontSize: 8, letterSpacing: '1.92px', color: 'rgb(159,148,134)', textTransform: 'uppercase' }}>FUOCO&nbsp;·&nbsp;A NIGHTLIFE COMPANY</span>
          <span style={{ fontSize: 8, letterSpacing: '1.92px', color: 'rgb(159,148,134)', textTransform: 'uppercase' }}>v1.0&nbsp;·&nbsp;MMXXVI</span>
        </div>
        <em style={{ fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: 'rgb(159,148,134)', letterSpacing: '-0.07px', display: 'block', marginBottom: 8 }}>
          &ldquo;La notte ci appartiene.&rdquo;
        </em>

      </div>

      <NavSpacer />
    </div>
  )
}
