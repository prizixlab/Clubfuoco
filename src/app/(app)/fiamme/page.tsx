'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
// Lazy-loaded only when user actually redeems — keeps qrcode out of initial bundle
async function generateQR(text: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(text, { width: 220, margin: 2, color: { dark: '#221E1A', light: '#FFFFFF' } })
}

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const C = {
  bg:        '#F8F5EE',
  surface:   '#FFFFFF',
  ink:       '#221E1A',
  ink2:      '#6E6356',
  ink3:      '#9F9486',
  accent:    '#8C2A2A',
  gold:      '#B8941E',
  goldFaint: 'rgba(184,148,30,0.10)',
  green:     '#2D7A46',
  line:      'rgba(34,30,26,0.08)',
  pillBg:    'rgba(34,30,26,0.05)',
  dark:      '#1A1612',
}

/* ─── Static data ───────────────────────────────────────────────────────── */
const TIERS = [
  { key: 'nuovo',       label: 'Nuovo',       sub: 'Newcomer',    min: 0,  mult: '1×',   perk: 'Welcome bonus · book + review' },
  { key: 'regolare',    label: 'Regolare',    sub: 'Regular',     min: 5,  mult: '1.2×', perk: '1.2× points · early renewal hold' },
  { key: 'conoscitore', label: 'Conoscitore', sub: 'Connoisseur', min: 15, mult: '1.5×', perk: '1.5× points · venue first looks' },
  { key: 'tastemaker',  label: 'Tastemaker',  sub: 'Tastemaker',  min: 30, mult: '2×',   perk: '2× points · curator credit' },
]

const REWARDS = [
  { key: 'comp_drink',     label: 'Comp drink',     desc: 'House cocktail, any partner',  cost: 100  },
  { key: 'skip_line',      label: 'Skip the line',  desc: 'Walk in front, any night',     cost: 250  },
  { key: 'free_cover',     label: 'Free cover',     desc: 'Up to €30 entry fee waived',   cost: 500  },
  { key: 'bottle_deposit', label: 'Bottle deposit', desc: 'Toward bottle service',        cost: 1000 },
]

const EARN_WAYS = [
  { n: '01', pts: '+10', label: 'Verified review',    desc: 'After your booking, write a short note.'    },
  { n: '02', pts: '+50', label: 'First at the venue', desc: 'Be the first to review a partner club.'     },
  { n: '03', pts: '+30', label: 'Weekly streak',      desc: 'Review every week, four weeks running.'     },
]

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function getTier(reviewCount: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (reviewCount >= TIERS[i].min) return TIERS[i]
  }
  return TIERS[0]
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return '1 day ago'
  if (d < 7) return `${d} days ago`
  const w = Math.floor(d / 7)
  return w === 1 ? '1 week ago' : `${w} weeks ago`
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <p style={{
      fontFamily: 'ui-monospace, monospace', fontSize: 9.5,
      letterSpacing: '1.5px', textTransform: 'uppercase',
      color: C.ink3, margin: '0 0 14px 0', fontWeight: 500,
    }}>
      N° {n} · {label}
    </p>
  )
}

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Activity {
  id: string
  amount: number
  type: string
  description: string
  created_at: string
}

interface FiammeData {
  balance: number
  review_count: number
  activity: Activity[]
}

type Reward = typeof REWARDS[0]
type Sheet =
  | null
  | { mode: 'confirm'; reward: Reward }
  | { mode: 'qr'; reward: Reward; code: string }

/* ─── Component ─────────────────────────────────────────────────────────── */
export default function FiammePage() {
  const router = useRouter()
  const [data, setData]         = useState<FiammeData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [sheet, setSheet]       = useState<Sheet>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [qrSrc, setQrSrc]       = useState<string>('')
  const [sheetVisible, setSheetVisible] = useState(false)

  useEffect(() => {
    apiFetch('/api/fiamme')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setData(d.data) })
      .finally(() => setLoading(false))
  }, [])

  // Animate sheet in
  useEffect(() => {
    if (sheet) { requestAnimationFrame(() => setSheetVisible(true)) }
    else { setSheetVisible(false) }
  }, [sheet])

  async function handleConfirmRedeem() {
    if (!sheet || sheet.mode !== 'confirm') return
    setRedeeming(true)
    try {
      const res = await apiFetch('/api/fiamme/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reward_key: sheet.reward.key }),
      })
      if (res.ok) {
        const { data: rd } = await res.json()
        const src = await generateQR(rd.code)
        setQrSrc(src)
        setData(prev => prev
          ? { ...prev, balance: prev.balance - sheet.reward.cost }
          : prev
        )
        setSheet({ mode: 'qr', reward: sheet.reward, code: rd.code })
      }
    } finally {
      setRedeeming(false)
    }
  }

  function closeSheet() {
    setSheetVisible(false)
    setTimeout(() => setSheet(null), 280)
  }

  const balance  = data?.balance      ?? 0
  const reviews  = data?.review_count ?? 0
  const tier     = getTier(reviews)
  const tierIdx  = TIERS.findIndex(t => t.key === tier.key)
  const nextTier = TIERS[tierIdx + 1] ?? null
  const progressPct = nextTier
    ? Math.min(100, ((reviews - tier.min) / (nextTier.min - tier.min)) * 100)
    : 100
  const toNext = nextTier ? nextTier.min - reviews : 0
  const isEmpty = !loading && !data

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: C.bg,
        borderBottom: `1px solid ${C.line}`,
        paddingTop: 'calc(env(safe-area-inset-top, 44px) + 10px)',
        paddingBottom: 12, paddingLeft: 16, paddingRight: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={() => router.back()}
          style={{ width: 36, height: 36, border: 'none', background: C.pillBg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.ink2 }}>arrow_back</span>
        </button>

        <p style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.ink3 }}>
          N° 06 · FIAMME
        </p>

        <button
          style={{ width: 36, height: 36, border: 'none', background: C.pillBg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.ink2 }}>info</span>
        </button>
      </header>

      {/* ── Loading skeleton ──────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[180, 140, 220, 180].map((h, i) => (
            <div key={i} style={{
              height: h, borderRadius: 16, background: 'rgba(34,30,26,0.05)',
              animation: `pulse 1.4s ${i * 0.1}s ease-in-out infinite`,
            }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
        </div>
      )}

      {/* ── Empty / first-run state ───────────────────────────────────── */}
      {isEmpty && (
        <div style={{ padding: '40px 20px 80px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.ink3, margin: '0 0 32px', alignSelf: 'flex-start' }}>
            N° 00 · BENVENUTO
          </p>

          {/* Flame illustration */}
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: `linear-gradient(145deg, #2A1B08 0%, ${C.dark} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32, position: 'relative', overflow: 'hidden' }}>
            {/* Halftone dots */}
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
            <span className="material-symbols-outlined" style={{ fontSize: 36, color: C.gold, fontVariationSettings: "'FILL' 1", position: 'relative' }}>local_fire_department</span>
          </div>

          <h1 style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontSize: 32, fontWeight: 400, color: C.ink, margin: '0 0 12px', textAlign: 'center', lineHeight: 1.15 }}>
            Earn your first<br />Fiamma.
          </h1>

          <p style={{ fontSize: 14, color: C.ink2, textAlign: 'center', lineHeight: 1.6, margin: '0 0 8px', maxWidth: 280 }}>
            Book a club, leave a verified review.
          </p>
          <p style={{ fontSize: 14, color: C.ink2, textAlign: 'center', lineHeight: 1.6, margin: '0 0 40px', maxWidth: 280 }}>
            Spend your Fiamme on perks at partner venues.
          </p>

          <button
            onClick={() => router.push('/explore')}
            style={{ background: C.ink, color: C.bg, border: 'none', borderRadius: 99, padding: '13px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
          >
            Find a club tonight
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
          </button>

          <p style={{ marginTop: 'auto', paddingTop: 60, fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: C.ink3 }}>
            una serata curata · CLUB FUOCO
          </p>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────────── */}
      {!loading && data && (
        <div style={{ padding: '24px 20px 120px', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* ── §01 Balance ─────────────────────────────────────────── */}
          <section>
            <SectionLabel n="01" label="LA TUA RICOMPENSA" />

            <div style={{
              borderRadius: 18,
              background: `linear-gradient(150deg, #2C2318 0%, ${C.dark} 100%)`,
              padding: '24px 22px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              {/* Halftone dot overlay */}
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)', backgroundSize: '10px 10px', pointerEvents: 'none' }} />

              <div style={{ position: 'relative' }}>
                <p style={{ margin: '0 0 4px', fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontSize: 15, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.02em' }}>
                  Fiamme
                </p>
                <p style={{ margin: '0 0 6px', fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontSize: 64, fontWeight: 400, color: '#FFFFFF', lineHeight: 1, letterSpacing: '-0.02em' }}>
                  {balance.toLocaleString()}
                </p>
                <p style={{ margin: '0 0 18px', fontSize: 12, color: 'rgba(255,255,255,0.45)', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', letterSpacing: '0.02em' }}>
                  {balance.toLocaleString()} Fiamme available
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: C.gold, color: '#1A1008', fontSize: 11, fontWeight: 600, borderRadius: 99, padding: '3px 10px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', letterSpacing: '0.02em' }}>
                    {tier.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                    · {reviews} {reviews === 1 ? 'review' : 'reviews'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ── §02 Progress ─────────────────────────────────────────── */}
          <section>
            <SectionLabel n="02" label="PROGRESSO" />

            {nextTier && (
              <p style={{ fontSize: 13, color: C.ink2, margin: '0 0 14px', lineHeight: 1.4 }}>
                <span style={{ color: C.ink, fontWeight: 500 }}>{toNext} {toNext === 1 ? 'review' : 'reviews'}</span> to{' '}
                <span style={{ color: C.gold, fontWeight: 500 }}>{nextTier.label}</span>
              </p>
            )}

            {/* Progress bar */}
            <div style={{ height: 5, background: C.line, borderRadius: 99, marginBottom: 24, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: C.gold, borderRadius: 99, transition: 'width 0.6s ease' }} />
            </div>

            {/* Tier ladder */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {TIERS.map((t, i) => {
                const isActive  = t.key === tier.key
                const isPast    = i < tierIdx
                return (
                  <div key={t.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    padding: '13px 0',
                    borderBottom: i < TIERS.length - 1 ? `1px solid ${C.line}` : 'none',
                  }}>
                    {/* Dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                      background: isActive ? C.gold : isPast ? C.ink3 : C.line,
                      border: isActive ? 'none' : `1.5px solid ${isPast ? C.ink3 : 'rgba(34,30,26,0.15)'}`,
                    }} />

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? C.ink : C.ink2, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                          {t.label}
                        </span>
                        <span style={{ fontSize: 11, color: C.ink3 }}>
                          {t.sub}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: isActive ? C.gold : C.ink3, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.03em' }}>
                          {t.mult} pts
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 11.5, color: C.ink3, lineHeight: 1.4 }}>
                        {t.perk}
                      </p>
                      {!isActive && (
                        <p style={{ margin: '2px 0 0', fontSize: 10, color: 'rgba(34,30,26,0.3)', fontFamily: 'ui-monospace, monospace', letterSpacing: '1px', textTransform: 'uppercase' }}>
                          {t.min}+ reviews
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── §03 Earn ──────────────────────────────────────────────── */}
          <section>
            <SectionLabel n="03" label="GUADAGNA" />
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'ui-monospace, monospace' }}>
              Ways to earn
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {EARN_WAYS.map((w, i) => (
                <div key={w.n} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 0',
                  borderBottom: i < EARN_WAYS.length - 1 ? `1px solid ${C.line}` : 'none',
                }}>
                  <span style={{ fontSize: 11, color: C.ink3, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.08em', width: 20, flexShrink: 0 }}>
                    {w.n}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 500, color: C.ink }}>
                      {w.label}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: C.ink3 }}>
                      {w.desc}
                    </p>
                  </div>
                  <span style={{ background: C.green, color: '#FFFFFF', fontSize: 12, fontWeight: 600, borderRadius: 99, padding: '3px 10px', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
                    {w.pts}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ── §04 Spend ─────────────────────────────────────────────── */}
          <section>
            <SectionLabel n="04" label="SPENDI" />
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'ui-monospace, monospace' }}>
              Spend your Fiamme
            </p>

            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                filter: 'blur(5px)', opacity: 0.55,
                pointerEvents: 'none', userSelect: 'none',
              }}>
                {REWARDS.map(r => (
                  <div
                    key={r.key}
                    style={{
                      background: C.surface,
                      border: `1px solid rgba(34,30,26,0.05)`,
                      borderRadius: 14, padding: '16px 14px',
                      textAlign: 'left',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                      {r.label}
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: C.ink3, lineHeight: 1.4 }}>
                      {r.desc}
                    </p>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12, color: C.gold, fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink3, fontFamily: 'ui-monospace, monospace' }}>
                        {r.cost.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Coming soon overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'ui-monospace, monospace', fontSize: 10,
                  letterSpacing: '2.2px', textTransform: 'uppercase',
                  color: C.bg, background: C.ink,
                  borderRadius: 999, padding: '8px 18px',
                }}>
                  Coming soon
                </span>
              </div>
            </div>
          </section>

          {/* ── §05 Activity ─────────────────────────────────────────── */}
          {data.activity.length > 0 && (
            <section>
              <SectionLabel n="05" label="MOVIMENTI" />
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'ui-monospace, monospace' }}>
                Recent activity
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {data.activity.slice(0, 5).map((a, i) => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: i < Math.min(data.activity.length, 5) - 1 ? `1px solid ${C.line}` : 'none',
                  }}>
                    <div>
                      <p style={{ margin: '0 0 2px', fontSize: 13, color: C.ink, fontWeight: 400 }}>
                        {a.description}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: C.ink3 }}>
                        {timeAgo(a.created_at)}
                      </p>
                    </div>
                    <span style={{
                      fontSize: 14, fontWeight: 600,
                      color: a.amount > 0 ? C.green : C.accent,
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      {a.amount > 0 ? '+' : ''}{a.amount}
                    </span>
                  </div>
                ))}
              </div>

              {data.activity.length > 5 && (
                <p style={{ margin: '16px 0 0', fontSize: 12, color: C.ink2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  View all activity
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
                </p>
              )}
            </section>
          )}

          {/* ── Footer quote ─────────────────────────────────────────── */}
          <footer style={{ textAlign: 'center', paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
            <p style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontSize: 15, color: C.ink2, margin: '0 0 8px' }}>
              "Ogni recensione, una fiamma."
            </p>
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: C.ink3, margin: 0 }}>
              CLUB FUOCO · MMXXVI
            </p>
          </footer>
        </div>
      )}

      {/* ── Bottom sheet overlay ──────────────────────────────────────── */}
      {sheet && (
        <>
          {/* Scrim */}
          <div
            onClick={closeSheet}
            style={{
              position: 'fixed', inset: 0, zIndex: 40,
              background: 'rgba(26,22,18,0.5)',
              opacity: sheetVisible ? 1 : 0,
              transition: 'opacity 0.28s ease',
            }}
          />

          {/* Sheet */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: C.dark,
            borderRadius: '20px 20px 0 0',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)',
            transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.28s cubic-bezier(0.32,0,0.15,1)',
            overflow: 'hidden',
          }}>
            {/* Halftone overlay on sheet */}
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '10px 10px', pointerEvents: 'none' }} />

            {/* ── Confirm sheet ── */}
            {sheet.mode === 'confirm' && (
              <div style={{ padding: '28px 24px 8px', position: 'relative' }}>
                <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', margin: '0 0 20px', textAlign: 'center' }}>
                  N° 04 · CONFERMA
                </p>

                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 26, color: C.gold, fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                  </div>
                  <h2 style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontStyle: 'italic', fontWeight: 400, fontSize: 26, color: '#FFFFFF', margin: '0 0 6px' }}>
                    Redeem
                  </h2>
                  <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: C.gold, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                    {sheet.reward.label}
                  </p>
                  <p style={{ margin: '0 0 20px', fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                    {sheet.reward.desc}. You'll receive a one-use code to show at the bar.
                  </p>

                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 99, padding: '8px 18px', marginBottom: 28 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.gold, fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.gold, fontFamily: 'ui-monospace, monospace' }}>{sheet.reward.cost}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Fiamme</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={closeSheet}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 12, padding: '14px 0', fontSize: 14, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 500 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmRedeem}
                    disabled={redeeming}
                    style={{ flex: 2, background: C.accent, border: 'none', borderRadius: 12, padding: '14px 0', fontSize: 14, color: '#FFFFFF', cursor: redeeming ? 'default' : 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600, opacity: redeeming ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    {redeeming && <span className="material-symbols-outlined" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>progress_activity</span>}
                    {redeeming ? 'Processing…' : 'Confirm redemption'}
                  </button>
                </div>
              </div>
            )}

            {/* ── QR sheet ── */}
            {sheet.mode === 'qr' && (
              <div style={{ padding: '28px 24px 8px', position: 'relative', textAlign: 'center' }}>
                <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', margin: '0 0 20px' }}>
                  REDEEMED · {sheet.reward.label.toUpperCase()}
                </p>

                <p style={{ margin: '0 0 20px', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                  Show this at the bar
                </p>

                {/* QR code */}
                {qrSrc && (
                  <div style={{ display: 'inline-block', background: '#FFFFFF', borderRadius: 14, padding: 12, marginBottom: 16 }}>
                    <img src={qrSrc} alt="Redemption QR code" style={{ width: 180, height: 180, display: 'block' }} />
                  </div>
                )}

                <p style={{ margin: '0 0 4px', fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
                  CODE · {sheet.code}
                </p>
                <p style={{ margin: '0 0 28px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Expires in 24 hours
                </p>

                <button
                  onClick={closeSheet}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.09)', border: 'none', borderRadius: 12, padding: '14px 0', fontSize: 15, color: '#FFFFFF', cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 500 }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
