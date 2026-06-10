'use client'

import './site.css'
import SiteNav    from './SiteNav'
import MiniFooter from './MiniFooter'
import { useState } from 'react'
import Script from 'next/script'

// Shared layout for the three /partners/<audience> pages. Each sub-page just
// passes its own content (eyebrow, headline, deals, steps, pull-quote) — the
// breadcrumb, hero shape, form, and footer are identical across all three.

export interface PartnerSubpageProps {
  eyebrow:    string          // e.g. "For Venues"
  headline:   React.ReactNode // serif italic gold headline (can include <span>)
  lede:       string
  deal:       Array<{ title: string; body: string }>      // exactly 3
  howItWorks: Array<{ title: string; body: string }>      // exactly 3
  pullQuote:  string
  audience:   'Venue' | 'Ticketing platform' | 'Operator / promoter'
}

export default function PartnerSubpage({
  eyebrow, headline, lede, deal, howItWorks, pullQuote, audience,
}: PartnerSubpageProps) {
  const [sending, setSending] = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSending(true)
    setMsg(null)
    const fd = new FormData(e.currentTarget)
    const body = {
      company:  String(fd.get('company') ?? ''),
      contact:  String(fd.get('contact') ?? ''),
      message:  String(fd.get('message') ?? ''),
      audience,
    }
    try {
      const res = await fetch('/api/partnership-inquiries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      setMsg('Thanks — we’ll be in touch within two working days.')
      ;(e.target as HTMLFormElement).reset()
    } catch {
      setMsg('Couldn’t send — please email partners@clubfuoco.com directly.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="cf-site">
      <div className="ambient-light" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <SiteNav active="partners" />

      <div className="wrap">
        <p className="breadcrumb">
          <a href="/partners">For Partners</a>
          <span className="sep">→</span>
          <span className="here">{eyebrow}</span>
        </p>
      </div>

      <header className="page-hero left" style={{ paddingTop: 'clamp(36px, 6vh, 64px)' }}>
        <div className="page-glow" aria-hidden="true" />
        <div className="wrap">
          <p className="eyebrow">{eyebrow}</p>
          <h1><span className="gold">{headline}</span></h1>
          <p className="lead">{lede}</p>
          <span className="scroll-cue" aria-hidden="true">↓</span>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What you get</span>
            <h2 className="serif-title">The deal, plainly.</h2>
          </div>
          <div className="num-cols">
            {deal.map((d, i) => (
              <div className="num-col" key={d.title}>
                <div className="n">{String(i + 1).padStart(2, '0')}</div>
                <div className="col-body">
                  <h3>{d.title}</h3>
                  <p>{d.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="serif-title">
              Three steps. <span className="gold">That&rsquo;s it.</span>
            </h2>
          </div>
          <div className="num-cols">
            {howItWorks.map((s, i) => (
              <div className="num-col" key={s.title}>
                <div className="n">{String(i + 1).padStart(2, '0')}</div>
                <div className="col-body">
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="pq">
            <blockquote>
              <span className="q">&ldquo;</span>{pullQuote}<span className="q">&rdquo;</span>
            </blockquote>
            <div className="attr">
              <div className="role">Club Fuoco — Barcelona</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <form className="form-card" onSubmit={onSubmit} autoComplete="off">
            <h2>Get in touch</h2>
            <p className="sub">
              Tell us a little about you and we&rsquo;ll be in contact within two working days.
            </p>
            <input type="hidden" name="audience" value={audience} />
            <div className="field">
              <label htmlFor="company">Company / venue name</label>
              <input type="text" id="company" name="company" placeholder="e.g. Sala Apolo" required />
            </div>
            <div className="field">
              <label htmlFor="contact">Your name &amp; email</label>
              <input type="text" id="contact" name="contact" placeholder="Name · you@company.com" required />
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
      </section>

      <MiniFooter />
      <Script src="/motion.js" strategy="afterInteractive" />
    </div>
  )
}
