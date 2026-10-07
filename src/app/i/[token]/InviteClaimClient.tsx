'use client'

import { useEffect, useRef, useState } from 'react'

// Consumer app on the App Store (Club Fuoco, id 6770632084).
const APP_STORE_URL = 'https://apps.apple.com/app/id6770632084'

/** True when the page is loaded inside an embedded webview (Instagram,
 *  TikTok, FB Messenger, etc) — these don't honor Universal Links or custom
 *  schemes reliably, so we tell the user to open in Safari first. */
function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Instagram|FBAN|FBAV|Line|MicroMessenger|Snapchat|TikTok|Twitter|Pinterest/i.test(ua)
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** Hand the invite across the App Store gap.
 *
 *  A Universal Link only works if the app is already installed, so someone
 *  installing from here cold-launches with no idea what they came for. Apple
 *  offers nothing for this, so we use two channels and let the app take
 *  whichever arrives:
 *
 *  1. CLIPBOARD — deterministic. The app checks the pasteboard on first launch
 *     with detectPatterns (which does NOT prompt) and only reads it if a URL is
 *     there. An https:// URL rather than clubfuoco:// because that is what
 *     detectPatterns recognises as a URL.
 *  2. SERVER TICKET — probabilistic, silent, and the fallback when the user
 *     copies something else in between. See src/lib/invite-handoff.ts.
 *
 *  Both are best-effort by construction. Neither is awaited long enough to
 *  delay the App Store, because a guest staring at a dead button is a worse
 *  failure than a lost handoff — they still have the link in their messages.
 */
async function handoff(token: string) {
  const url = `https://clubfuoco.com/i/${token}`
  try {
    await navigator.clipboard?.writeText(url)
  } catch {
    // Denied, or no secure context. The server ticket is the whole point.
  }
  try {
    await fetch('/api/invite-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,          // survives the navigation to the App Store
    })
  } catch {
    // Offline or blocked — fall through, the link still exists in their chat.
  }
}

/** Run the handoff, then go to the App Store.
 *
 *  The 150ms is for the clipboard write, not the fetch — that carries
 *  `keepalive` and survives the navigation on its own. Short enough that nobody
 *  perceives a stalled button.
 */
async function goToStore(token: string) {
  const done = handoff(token)
  await Promise.race([done, new Promise(r => setTimeout(r, 150))])
  window.location.href = APP_STORE_URL
}

/** Explicit "Open in app": attempt the deep link, and if we're still visible
 *  after `timeoutMs` (app not installed), fall back to the App Store. */
function openInAppOrStore(token: string, timeoutMs = 1500) {
  const start = Date.now()
  const onHide = () => clearTimeout(t)
  document.addEventListener('visibilitychange', onHide, { once: true })
  const t = setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (Date.now() - start < timeoutMs + 500 && !document.hidden) {
      void goToStore(token)
    }
  }, timeoutMs)
  window.location.href = `clubfuoco://i/${token}`
}

type Night = {
  id: string
  title: string | null
  night_date: string
  open_time: string | null
  close_time: string | null
  location_name: string | null
  address: string | null
  description: string | null
  theme: string | null
  photo_urls: string[] | null
  max_plus_ones: number | null
  club: { id: string; name: string; address: string | null; cover_image_url: string | null } | null
}

/** Venue label: partner club name, else the custom location name. */
function venueName(n: Night): string {
  return n.club?.name ?? n.location_name ?? 'Location TBA'
}

type Allocation = {
  id: string
  spots: number
  groupVisible: boolean
}

type Guest = { id: string; full_name: string; plus_ones: number }

export default function InviteClaimClient({
  token,
  allocation,
  night,
  promoterName,
  initialGuests,
}: {
  token: string
  allocation: Allocation
  night: Night
  promoterName: string | null
  initialGuests: Guest[]
  // prefillName is no longer used (web signup retired) but kept in the prop
  // shape so page.tsx needs no change.
  prefillName?: string | null
}) {
  const [inWebview, setInWebview] = useState(false)
  const [iOS, setIOS] = useState(false)
  // Back from Stripe Checkout (app builds ≤1.13 pay there, in Safari).
  const [returned, setReturned] = useState<{ paid: boolean; guest: string | null } | null>(null)
  const autoTried = useRef(false)

  useEffect(() => {
    const webview = isInAppBrowser()
    const ios = isIOS()
    setInWebview(webview)
    setIOS(ios)
    const q = new URLSearchParams(window.location.search)
    if (q.get('paid') === '1' || q.get('cancelled') === '1') {
      // Never bounce a buyer to the App Store — they came from the app and
      // need to get back to it. See the return card below.
      setReturned({ paid: q.get('paid') === '1', guest: q.get('guest') })
      return
    }
    // No prompts. With the app installed, iOS opens a tapped
    // https://clubfuoco.com/i/… link straight in the app (Universal Link) and
    // this page never loads. So an iPhone that DOES reach this page either has
    // no app or is inside a webview that ignores Universal Links (Instagram,
    // TikTok…) — both go straight to the App Store, with the handoff so the
    // app opens on this event after installing. The old automatic
    // clubfuoco:// attempt is gone: Safari answered it with "Open in Club
    // Fuoco?" or, without the app, an "address is invalid" alert.
    if (ios && !autoTried.current) {
      autoTried.current = true
      void goToStore(token)
    }
  }, [token])

  const guests = initialGuests
  const totalUsed = guests.reduce((s, g) => s + 1 + g.plus_ones, 0)

  // Back from Checkout. Stripe returns to this page on clubfuoco.vercel.app
  // (see the checkout route), so the button below links to ANOTHER domain —
  // clubfuoco.com, the one in the app's associated domains — and a tap on it
  // opens the app directly, no "Open in…?" prompt, carrying ?paid=1&guest=
  // which lands the app on the ticket. A link to the page's own domain would
  // just reload it: iOS never opens a Universal Link for the domain you're on.
  if (returned) {
    const back = returned.paid && returned.guest
      ? `https://clubfuoco.com/i/${token}?paid=1&guest=${encodeURIComponent(returned.guest)}`
      : `https://clubfuoco.com/i/${token}`
    return (
      <div style={{ minHeight: '100vh', background: '#0A0807', color: '#F4ECDD', fontFamily: 'var(--font-geist-sans, system-ui)', padding: '64px 24px' }}>
        <Kicker>{returned.paid ? 'Payment received' : 'Payment cancelled'}</Kicker>
        <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontWeight: 400, fontSize: 34, lineHeight: 1.1, margin: '6px 0 12px' }}>
          {returned.paid ? 'You’re in.' : 'Nothing was charged.'}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(244,236,221,0.75)', margin: '0 0 28px' }}>
          {returned.paid
            ? `${night.title ?? 'Your night'} — your ticket and door QR are in the Club Fuoco app.`
            : 'Your spot isn’t held. Head back to the app to try again or save it for later.'}
        </p>
        <a href={back} style={primaryBtn}>{returned.paid ? 'Open your ticket' : 'Back to the app'}</a>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0807', color: '#F4ECDD', fontFamily: 'var(--font-geist-sans, system-ui)' }}>
      {/* Hero */}
      <div style={{ padding: '28px 24px 8px' }}>
        <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 12, color: '#E8B65B', letterSpacing: 2, textTransform: 'uppercase' }}>
          {promoterName ? `${promoterName} invited you` : 'You\'re invited'}
        </div>
        <h1 style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 44, lineHeight: 1.05, margin: '6px 0 0' }}>
          {night.title ?? venueName(night)}
        </h1>
        <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(244,236,221,0.70)' }}>
          {venueName(night)} · {formatDate(night.night_date)}
          {night.open_time && ` · ${shortTime(night.open_time)}`}
          {night.close_time && ` – ${shortTime(night.close_time)}`}
        </div>
        {night.theme && (
          <div style={{
            display: 'inline-block', marginTop: 12, padding: '6px 12px', borderRadius: 999,
            background: 'rgba(232,182,91,0.12)', color: '#E8B65B',
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            letterSpacing: 1.5, textTransform: 'uppercase',
          }}>
            {night.theme}
          </div>
        )}
        {night.description && (
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.5, color: 'rgba(244,236,221,0.80)' }}>
            {night.description}
          </p>
        )}
      </div>

      {/* Event photos */}
      {night.photo_urls && night.photo_urls.length > 0 && (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 24px 0' }}>
          {night.photo_urls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" style={{
              width: night.photo_urls!.length === 1 ? '100%' : 220,
              height: 240, objectFit: 'cover', borderRadius: 16, flexShrink: 0,
            }} />
          ))}
        </div>
      )}

      {/* Get-into-the-app card — the only path to RSVP now */}
      <div style={{ padding: 24 }}>
        <div style={{
          background: '#15110E', border: '1px solid rgba(244,236,221,0.10)',
          borderRadius: 18, padding: 20,
        }}>
          <Kicker>RSVP in the Club Fuoco app</Kicker>

          {inWebview ? (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(244,236,221,0.80)', margin: '0 0 16px' }}>
                Tap the <strong>⋯</strong> menu and choose <strong>Open in Safari</strong> to
                continue — then reserve your spot in the app.
              </p>
              {/* The handoff matters MOST here. Instagram's webview honours
                  neither Universal Links nor custom schemes, so this is the one
                  path with no way back into the app on its own. Its clipboard
                  is usually blocked, but the server ticket carries the same IP
                  as the install that follows. */}
              <button onClick={() => void goToStore(token)} style={{ ...primaryBtn, border: 'none', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Get the app
              </button>
            </>
          ) : iOS ? (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(244,236,221,0.80)', margin: '0 0 16px' }}>
                Reserve your spot, get your door QR, and add it to Apple Wallet — all in the app.
              </p>
              <button onClick={() => openInAppOrStore(token)} style={{ ...primaryBtn, border: 0, cursor: 'pointer' }}>
                Open in app
              </button>
              <button onClick={() => void goToStore(token)} style={{ ...secondaryBtn, border: 'none', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Don&rsquo;t have it? Get the app
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(244,236,221,0.80)', margin: '0 0 16px' }}>
                Club Fuoco is an iPhone app. Open this invite on your iPhone, or download it
                from the App Store to reserve your spot.
              </p>
              <button onClick={() => void goToStore(token)} style={{ ...primaryBtn, border: 'none', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Get it on the App Store
              </button>
            </>
          )}
        </div>

        {/* Guestlist if visible — read-only social proof */}
        {allocation.groupVisible && (
          <div style={{ marginTop: 28 }}>
            <Kicker>Who&rsquo;s coming ({totalUsed})</Kicker>
            <div style={{ marginTop: 8 }}>
              {guests.length === 0 ? (
                <div style={{ fontSize: 13, color: 'rgba(244,236,221,0.60)' }}>
                  Be the first on the list.
                </div>
              ) : (
                guests.map((g) => (
                  <div key={g.id} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '14px 0', borderBottom: '1px solid rgba(244,236,221,0.08)',
                  }}>
                    <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 18 }}>{g.full_name}</div>
                    {g.plus_ones > 0 && (
                      <div style={{ fontSize: 12, color: 'rgba(244,236,221,0.60)' }}>+{g.plus_ones}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, letterSpacing: 2,
    color: '#E8B65B', textTransform: 'uppercase', marginBottom: 6,
  }}>{children}</div>
)

const primaryBtn: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center',
  padding: '14px', borderRadius: 999, background: '#C2562D',
  color: '#FFF6E5', fontWeight: 600, fontSize: 15, textDecoration: 'none',
}

const secondaryBtn: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center',
  marginTop: 10, padding: '12px', borderRadius: 999, background: 'transparent',
  color: 'rgba(244,236,221,0.70)', fontWeight: 500, fontSize: 13, textDecoration: 'none',
}

function formatDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
}
function shortTime(t: string): string {
  // "22:00:00" → "22:00"
  return t.slice(0, 5)
}
