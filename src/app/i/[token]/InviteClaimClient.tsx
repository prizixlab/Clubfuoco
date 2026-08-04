'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const APP_STORE_URL = 'https://apps.apple.com/app/club-fuoco/id0000000000'

/** True when the page is loaded inside an embedded webview (Instagram,
 *  TikTok, FB Messenger, etc) — these don't honor Universal Links. */
function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Instagram|FBAN|FBAV|Line|MicroMessenger|Snapchat|TikTok|Twitter|Pinterest/i.test(ua)
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** Try to deep-link into the native app via the custom URL scheme. If we're
 *  still visible after `timeoutMs`, assume the app isn't installed and fall
 *  back to the App Store. */
function openInApp(token: string, timeoutMs = 1800) {
  const start = Date.now()
  const onHide = () => clearTimeout(t)
  document.addEventListener('visibilitychange', onHide, { once: true })
  const t = setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (Date.now() - start < timeoutMs + 500 && !document.hidden) {
      window.location.href = APP_STORE_URL
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
  prefillName,
}: {
  token: string
  allocation: Allocation
  night: Night
  promoterName: string | null
  initialGuests: Guest[]
  prefillName?: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState(prefillName ?? '')
  const [inWebview, setInWebview] = useState(false)
  const [iOS, setIOS] = useState(false)
  useEffect(() => { setInWebview(isInAppBrowser()); setIOS(isIOS()) }, [])
  const [plusOnes, setPlusOnes] = useState(0)
  // Auto check-in consent. Opt-in by default, but always sent as an explicit
  // boolean so an unchecked box records a genuine decline (false), not null.
  const [locationConsent, setLocationConsent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<{ guestId: string; name: string } | null>(null)
  const [guests, setGuests] = useState<Guest[]>(initialGuests)

  const totalUsed = guests.reduce((s, g) => s + 1 + g.plus_ones, 0)
  const unlimited = allocation.spots >= 100000
  const slotsLeft = Math.max(0, allocation.spots - totalUsed)

  async function claim() {
    if (!name.trim()) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/promoter-invites/${token}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name.trim(), plus_ones: plusOnes, location_consent: locationConsent }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Couldn\'t join the list')
      const newGuest = json.data?.guest ?? json.guest
      setClaimed({ guestId: newGuest.id, name: name.trim() })
      if (allocation.groupVisible) {
        setGuests([...guests, { id: newGuest.id, full_name: name.trim(), plus_ones: plusOnes }])
      }
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0807', color: '#F4ECDD', fontFamily: 'var(--font-geist-sans, system-ui)' }}>
      {/* "Open in app" banner — context-aware */}
      {iOS && (
        <div style={{
          padding: '12px 20px', background: '#15110E', borderBottom: '1px solid rgba(244,236,221,0.10)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>
              {inWebview ? 'For auto check-in, open in the Fuoco app' : 'Open in the Club Fuoco app'}
            </div>
            <div style={{ color: 'rgba(244,236,221,0.60)', fontSize: 11 }}>
              {inWebview
                ? 'Geofence check-in + name pre-filled. Tap ⋯ → Open in Safari first.'
                : 'Live updates, easier ticket access, Apple Wallet.'}
            </div>
          </div>
          <button
            onClick={() => openInApp(token)}
            style={{
              padding: '8px 14px', borderRadius: 999, background: '#C2562D',
              color: '#FFF6E5', fontSize: 12, fontWeight: 600, border: 0, cursor: 'pointer',
            }}>
            Open in app
          </button>
        </div>
      )}

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

      {/* Ticket OR form */}
      <div style={{ padding: 24 }}>
        {claimed ? (
          <TicketView guestId={claimed.guestId} name={claimed.name} night={night} />
        ) : (
          <div style={{
            background: '#15110E', border: '1px solid rgba(244,236,221,0.10)',
            borderRadius: 18, padding: 20,
          }}>
            <Kicker>Reserve your spot</Kicker>
            <div style={{ fontSize: 12, color: 'rgba(244,236,221,0.60)', marginBottom: 16 }}>
              {unlimited ? `${totalUsed} on the list` : `${slotsLeft} of ${allocation.spots} spots left`}
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <Kicker>Full name</Kicker>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name as it should appear at the door"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <Kicker>Plus ones</Kicker>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <button onClick={() => setPlusOnes(Math.max(0, plusOnes - 1))}
                  style={pillBtn}>−</button>
                <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 22, minWidth: 30, textAlign: 'center' }}>{plusOnes}</div>
                <button onClick={() => setPlusOnes(Math.min(night.max_plus_ones ?? 20, plusOnes + 1))}
                  style={pillBtnEmber}>+</button>
              </div>
            </label>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18,
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={locationConsent}
                onChange={(e) => setLocationConsent(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, accentColor: '#C2562D', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, lineHeight: 1.4, color: 'rgba(244,236,221,0.80)' }}>
                Share my location for automatic check-in at the door
                <span style={{ display: 'block', fontSize: 11, color: 'rgba(244,236,221,0.50)' }}>
                  Optional. You can still check in manually.
                </span>
              </span>
            </label>

            {error && <div style={{ color: '#E8866B', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <button
              onClick={claim}
              disabled={submitting || !name.trim() || slotsLeft <= 0}
              style={{
                width: '100%', padding: '14px', borderRadius: 999,
                background: slotsLeft <= 0 ? 'rgba(244,236,221,0.10)' : '#C2562D',
                color: '#FFF6E5', fontWeight: 600, fontSize: 15, border: 0,
                cursor: submitting ? 'wait' : 'pointer',
                opacity: submitting || !name.trim() || slotsLeft <= 0 ? 0.5 : 1,
              }}>
              {slotsLeft <= 0 ? 'Sold out' : submitting ? 'Joining…' : 'Add me to the list'}
            </button>
          </div>
        )}

        {/* Guestlist if visible */}
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

function TicketView({ guestId, name, night }: { guestId: string; name: string; night: Night }) {
  return (
    <div style={{
      background: '#15110E', border: '1px solid rgba(244,236,221,0.10)',
      borderRadius: 18, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 11, color: '#E8B65B', letterSpacing: 2, textTransform: 'uppercase' }}>
        You&rsquo;re on the list
      </div>
      <div style={{ fontFamily: 'var(--font-instrument-serif, Georgia, serif)', fontSize: 32, margin: '12px 0 6px' }}>
        {name}
      </div>
      <div style={{ fontSize: 13, color: 'rgba(244,236,221,0.70)' }}>
        {night.title ?? venueName(night)} · {formatDate(night.night_date)}
      </div>

      <div style={{ margin: '28px auto 16px', width: 220, height: 220, padding: 12, background: '#FFF6E5', borderRadius: 16 }}>
        <img
          alt="QR code"
          src={`/api/promoter-invites/guest/${guestId}/qr.svg`}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div style={{ fontSize: 11, color: 'rgba(244,236,221,0.50)', marginBottom: 18, letterSpacing: 1 }}>
        SHOW THIS AT THE DOOR
      </div>

      <a href={`/api/promoter-invites/guest/${guestId}/wallet`}
         style={{
           display: 'inline-block', padding: '12px 24px', borderRadius: 999,
           background: '#000', color: '#fff', fontWeight: 600, fontSize: 14,
           textDecoration: 'none',
         }}>
        Add to Apple Wallet
      </a>
    </div>
  )
}

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10, letterSpacing: 2,
    color: '#E8B65B', textTransform: 'uppercase', marginBottom: 6,
  }}>{children}</div>
)

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 0,
  borderBottom: '1px solid rgba(244,236,221,0.20)', padding: '10px 0',
  fontSize: 16, color: '#F4ECDD', outline: 'none', marginTop: 6,
}

const pillBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: '50%',
  background: 'transparent', color: '#F4ECDD',
  border: '1px solid rgba(244,236,221,0.30)',
  fontSize: 18, cursor: 'pointer',
}

const pillBtnEmber: React.CSSProperties = {
  ...pillBtn,
  background: '#C2562D', color: '#FFF6E5', border: 0,
}

function formatDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
}
function shortTime(t: string): string {
  // "22:00:00" → "22:00"
  return t.slice(0, 5)
}
