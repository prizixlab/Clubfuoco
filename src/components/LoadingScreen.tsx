'use client'

import { useEffect, useState } from 'react'

// ─── Ember particles — golden sparks that drift upward ────────────────────────
// 8 particles spread across the screen width, staggered delays, varying sizes
const EMBERS = [
  { s: 2, left: '4%',  delay: 0.0,  dur: 5.5, col: 'rgb(255,199,128)' },
  { s: 3, left: '11%', delay: 0.31, dur: 5.0, col: 'rgb(255,224,168)' },
  { s: 2, left: '20%', delay: 0.62, dur: 6.0, col: 'rgb(232,182,91)'  },
  { s: 4, left: '31%', delay: 0.93, dur: 4.5, col: 'rgb(255,154,90)'  },
  { s: 2, left: '55%', delay: 1.40, dur: 5.8, col: 'rgb(255,199,128)' },
  { s: 3, left: '70%', delay: 0.70, dur: 5.2, col: 'rgb(232,182,91)'  },
  { s: 2, left: '82%', delay: 1.80, dur: 4.8, col: 'rgb(255,224,168)' },
  { s: 4, left: '93%', delay: 1.10, dur: 6.2, col: 'rgb(255,154,90)'  },
]

// ─── Keyframe CSS (injected once via <style>) ──────────────────────────────────
const STYLES = `
  @keyframes cf-glow {
    0%, 100% { opacity: 0.75; }
    50%       { opacity: 1;    }
  }
  @keyframes cf-ember {
    0%   { transform: translateY(0)       scale(1);   opacity: 0;   }
    8%   {                                            opacity: 1;   }
    85%  {                                            opacity: 0.7; }
    100% { transform: translateY(-110vh)  scale(0.5); opacity: 0;   }
  }
  @keyframes cf-fade-in {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes cf-dot {
    0%   { left: 0;                   }
    47%  { left: calc(100% - 8px);    }
    53%  { left: calc(100% - 8px);    }
    100% { left: 0;                   }
  }
  @keyframes cf-dot-glow {
    0%, 100% { box-shadow: rgba(255,200,120,0.6) 0 0 6px 1px;  }
    50%       { box-shadow: rgba(255,200,120,0.95) 0 0 12px 3px; }
  }
`

export default function LoadingScreen() {
  const [visible, setVisible] = useState(true)
  const [fading,  setFading]  = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true),   2200)
    const t2 = setTimeout(() => setVisible(false), 2800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (!visible) return null

  const exiting = fading

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ── Root overlay ───────────────────────────────────────────────────── */}
      <div
        aria-hidden={exiting}
        style={{
          position:  'fixed', inset: 0, zIndex: 9999,
          background: 'rgb(10, 6, 4)',
          overflow:  'hidden',
          display:   'flex', flexDirection: 'column',
          // Exit fade-out
          opacity:    exiting ? 0 : 1,
          transition: exiting ? 'opacity 600ms ease-in' : undefined,
          pointerEvents: exiting ? 'none' : undefined,
        }}
      >

        {/* ── Ambient glow (pulsing radial gradient) ──────────────────────── */}
        <div
          aria-hidden
          style={{
            position:   'absolute', inset: 0,
            pointerEvents: 'none',
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
            animation: 'cf-glow 6s ease-in-out infinite',
          }}
        />

        {/* ── Floating embers ─────────────────────────────────────────────── */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {EMBERS.map((e, i) => (
            <div
              key={i}
              style={{
                position:     'absolute',
                left:          e.left,
                bottom:        -10,
                width:         e.s,
                height:        e.s,
                borderRadius: '50%',
                background:    e.col,
                boxShadow:    'rgba(255,200,120,0.85) 0 0 6px 1px',
                animation:    `cf-ember ${e.dur}s ${e.delay}s ease-in infinite`,
              }}
            />
          ))}
        </div>

        {/* ── Corner label TL ─────────────────────────────────────────────── */}
        <div style={{
          position:  'absolute',
          top:       'max(52px, calc(env(safe-area-inset-top, 0px) + 18px))',
          left:       22,
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontSize:   9,
          letterSpacing: '2.34px',
          textTransform: 'uppercase',
          color:     'rgba(244,236,221,0.38)',
          animation: 'cf-fade-in 0.5s 0.05s ease-out both',
        }}>
          N° 00
        </div>

        {/* ── Corner label TR ─────────────────────────────────────────────── */}
        <div style={{
          position:  'absolute',
          top:       'max(52px, calc(env(safe-area-inset-top, 0px) + 18px))',
          right:      22,
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontSize:   9,
          letterSpacing: '2.34px',
          textTransform: 'uppercase',
          color:     'rgba(244,236,221,0.38)',
          animation: 'cf-fade-in 0.5s 0.12s ease-out both',
        }}>
          FUOCO · MMXXVI
        </div>

        {/* ── Centre block ────────────────────────────────────────────────── */}
        <div style={{
          flex:           1,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        '0 28px',
        }}>

          {/* Kicker: "N° 00 · APERTURA" */}
          <p style={{
            fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
            fontSize:       9.5,
            letterSpacing: '3.2px',
            textTransform: 'uppercase',
            color:         'rgba(244,236,221,0.38)',
            margin:        '0 0 10px',
            textAlign:     'center',
            animation:     'cf-fade-in 0.55s 0.18s ease-out both',
          }}>
            N° 00 · APERTURA
          </p>

          {/* CLUB FUOCO — hero title in italic serif */}
          <h1 style={{
            fontFamily:  '"Instrument Serif", Georgia, serif',
            fontSize:    'clamp(58px, 18vw, 80px)',
            fontStyle:   'italic',
            fontWeight:   400,
            color:       'rgb(244,236,221)',
            letterSpacing: '-0.5px',
            lineHeight:   0.92,
            margin:      '0 0 22px',
            textAlign:   'center',
            animation:   'cf-fade-in 0.65s 0.25s ease-out both',
          }}>
            {/* non-breaking space keeps it on one line */}
            CLUB&nbsp;FUOCO
          </h1>

          {/* Ornamental rule: ―― una serata curata ―― */}
          <div style={{
            display:    'flex',
            alignItems: 'center',
            gap:         10,
            width:      '100%',
            maxWidth:    290,
            margin:     '0 0 14px',
            animation:  'cf-fade-in 0.55s 0.34s ease-out both',
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,236,221,0.18)' }} />
            <span style={{
              fontFamily:  '"Instrument Serif", Georgia, serif',
              fontSize:     12,
              fontStyle:   'italic',
              color:       'rgba(244,236,221,0.4)',
              whiteSpace:  'nowrap',
            }}>
              una serata curata
            </span>
            <div style={{ flex: 1, height: 1, background: 'rgba(244,236,221,0.18)' }} />
          </div>

          {/* Tagline */}
          <p style={{
            fontFamily:  '"Instrument Serif", Georgia, serif',
            fontSize:     15,
            fontStyle:   'italic',
            color:       'rgba(244,236,221,0.5)',
            textAlign:   'center',
            margin:       0,
            animation:   'cf-fade-in 0.55s 0.42s ease-out both',
          }}>
            &ldquo;La notte ci appartiene.&rdquo;
          </p>
        </div>

        {/* ── Bottom: progress + labels ────────────────────────────────────── */}
        <div style={{
          padding:        '0 28px',
          paddingBottom:  'calc(36px + env(safe-area-inset-bottom, 0px))',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          gap:             14,
          animation:      'cf-fade-in 0.55s 0.52s ease-out both',
        }}>

          {/* Indeterminate progress rail + traveling dot */}
          <div style={{
            position:   'relative',
            width:      '100%',
            maxWidth:    320,
            height:      14,
            display:    'flex',
            alignItems: 'center',
          }}>
            {/* The rail */}
            <div style={{
              position:   'absolute',
              left:        0,
              right:       0,
              top:        '50%',
              height:      1,
              marginTop:  -0.5,
              background: 'rgba(244,236,221,0.15)',
            }} />
            {/* Traveling golden dot */}
            <div style={{
              position:     'absolute',
              top:          '50%',
              marginTop:    -4,
              width:         8,
              height:        8,
              borderRadius: '50%',
              background:   'rgb(232,182,91)',
              animation:    'cf-dot 2.4s ease-in-out infinite, cf-dot-glow 2.4s ease-in-out infinite',
            }} />
          </div>

          {/* "Curando la notte" */}
          <p style={{
            fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
            fontSize:       9,
            letterSpacing: '2.4px',
            textTransform: 'uppercase',
            color:         'rgba(244,236,221,0.28)',
            textAlign:     'center',
            margin:         0,
          }}>
            Curando la notte
          </p>

          {/* Colophon */}
          <p style={{
            fontFamily:    'var(--font-geist-mono), ui-monospace, monospace',
            fontSize:       8,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color:         'rgba(244,236,221,0.16)',
            textAlign:     'center',
            margin:         0,
          }}>
            A Nightlife Company · Milano · Roma · Napoli
          </p>
        </div>

      </div>
    </>
  )
}
