'use client'

import '../_web/site.css'
import '../_web/partners.css'
import SiteNav    from '../_web/SiteNav'
import MiniFooter from '../_web/MiniFooter'
import { useState } from 'react'

export default function PartnersPage() {
  if (process.env.BUILD_TARGET === 'ios') return null
  return <PartnersClient />
}

function PartnersClient() {
  const [aud, setAud]       = useState<'venues' | 'ticketing' | 'operators'>('venues')
  const [sending, setSending] = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSending(true)
    setMsg(null)
    const fd   = new FormData(e.currentTarget)
    const body = {
      company:  String(fd.get('company') ?? ''),
      contact:  String(fd.get('contact') ?? ''),
      role:     String(fd.get('role') ?? ''),
      message:  String(fd.get('message') ?? ''),
      audience: aud,
    }
    try {
      const res = await fetch('/api/partnership-inquiries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      setMsg('Thanks — we&rsquo;ll be in touch within two working days.')
      ;(e.target as HTMLFormElement).reset()
    } catch {
      setMsg('Couldn&rsquo;t send — please email partners@clubfuoco.com directly.')
    } finally {
      setSending(false)
    }
  }

  const PANELS = {
    venues: {
      title: 'For venues',
      lead:  'Fill the right rooms on the right nights. Club Fuoco puts your capacity in front of a curated, high-intent local audience — and confirms entry before they leave home.',
      bullets: [
        'List rooms, tables, and guest lists in real time',
        'Cut no-shows with paid, confirmed bookings',
        'Keep your door — we clear guests, you run the night',
      ],
    },
    ticketing: {
      title: 'For ticketing platforms',
      lead:  'Bring your event inventory into a discovery surface built for Barcelona nightlife. We handle curation and demand; you keep fulfilment and your existing flow.',
      bullets: [
        'Distribute events to a focused local audience',
        'Simple integration with your current inventory',
        'Co-branded entry, transparent settlement',
      ],
    },
    operators: {
      title: 'For operators',
      lead:  'Promoters and table operators who own these nights: manage guest lists and VIP tables in one place, and reach guests who actually show.',
      bullets: [
        'Run guest lists and tables across multiple venues',
        'Direct line to high-value, repeat guests',
        'Settlement and reporting in one dashboard',
      ],
    },
  } as const

  const panel = PANELS[aud]

  return (
    <div className="cf-site">
      <div className="grain" aria-hidden="true" />
      <SiteNav active="partners" />

      <header className="page-hero">
        <div className="page-glow" aria-hidden="true" />
        <p className="eyebrow">For Partners</p>
        <h1>Partner with <span className="gold">Club Fuoco.</span></h1>
        <p className="lead">
          If you run a room, sell tickets, or move people through Barcelona&rsquo;s
          best nights, let&rsquo;s put your inventory where the city is already
          looking.
        </p>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="partner-layout">
            <div className="tabs">
              <div className="tab-labels" role="tablist">
                {(['venues','ticketing','operators'] as const).map(k => (
                  <label
                    key={k}
                    role="tab"
                    aria-selected={aud === k}
                    className={aud === k ? 'active' : ''}
                    onClick={() => setAud(k)}
                    style={{ cursor: 'pointer' }}
                  >
                    {k === 'venues' ? 'Venues' : k === 'ticketing' ? 'Ticketing platforms' : 'Operators'}
                  </label>
                ))}
              </div>

              <div className="tab-bodies">
                <div className="tab-panel" style={{ display: 'block' }}>
                  <h3>{panel.title}</h3>
                  <p>{panel.lead}</p>
                  <ul>
                    {panel.bullets.map(b => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              </div>
            </div>

            <form className="form-card" onSubmit={onSubmit} autoComplete="off">
              <h2>Get in touch</h2>
              <p className="sub">
                Tell us a little about you and we&rsquo;ll be in contact within two working days.
              </p>
              <div className="field">
                <label htmlFor="company">Company / venue</label>
                <input type="text" id="company" name="company" placeholder="e.g. Sala Apolo" required />
              </div>
              <div className="field">
                <label htmlFor="contact">Your name &amp; email</label>
                <input type="text" id="contact" name="contact" placeholder="Name · you@company.com" required />
              </div>
              <div className="field">
                <label htmlFor="role">I&rsquo;m reaching out as a…</label>
                <select id="role" name="role" defaultValue="Venue">
                  <option>Venue</option>
                  <option>Ticketing platform</option>
                  <option>Operator / promoter</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="message">Message</label>
                <textarea id="message" name="message" placeholder="What would you like to do with Club Fuoco?" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={sending}>
                {sending ? 'Sending…' : 'Send message →'}
              </button>
              {msg && <p className="error-msg" style={{ marginTop: 12 }}>{msg}</p>}
            </form>
          </div>
        </div>
      </section>

      <MiniFooter />
    </div>
  )
}
