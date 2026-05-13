'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Ember particles ──────────────────────────────────────────────────────────
const EMBERS = [
  { s: 2, left: '5%',  delay: 0.0,  dur: 5.5, col: 'rgb(255,199,128)' },
  { s: 3, left: '13%', delay: 0.4,  dur: 5.0, col: 'rgb(255,224,168)' },
  { s: 2, left: '24%', delay: 0.7,  dur: 6.0, col: 'rgb(232,182,91)'  },
  { s: 4, left: '38%', delay: 1.1,  dur: 4.5, col: 'rgb(255,154,90)'  },
  { s: 2, left: '57%', delay: 1.5,  dur: 5.8, col: 'rgb(255,199,128)' },
  { s: 3, left: '72%', delay: 0.6,  dur: 5.2, col: 'rgb(232,182,91)'  },
  { s: 2, left: '84%', delay: 1.9,  dur: 4.8, col: 'rgb(255,224,168)' },
  { s: 4, left: '94%', delay: 1.2,  dur: 6.2, col: 'rgb(255,154,90)'  },
]

const STYLES = `
  @keyframes el-glow {
    0%, 100% { opacity: 0.75; }
    50%       { opacity: 1;    }
  }
  @keyframes el-ember {
    0%   { transform: translateY(0)      scale(1);   opacity: 0;   }
    8%   {                                           opacity: 1;   }
    85%  {                                           opacity: 0.7; }
    100% { transform: translateY(-110vh) scale(0.5); opacity: 0;   }
  }
  @keyframes el-fade-in {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes el-dot-glow {
    0%, 100% { box-shadow: rgba(255,200,120,0.6)  0 0 6px  1px; }
    50%       { box-shadow: rgba(255,200,120,0.95) 0 0 14px 4px; }
  }
`

interface Props {
  /** When true: complete the bar to 100 % and fade out */
  done: boolean
  /** Called once the exit animation finishes and the overlay is fully gone */
  onGone?: () => void
}

export default function ExploreLoader({ done, onGone }: Props) {
  const [pct,     setPct]     = useState(0)
  const [exiting, setExiting] = useState(false)
  const [gone,    setGone]    = useState(false)
  const rafRef = useRef<number | null>(null)

  // ── Simulate progress while loading (ease-out curve toward 82 %) ──────────
  // Delayed 650 ms so the bar is at 0 when the bottom section finishes fading in,
  // giving the user a clear view of the movement from the very start.
  useEffect(() => {
    if (done) return

    const delayTimer = setTimeout(() => {
      const start    = performance.now()
      const duration = 2200   // ms to reach 82 % (slow enough to read)
      const target   = 82

      const tick = (now: number) => {
        const t    = Math.min((now - start) / duration, 1)
        const ease = 1 - Math.pow(1 - t, 3)  // ease-out cubic
        setPct(Math.round(ease * target))
        if (t < 1) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }, 650)

    return () => {
      clearTimeout(delayTimer)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [done])

  // ── Complete bar then fade out once data is ready ─────────────────────────
  useEffect(() => {
    if (!done) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    setPct(100)
    const t1 = setTimeout(() => setExiting(true), 320)
    const t2 = setTimeout(() => { setGone(true); onGone?.() }, 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [done])

  if (gone) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ── Full-screen overlay ─────────────────────────────────────────── */}
      <div style={{
        position:  'fixed', inset: 0, zIndex: 9998,
        background: 'rgb(10, 6, 4)',
        overflow:  'hidden',
        display:   'flex', flexDirection: 'column',
        opacity:    exiting ? 0 : 1,
        transition: exiting ? 'opacity 0.58s ease-in' : undefined,
        pointerEvents: exiting ? 'none' : undefined,
      }}>

        {/* ── Ambient glow ─────────────────────────────────────────────── */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: [
            'radial-gradient(110% 60% at 50% 110%,',
            '  rgba(255,180,90,0.55)  0%,',
            '  rgba(232,110,40,0.32) 28%,',
            '  rgba(120,40,20,0.18)  50%,',
            '  rgba(0,0,0,0)         70%)',
            ',',
            'radial-gradient(80% 50% at 50% 100%,',
            '  rgba(255,232,181,0.18) 0%,',
            '  rgba(0,0,0,0)          60%)',
          ].join(' '),
          animation: 'el-glow 6s ease-in-out infinite',
        }} />

        {/* ── Embers ───────────────────────────────────────────────────── */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {EMBERS.map((e, i) => (
            <div key={i} style={{
              position: 'absolute', left: e.left, bottom: -10,
              width: e.s, height: e.s, borderRadius: '50%',
              background: e.col,
              boxShadow: 'rgba(255,200,120,0.85) 0 0 6px 1px',
              animation: `el-ember ${e.dur}s ${e.delay}s ease-in infinite`,
            }} />
          ))}
        </div>

        {/* ── Corner TL ────────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          top:  'max(52px, calc(env(safe-area-inset-top, 0px) + 18px))',
          left:  22,
          fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
          fontSize:       9, letterSpacing: '2.34px',
          textTransform: 'uppercase', color: 'rgba(244,236,221,0.38)',
          animation: 'el-fade-in 0.5s 0.05s ease-out both',
        }}>N° 00</div>

        {/* ── Corner TR ────────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          top:  'max(52px, calc(env(safe-area-inset-top, 0px) + 18px))',
          right: 22,
          fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
          fontSize:       9, letterSpacing: '2.34px',
          textTransform: 'uppercase', color: 'rgba(244,236,221,0.38)',
          animation: 'el-fade-in 0.5s 0.12s ease-out both',
        }}>FUOCO · MMXXVI</div>

        {/* ── Centre block ─────────────────────────────────────────────── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 28px',
        }}>

          <p style={{
            fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
            fontSize:       9.5, letterSpacing: '3.2px',
            textTransform: 'uppercase', color: 'rgba(244,236,221,0.38)',
            margin: '0 0 10px', textAlign: 'center',
            animation: 'el-fade-in 0.55s 0.18s ease-out both',
          }}>N° 00 · APERTURA</p>

          <h1 style={{
            fontFamily:  '"Instrument Serif", Georgia, serif',
            fontSize:    'clamp(58px, 18vw, 80px)',
            fontStyle:   'italic', fontWeight: 400,
            color:       'rgb(244,236,221)',
            letterSpacing: '-0.5px', lineHeight: 0.92,
            margin: '0 0 22px', textAlign: 'center',
            animation: 'el-fade-in 0.65s 0.25s ease-out both',
          }}>
            CLUB&nbsp;FUOCO
          </h1>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', maxWidth: 290, margin: '0 0 14px',
            animation: 'el-fade-in 0.55s 0.34s ease-out both',
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,236,221,0.18)' }} />
            <span style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 12, fontStyle: 'italic',
              color: 'rgba(244,236,221,0.4)', whiteSpace: 'nowrap',
            }}>una serata curata</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,236,221,0.18)' }} />
          </div>

          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 15, fontStyle: 'italic',
            color: 'rgba(244,236,221,0.5)',
            textAlign: 'center', margin: 0,
            animation: 'el-fade-in 0.55s 0.42s ease-out both',
          }}>
            &ldquo;La notte ci appartiene.&rdquo;
          </p>
        </div>

        {/* ── Bottom: progress bar ─────────────────────────────────────── */}
        <div style={{
          padding:       '0 28px',
          paddingBottom: 'calc(36px + env(safe-area-inset-bottom, 0px))',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 14,
          animation: 'el-fade-in 0.55s 0.52s ease-out both',
        }}>

          {/* Progress rail */}
          <div style={{
            position: 'relative', width: '100%', maxWidth: 320, height: 14,
            display: 'flex', alignItems: 'center',
          }}>
            {/* Rail */}
            <div style={{
              position: 'absolute', left: 0, right: 0,
              top: '50%', height: 1, marginTop: -0.5,
              background: 'rgba(244,236,221,0.15)',
            }} />
            {/* Fill */}
            <div style={{
              position: 'absolute', left: 0,
              top: '50%', height: 2, marginTop: -1,
              width: `${pct}%`,
              background: 'linear-gradient(90deg, rgb(140,58,30) 0%, rgb(232,182,91) 60%, rgb(255,224,168) 100%)',
              boxShadow: 'rgba(255,200,120,0.55) 0 0 10px 0',
              transition: 'width 0.08s linear',
              borderRadius: 1,
            }} />
            {/* Glowing dot at the fill tip */}
            <div style={{
              position: 'absolute',
              left: `${pct}%`, top: '50%',
              width: 8, height: 8, borderRadius: '50%',
              marginTop: -4, marginLeft: -4,
              background: 'rgb(255,224,168)',
              transition: 'left 0.08s linear',
              animation: 'el-dot-glow 2s ease-in-out infinite',
            }} />
          </div>

          {/* Percentage + label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 9, letterSpacing: '2px',
              textTransform: 'uppercase', color: 'rgba(244,236,221,0.55)',
            }}>
              {String(pct).padStart(2, '0')}%
            </span>
            <span style={{ color: 'rgba(244,236,221,0.2)', fontSize: 8 }}>·</span>
            <span style={{
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 9, letterSpacing: '2.4px',
              textTransform: 'uppercase', color: 'rgba(244,236,221,0.28)',
            }}>
              Curando la notte
            </span>
          </div>

          {/* Colophon */}
          <p style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 8, letterSpacing: '2px',
            textTransform: 'uppercase', color: 'rgba(244,236,221,0.16)',
            textAlign: 'center', margin: 0,
          }}>
            A Nightlife Company · Milano · Roma · Napoli
          </p>
        </div>

      </div>
    </>,
    document.body
  )
}
