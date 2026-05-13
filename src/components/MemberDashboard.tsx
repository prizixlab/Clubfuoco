'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import NavSpacer from '@/components/NavSpacer'
import type { User } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMemberNum(n: number | null): string {
  return n ? String(n).padStart(4, '0') : '—'
}

interface HostData {
  id: string
  name: string
  role: string
  phone: string | null
  whatsapp_url: string | null
  avatar_initial: string
  years_with_fuoco: number | null
  cities: string[] | null
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

function fmtDateShort(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
}

function firstName(fullName: string | null | undefined) {
  return fullName?.split(' ')[0]?.toUpperCase() ?? 'OSPITE'
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const CREAM  = 'rgb(248, 245, 238)'
const INK    = 'rgb(34, 30, 26)'
const INK2   = 'rgb(100, 90, 80)'
const BORDER = 'rgba(34,30,26,0.1)'
const GREEN  = 'rgb(27, 122, 63)'

// Nero
const NERO_BG   = 'rgb(14, 11, 9)'
const NERO_INK  = 'rgb(244, 233, 214)'
const NERO_GOLD = 'rgb(232, 182, 91)'

// Sapphire
const SAPH_BLUE  = 'rgb(221, 230, 255)'
const SAPH_NAVY  = 'rgb(14, 27, 74)'

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ n, it, en, dark }: { n: string; it: string; en: string; dark?: boolean }) {
  const c = dark ? `rgba(244,233,214,0.45)` : 'rgba(34,30,26,0.4)'
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: dark ? NERO_GOLD : 'rgb(140,42,42)', margin: '0 0 2px' }}>
        N° {n} · {it}
      </p>
      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: c, margin: 0 }}>
        {en}
      </p>
    </div>
  )
}

function Section({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div style={{
      borderTop: `1px solid ${dark ? 'rgba(244,233,214,0.08)' : BORDER}`,
      paddingTop: 28, marginTop: 28,
    }}>
      {children}
    </div>
  )
}

// ─── Membership pass card ─────────────────────────────────────────────────────

function PassCard({ tier, user, memberNum, validUntil, userId }: {
  tier: string; user: User; memberNum: string; validUntil: string | null; userId: string
}) {
  const isNero = tier === 'black'
  const bgCard = isNero
    ? 'linear-gradient(155deg, rgb(10,10,10) 0%, rgb(26,22,18) 60%, rgb(42,31,18) 100%)'
    : 'linear-gradient(155deg, rgb(14,12,10) 0%, rgb(34,28,20) 100%)'

  const tierLabel  = { gold: 'N° I · Oro · Gold', sapphire: 'N° II · Zaffiro · Sapphire', black: 'N° III · Nero · Black' }[tier] ?? ''
  const accentColor = isNero ? NERO_GOLD : CREAM

  return (
    <div style={{
      background: bgCard,
      borderRadius: 16, padding: '24px 22px 20px',
      border: `1px solid ${isNero ? 'rgba(232,182,91,0.25)' : 'rgba(255,255,255,0.08)'}`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* halftone dot bg decoration */}
      <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120, borderRadius: '50%', border: `1px solid ${isNero ? 'rgba(232,182,91,0.08)' : 'rgba(255,255,255,0.05)'}` }} />
      <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', border: `1px solid ${isNero ? 'rgba(232,182,91,0.04)' : 'rgba(255,255,255,0.03)'}` }} />

      {/* brand */}
      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: `rgba(${isNero ? '232,182,91' : '248,245,238'},0.45)`, margin: '0 0 16px' }}>
        CLUB FUOCO
      </p>

      {/* tier label */}
      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: `rgba(${isNero ? '232,182,91' : '248,245,238'},0.55)`, margin: '0 0 4px' }}>
        {tierLabel} · Membership
      </p>

      {/* name */}
      <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: accentColor, margin: '0 0 16px', letterSpacing: '0.02em' }}>
        {user.full_name ?? 'Membro'}
      </p>

      <div style={{ borderTop: `1px solid ${isNero ? 'rgba(232,182,91,0.12)' : 'rgba(255,255,255,0.08)'}`, margin: '0 0 16px' }} />

      {/* number + year */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.14em', color: `rgba(${isNero ? '232,182,91' : '248,245,238'},0.5)`, margin: 0 }}>
          N° {memberNum} / FUOCO · MMXXVI
        </p>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.10em', color: `rgba(${isNero ? '232,182,91' : '248,245,238'},0.35)`, margin: 0, textTransform: 'uppercase' }}>
          {tier === 'black' ? 'LIFETIME' : validUntil ? `Rinnova · ${fmtDateShort(validUntil)}` : 'ACTIVE'}
        </p>
      </div>

      {/* Apple Wallet button */}
      <button
        onClick={async () => {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.vercel.app'
          const passUrl = `${appUrl}/api/membership/wallet/${userId}`
          try {
            const { Capacitor } = await import('@capacitor/core')
            if (Capacitor.isNativePlatform()) {
              // 1. Fetch the .pkpass binary
              const res = await fetch(passUrl)
              if (!res.ok) throw new Error('pass fetch failed')
              const blob = await res.blob()

              // 2. Convert blob → base64
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve((reader.result as string).split(',')[1])
                reader.onerror = reject
                reader.readAsDataURL(blob)
              })

              // 3. Write to cache dir as a .pkpass file
              const { Filesystem, Directory } = await import('@capacitor/filesystem')
              const { uri } = await Filesystem.writeFile({
                path: 'clubfuoco-membership.pkpass',
                data: base64,
                directory: Directory.Cache,
              })

              // 4. Share the file — iOS shows "Add to Wallet" in the share sheet
              const { Share } = await import('@capacitor/share')
              await Share.share({
                title: 'Club Fuoco Membership',
                files: [uri],
              })
            } else {
              window.location.href = passUrl
            }
          } catch (e) {
            console.error('[wallet]', e)
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 0', borderRadius: 10, width: '100%', cursor: 'pointer',
          background: isNero ? 'rgba(232,182,91,0.12)' : 'rgba(248,245,238,0.08)',
          border: `1px solid ${isNero ? 'rgba(232,182,91,0.25)' : 'rgba(248,245,238,0.12)'}`,
          color: isNero ? NERO_GOLD : CREAM,
          fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
          fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="5" width="20" height="14" rx="3"/>
          <path d="M2 10h20"/>
        </svg>
        Add to Apple Wallet
      </button>
    </div>
  )
}

// ─── ORO dashboard ────────────────────────────────────────────────────────────

function OroDashboard({ user, memberNum, validUntil, router }: {
  user: User; memberNum: string; validUntil: string | null; router: ReturnType<typeof useRouter>
}) {
  return (
    <div style={{ background: CREAM, minHeight: '100dvh', padding: '0 0 120px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '56px 24px 0' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: INK2 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgb(140,42,42)', margin: 0 }}>
          TIER I · ORO
        </p>
        <div style={{ width: 20 }} />
      </div>

      <div style={{ padding: '0 24px' }}>
        {/* hello */}
        <div style={{ padding: '28px 0 24px' }}>
          <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2, margin: '0 0 6px' }}>
            BUONASERA, {firstName(user.full_name)}
          </p>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, fontWeight: 400, color: INK, margin: '0 0 14px', lineHeight: 1.1 }}>
            La tua <em>tessera.</em>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: GREEN }}>
              ATTIVO
            </span>
            <span style={{ color: BORDER, margin: '0 4px' }}>·</span>
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: INK2 }}>
              Socio dal {fmtDate(user.created_at)}
            </span>
            <span style={{ color: BORDER, margin: '0 4px' }}>·</span>
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: INK2 }}>
              N° {memberNum}
            </span>
          </div>
        </div>

        {/* pass card */}
        <PassCard tier="gold" user={user} memberNum={memberNum} validUntil={validUntil} userId={user.id} />

        {/* N°01 Benefits */}
        <Section>
          <SectionLabel n="01" it="BENEFITS" en="What you get" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { n: '01', label: 'Priority entry', sub: 'Skip the queue at partner clubs' },
              { n: '02', label: '15% off bookings', sub: 'Applied automatically at checkout' },
              { n: '03', label: '1 monthly guest pass', sub: 'Bring one friend, no fee' },
              { n: '04', label: 'Early event access', sub: '48 hours before public tickets drop' },
            ].map(b => (
              <div key={b.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.12em', color: 'rgb(140,42,42)', flexShrink: 0, marginTop: 3 }}>{b.n}</span>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: INK, margin: '0 0 2px' }}>{b.label}</p>
                  <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: INK2, margin: 0 }}>{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* N°02 How to use */}
        <Section>
          <SectionLabel n="02" it="HOW TO USE" en="At the door" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {[
              { i: 'i', label: 'Show the pass', sub: 'Open this card or use Apple Wallet at the entrance.' },
              { i: 'ii', label: 'Skip the queue', sub: 'Look for the gold rope or the staff member with our pin.' },
              { i: 'iii', label: 'Bring +1, on the house', sub: 'Once a month. Add your guest\'s name in the app before you arrive.' },
            ].map(s => (
              <div key={s.i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 14, color: INK2, flexShrink: 0, minWidth: 20 }}>{s.i}.</span>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: INK, margin: '0 0 2px' }}>{s.label}</p>
                  <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: INK2, margin: 0 }}>{s.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Zaffiro upsell */}
        <Section>
          <div style={{ background: INK, borderRadius: 14, padding: '22px 20px' }}>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.20em', textTransform: 'uppercase', color: 'rgba(248,245,238,0.4)', margin: '0 0 8px' }}>
              COSA C'È SOPRA · WHAT'S NEXT
            </p>
            <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 26, fontWeight: 400, fontStyle: 'italic', color: CREAM, margin: '0 0 14px', lineHeight: 1.1 }}>
              Step into <em>Zaffiro.</em>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
              {['25% off everything', 'Four guest-list passes a month', 'A personal WhatsApp concierge', 'Invite-only afterhours nights'].map(b => (
                <p key={b} style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: 'rgba(248,245,238,0.65)', margin: 0 }}>— {b}</p>
              ))}
            </div>
            <button
              onClick={() => router.push('/membership/sapphire')}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 10,
                background: SAPH_BLUE, color: SAPH_NAVY,
                border: 'none', cursor: 'pointer',
                fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              Upgrade · €49 / mese
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </Section>
      </div>
      <NavSpacer />
    </div>
  )
}

// ─── ZAFFIRO dashboard ────────────────────────────────────────────────────────

function ZaffiroDashboard({ user, memberNum, host, validUntil, bookingCount, router }: {
  user: User; memberNum: string; host: HostData | null; validUntil: string | null; bookingCount: number; router: ReturnType<typeof useRouter>
}) {
  const saved = Math.round(bookingCount * 35 * 0.25) // rough €35 avg spend × 25% discount

  return (
    <div style={{ background: CREAM, minHeight: '100dvh', padding: '0 0 120px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '56px 24px 0' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: INK2 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: SAPH_NAVY, margin: 0 }}>
          TIER II · ZAFFIRO
        </p>
        <div style={{ width: 20 }} />
      </div>

      <div style={{ padding: '0 24px' }}>
        {/* hello */}
        <div style={{ padding: '28px 0 24px' }}>
          <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2, margin: '0 0 6px' }}>
            BUONASERA, {firstName(user.full_name)}
          </p>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, fontWeight: 400, color: INK, margin: '0 0 14px', lineHeight: 1.1 }}>
            La tua <em>tessera.</em>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: GREEN }}>
              ATTIVO
            </span>
            <span style={{ color: BORDER }}>·</span>
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: INK2 }}>
              Socio dal {fmtDate(user.created_at)}
            </span>
            <span style={{ color: BORDER }}>·</span>
            <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: INK2 }}>
              N° {memberNum}
            </span>
          </div>
        </div>

        {/* pass card */}
        <PassCard tier="sapphire" user={user} memberNum={memberNum} validUntil={validUntil} userId={user.id} />

        {/* N°01 Il tuo anno — stats */}
        <Section>
          <SectionLabel n="01" it="IL TUO ANNO" en="This year, in numbers" />
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              { val: bookingCount, label: 'Notti fuori', sub: 'NIGHTS OUT' },
              { val: Math.max(1, Math.round(bookingCount * 0.65)), label: 'Locali', sub: 'SAVED CLUBS' },
              { val: `€${saved}`, label: 'Risparmio', sub: 'SAVED THIS YEAR' },
            ].map(stat => (
              <div key={stat.sub} style={{ flex: 1, background: 'rgba(34,30,26,0.04)', borderRadius: 12, padding: '16px 12px', border: BORDER }}>
                <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, color: INK, margin: '0 0 4px', lineHeight: 1 }}>{stat.val}</p>
                <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 13, color: INK, margin: '0 0 2px' }}>{stat.label}</p>
                <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK2, margin: 0 }}>{stat.sub}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* N°02 Benefits */}
        <Section>
          <SectionLabel n="02" it="BENEFITS" en="What you get" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { n: '01', label: 'Priority entry', sub: 'Front-door, all partner clubs' },
              { n: '02', label: '25% off bookings', sub: 'Applied automatically at checkout' },
              { n: '03', label: 'Guest list · 4× per month', sub: 'Add up to 4 names per night' },
              { n: '04', label: 'WhatsApp concierge', sub: 'Personal line, 10am — 2am' },
              { n: '05', label: 'Afterhours invites', sub: 'Invite-only nights after 03:00' },
            ].map(b => (
              <div key={b.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.12em', color: SAPH_NAVY, flexShrink: 0, marginTop: 3 }}>{b.n}</span>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: INK, margin: '0 0 2px' }}>{b.label}</p>
                  <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: INK2, margin: 0 }}>{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* N°03 Il Concierge */}
        <Section>
          <SectionLabel n="03" it="IL CONCIERGE" en="WhatsApp concierge" />
          <div style={{ background: INK, borderRadius: 14, padding: '20px' }}>
            {host ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(221,230,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 18, color: SAPH_BLUE }}>{host.avatar_initial}</span>
                  </div>
                  <div>
                    <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 17, color: CREAM, margin: '0 0 2px' }}>{host.name}</p>
                    <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, color: 'rgba(248,245,238,0.45)', margin: '0 0 1px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                      {host.role}{host.years_with_fuoco ? ` · ${host.years_with_fuoco} anni con Fuoco` : ''}
                    </p>
                    {host.cities && (
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, color: 'rgba(248,245,238,0.35)', margin: 0, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                        {host.cities.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                {host.whatsapp_url ? (
                  <a href={host.whatsapp_url} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', borderRadius: 10, background: SAPH_BLUE, color: SAPH_NAVY, textDecoration: 'none', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Open chat
                  </a>
                ) : (
                  <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: 'rgba(248,245,238,0.3)', textAlign: 'center', margin: 0, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Contact details coming soon</p>
                )}
              </>
            ) : (
              <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 14, color: 'rgba(248,245,238,0.35)', margin: 0, textAlign: 'center' }}>
                Your concierge will be assigned shortly.
              </p>
            )}
          </div>
        </Section>

        {/* Nero upsell */}
        <Section>
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 20px' }}>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.20em', textTransform: 'uppercase', color: INK2, margin: '0 0 8px' }}>
              N° III · NERO
            </p>
            <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontStyle: 'italic', color: INK, margin: '0 0 8px' }}>
              "A room you earn, not buy."
            </p>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 12, color: INK2, margin: '0 0 18px', lineHeight: 1.5 }}>
              Nero is invite-only. If you'd like to talk, your concierge can introduce you.
            </p>
            <button
              onClick={() => {/* concierge intro request */}}
              style={{
                background: 'none', border: `1px solid ${BORDER}`, borderRadius: 10,
                padding: '9px 18px', cursor: 'pointer',
                fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK2,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              Request an introduction →
            </button>
          </div>
        </Section>
      </div>
      <NavSpacer />
    </div>
  )
}

// ─── Nero event types ─────────────────────────────────────────────────────────

interface NeroEvent {
  id:         string
  title:      string
  description: string | null
  location:   string | null
  event_date: string
  capacity:   number
  plus_one:   boolean
  rsvp:       'going' | 'interested' | 'declined' | null
  clubs:      { id: string; name: string; neighborhood: string | null } | null
}

function fmtEventDate(iso: string): [string, string] {
  const d = new Date(iso)
  const day = d.toLocaleDateString('it-IT', { day: '2-digit' })
  const month = d.toLocaleDateString('it-IT', { month: 'long' }).toUpperCase()
  return [day, month]
}

// ─── NERO dashboard ───────────────────────────────────────────────────────────

function NeroDashboard({ user, memberNum, host, router }: {
  user: User; memberNum: string; host: HostData | null; router: ReturnType<typeof useRouter>
}) {
  const [events,  setEvents]  = useState<NeroEvent[]>([])
  const [evLoading, setEvLoading] = useState(true)

  useEffect(() => {
    fetch('/api/nero/events')
      .then(r => r.json())
      .then(d => { setEvents(d.events ?? []); setEvLoading(false) })
      .catch(() => setEvLoading(false))
  }, [])

  async function rsvp(eventId: string, status: 'going' | 'interested' | 'declined') {
    await fetch('/api/nero/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, status }),
    })
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, rsvp: status } : e))
  }

  return (
    <div style={{ background: NERO_BG, minHeight: '100dvh', padding: '0 0 120px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '56px 24px 0' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: `rgba(244,233,214,0.5)` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: NERO_GOLD, margin: 0 }}>
          TIER III · NERO
        </p>
        <div style={{ width: 20 }} />
      </div>

      <div style={{ padding: '0 24px' }}>
        {/* hello */}
        <div style={{ padding: '28px 0 24px' }}>
          <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: `rgba(244,233,214,0.45)`, margin: '0 0 6px' }}>
            BUONASERA, {firstName(user.full_name)}
          </p>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, fontWeight: 400, color: NERO_INK, margin: '0 0 10px', lineHeight: 1.1 }}>
            Il tuo <em>salotto.</em>
          </h1>
          <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 14, color: `rgba(244,233,214,0.5)`, margin: 0 }}>
            "Your room is open."
          </p>
        </div>

        {/* pass card */}
        <PassCard tier="black" user={user} memberNum={memberNum} validUntil={null} userId={user.id} />

        {/* N°01 Il tuo ospite — dedicated host */}
        <Section dark>
          <SectionLabel n="01" it="IL TUO OSPITE" en="Your dedicated host" dark />
          <div style={{ background: 'rgba(232,182,91,0.06)', border: '1px solid rgba(232,182,91,0.14)', borderRadius: 14, padding: '20px' }}>
            {host ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(232,182,91,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 20, color: NERO_GOLD }}>{host.avatar_initial}</span>
                  </div>
                  <div>
                    <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 18, color: NERO_INK, margin: '0 0 2px' }}>{host.name}</p>
                    <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, color: `rgba(244,233,214,0.45)`, margin: '0 0 1px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                      {host.role}{host.years_with_fuoco ? ` · ${host.years_with_fuoco} anni con Fuoco` : ''}
                    </p>
                    {host.cities && (
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, color: `rgba(244,233,214,0.35)`, margin: 0, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                        {host.cities.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: `rgba(244,233,214,0.35)`, margin: '0 0 12px' }}>
                  24/7 · DIRECT LINE
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  {host.phone && (
                    <a href={`tel:${host.phone}`} style={{ flex: 1, padding: '10px 0', borderRadius: 10, textAlign: 'center', background: NERO_GOLD, color: NERO_BG, textDecoration: 'none', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Call now
                    </a>
                  )}
                  {host.whatsapp_url && (
                    <a href={host.whatsapp_url} style={{ flex: 1, padding: '10px 0', borderRadius: 10, textAlign: 'center', background: 'rgba(232,182,91,0.12)', border: '1px solid rgba(232,182,91,0.25)', color: NERO_GOLD, textDecoration: 'none', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      Message
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 14, color: `rgba(244,233,214,0.35)`, margin: 0, textAlign: 'center' }}>
                Your dedicated host will be introduced shortly.
              </p>
            )}
          </div>
        </Section>

        {/* N°02 Solo per Nero — private events */}
        <Section dark>
          <SectionLabel n="02" it="SOLO PER NERO" en="Private nights" dark />
          {evLoading ? (
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: `rgba(244,233,214,0.3)`, margin: 0 }}>Loading…</p>
          ) : events.length === 0 ? (
            <div style={{ background: 'rgba(232,182,91,0.04)', border: '1px solid rgba(232,182,91,0.08)', borderRadius: 14, padding: '24px 20px', textAlign: 'center' }}>
              <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 15, color: `rgba(244,233,214,0.45)`, margin: '0 0 6px' }}>No private nights scheduled yet.</p>
              <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: `rgba(244,233,214,0.25)`, margin: 0, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Your host will notify you when the next one drops.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {events.map(ev => {
                const [day, month] = fmtEventDate(ev.event_date)
                const guestTag = ev.plus_one ? 'NERO + 1' : 'NERO ONLY'
                const ctaLabel = ev.rsvp === 'going' ? 'Going ✓' : ev.rsvp === 'declined' ? 'Declined' : 'RSVP'
                return (
                  <div key={ev.id} style={{ background: 'rgba(232,182,91,0.06)', border: '1px solid rgba(232,182,91,0.10)', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    {/* date column */}
                    <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 44 }}>
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 20, color: NERO_INK, margin: 0, lineHeight: 1 }}>{day}</p>
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 7, letterSpacing: '0.12em', textTransform: 'uppercase', color: `rgba(244,233,214,0.4)`, margin: 0 }}>{month}</p>
                    </div>
                    {/* body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: NERO_GOLD, margin: '0 0 4px' }}>
                        {guestTag} · {ev.capacity} OSPITI · {ev.clubs?.name ?? ''}
                      </p>
                      <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: NERO_INK, margin: '0 0 3px' }}>{ev.title}</p>
                      {(ev.description || ev.location) && (
                        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: `rgba(244,233,214,0.45)`, margin: 0, lineHeight: 1.4 }}>
                          {ev.description}{ev.description && ev.location ? ' · ' : ''}{ev.location}
                        </p>
                      )}
                    </div>
                    {/* RSVP button */}
                    <button
                      onClick={() => rsvp(ev.id, ev.rsvp === 'going' ? 'declined' : 'going')}
                      style={{
                        flexShrink: 0, alignSelf: 'center',
                        background: ev.rsvp === 'going' ? 'rgba(232,182,91,0.25)' : 'rgba(232,182,91,0.12)',
                        border: '1px solid rgba(232,182,91,0.25)',
                        borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                        fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                        fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: NERO_GOLD,
                      }}
                    >
                      {ctaLabel}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* N°03 Il Room — unlimited benefits */}
        <Section dark>
          <SectionLabel n="03" it="IL ROOM" en="What's always open" dark />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: '∞', label: 'Every door, open', sub: 'Free VIP entry across all partner clubs · no lists, no caps' },
              { icon: '+', label: 'Bring whoever', sub: 'Unlimited guest list · they\'re with you, that\'s enough' },
              { icon: '★', label: 'First through the door', sub: 'Every new partner — you walk in before the city knows it exists' },
            ].map(b => (
              <div key={b.label} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: NERO_GOLD, flexShrink: 0, minWidth: 20, marginTop: 2 }}>{b.icon}</span>
                <div>
                  <p style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 16, color: NERO_INK, margin: '0 0 2px' }}>{b.label}</p>
                  <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: `rgba(244,233,214,0.45)`, margin: 0, lineHeight: 1.4 }}>{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer signature */}
        <div style={{ marginTop: 40, paddingTop: 28, borderTop: '1px solid rgba(244,233,214,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,233,214,0.08)' }} />
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.20em', textTransform: 'uppercase', color: `rgba(244,233,214,0.25)`, margin: 0 }}>
              FUOCO · NERO · MMXXVI
            </p>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,233,214,0.08)' }} />
          </div>
          <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', color: `rgba(244,233,214,0.2)`, textAlign: 'center', margin: '8px 0 0' }}>
            N° {memberNum} / 200 — "La stanza è tua."
          </p>
        </div>
      </div>
      <NavSpacer />
    </div>
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function MemberDashboard({ user }: { user: User }) {
  const router = useRouter()
  const tier   = user.membership_tier

  const [memberNum,    setMemberNum]    = useState<string>('—')
  const [validUntil,   setValidUntil]   = useState<string | null>(null)
  const [host,         setHost]         = useState<HostData | null>(null)
  const [bookingCount, setBookingCount] = useState(0)

  useEffect(() => {
    // Fetch member number, renewal date, and assigned host in one call
    fetch('/api/me/membership')
      .then(r => r.json())
      .then(d => {
        if (d.memberNumber) setMemberNum(fmtMemberNum(d.memberNumber))
        if (d.validUntil)   setValidUntil(d.validUntil)
        if (d.host)         setHost(d.host)
      })
      .catch(() => {})

    // Booking count for Zaffiro stats
    const supabase = createClient()
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['confirmed', 'used'])
      .then(({ count }: { count: number | null }) => { if (count) setBookingCount(count) })
  }, [user.id])

  if (tier === 'black')    return <NeroDashboard    user={user} memberNum={memberNum} host={host} router={router} />
  if (tier === 'sapphire') return <ZaffiroDashboard user={user} memberNum={memberNum} host={host} validUntil={validUntil} bookingCount={bookingCount} router={router} />
  if (tier === 'gold')     return <OroDashboard     user={user} memberNum={memberNum} validUntil={validUntil} router={router} />

  return null
}
