'use client'

import { useRouter } from 'next/navigation'

/* ─── Shared renderer for legal documents (Terms, Privacy) ─────────────────── */

export interface LegalSection {
  heading: string
  /** Each entry is a paragraph; a string starting with "• " renders as a bullet. */
  body: string[]
}

const SERIF = '"Instrument Serif", Georgia, serif'
const MONO  = 'ui-monospace, monospace'
const SANS  = 'Inter, sans-serif'

export default function LegalDoc({
  kicker, title, updated, intro, sections,
}: {
  kicker:   string
  title:    string
  updated:  string
  intro:    string
  sections: LegalSection[]
}) {
  const router = useRouter()

  return (
    <div style={{ background: '#F8F5EE', minHeight: '100vh' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 20px 80px' }}>

        {/* Back */}
        <button
          onClick={() => router.back()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, marginBottom: 24,
            fontFamily: MONO, fontSize: 10, letterSpacing: '1.8px',
            textTransform: 'uppercase', color: '#6E6356',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        {/* Header */}
        <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.9px', textTransform: 'uppercase', color: '#8C2A2A', margin: '0 0 10px' }}>
          {kicker}
        </p>
        <h1 style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.9px', color: '#221E1A', margin: '0 0 10px' }}>
          {title}
        </h1>
        <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#9F9486', margin: '0 0 20px' }}>
          Last updated · {updated}
        </p>
        <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.6, color: '#6E6356', margin: '0 0 8px' }}>
          {intro}
        </p>

        {/* Sections */}
        {sections.map((s, i) => (
          <section key={s.heading} style={{ marginTop: 28 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: '#221E1A', margin: '0 0 10px' }}>
              {String(i + 1).padStart(2, '0')} · {s.heading}
            </h2>
            {s.body.map((para, j) =>
              para.startsWith('• ') ? (
                <p key={j} style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: '#3E392F', margin: '0 0 6px', paddingLeft: 14 }}>
                  <span style={{ color: '#8C2A2A', marginLeft: -14, marginRight: 6 }}>—</span>
                  {para.slice(2)}
                </p>
              ) : (
                <p key={j} style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.65, color: '#3E392F', margin: '0 0 10px' }}>
                  {para}
                </p>
              ),
            )}
          </section>
        ))}

        {/* Footer */}
        <div style={{ borderTop: '1px solid rgba(34,30,26,0.1)', marginTop: 36, paddingTop: 14 }}>
          <p style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '1.9px', textTransform: 'uppercase', color: '#9F9486', margin: 0 }}>
            Club Fuoco · A Nightlife Company · Barcelona
          </p>
        </div>
      </div>
    </div>
  )
}
