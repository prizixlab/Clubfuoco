'use client'
import { apiFetch } from '@/lib/api'
import '../jamboree.css'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PaymentForm } from '@/components/ui/PaymentForm'
import type { GroupDetail, FriendUser } from '@/types'

const WEB_BASE = 'https://clubfuoco.com'

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtShort(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const IcBack = <svg width={19} height={19} viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
const IcShare = <svg width={18} height={18} viewBox="0 0 20 20" fill="none"><path d="M10 13V3M10 3L6.5 6.5M10 3l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 12v3.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
const IcCheck = <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-6.5" stroke="#FBF4E9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
const IcPlus = <svg width={17} height={17} viewBox="0 0 18 18" fill="none"><path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>

export default function GroupClient() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  // Capacitor static export navigates to /groups/placeholder?id=REAL_UUID, so the
  // real id is in the query string; fall back to the route param on the web.
  const id = searchParams.get('id') ?? params.id
  const router = useRouter()
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/groups/${id}`)
      const d = await r.json()
      if (r.ok) setGroup(d.data)
      else setError(d.error ?? 'Group not found')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const me = group?.me ?? null
  const isOrganizer = me?.role === 'organizer'

  // Invite friends (organizer)
  const [friends, setFriends] = useState<FriendUser[]>([])
  const [inviteSel, setInviteSel] = useState<Set<string>>(new Set())
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    if (!isOrganizer) return
    apiFetch('/api/friends')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setFriends(d.data.friends ?? []) })
      .catch(() => {})
  }, [isOrganizer])

  const memberIds = new Set(group?.members.map(m => m.user_id) ?? [])
  const invitable = friends.filter(f => !memberIds.has(f.id))

  async function invite() {
    if (!inviteSel.size) return
    setInviting(true); setError('')
    try {
      const r = await apiFetch(`/api/groups/${id}/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [...inviteSel] }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? 'Could not invite') }
      setInviteSel(new Set())
      await load()
    } catch (e: any) { setError(e.message) } finally { setInviting(false) }
  }

  // What I owe: my resolved charge if I'm a member, else the club default (link-join).
  const myCharge = me ? me.charge : (group?.unit_price ?? 0)
  const fee = `€${myCharge.toFixed(2)}`

  // Organizer "who pays how much" editor
  const [editing, setEditing] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [savingAlloc, setSavingAlloc] = useState(false)

  function startEditing() {
    if (!group) return
    const seed: Record<string, string> = {}
    for (const m of group.members) seed[m.id] = String(m.charge ?? 0)
    setAmounts(seed)
    setEditing(true)
  }

  async function saveAllocations() {
    if (!group) return
    setSavingAlloc(true); setError('')
    try {
      const allocations = group.members
        .filter(m => !m.paid)
        .map(m => ({ member_id: m.id, amount_due: Math.max(0, parseFloat(amounts[m.id] ?? '0') || 0) }))
      const r = await apiFetch(`/api/groups/${id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? 'Could not save') }
      setEditing(false)
      await load()
    } catch (e: any) { setError(e.message) } finally { setSavingAlloc(false) }
  }

  async function join(paymentMethodId?: string) {
    setBusy(true); setError('')
    try {
      const r = await apiFetch(`/api/groups/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not join')
      await load()
    } catch (e: any) {
      setError(e.message); throw e
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    setBusy(true); setError('')
    try {
      await apiFetch(`/api/groups/${id}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline' }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function setMaybe() {
    setBusy(true); setError('')
    try {
      await apiFetch(`/api/groups/${id}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'maybe' }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function cancelNight() {
    if (typeof window !== 'undefined' && !window.confirm('Call off this night for everyone?')) return
    setBusy(true); setError('')
    try {
      const r = await apiFetch(`/api/groups/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error ?? 'Could not cancel') }
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const [remindMsg, setRemindMsg] = useState('')
  async function remind() {
    setBusy(true); setError('')
    try {
      const r = await apiFetch(`/api/groups/${id}/remind`, { method: 'POST' })
      const d = await r.json()
      if (r.ok) { setRemindMsg(d.data.reminded > 0 ? `Reminded ${d.data.reminded}` : 'Everyone responded'); setTimeout(() => setRemindMsg(''), 2500) }
    } finally { setBusy(false) }
  }

  async function share() {
    if (!group) return
    const url = `${WEB_BASE}/groups/join?code=${group.invite_code}`
    const text = `Come out to ${group.club_name} on ${fmtDate(group.booking_date)} — join my group on Club Fuoco`
    try {
      if (navigator.share) { await navigator.share({ title: 'Club Fuoco', text, url }); return }
    } catch { /* user cancelled — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="cf-jb">
      <div style={{ paddingBottom: 130 }}>
        {loading && <p style={{ textAlign: 'center', padding: '90px 0', color: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }}>Loading…</p>}
        {!loading && !group && <p style={{ textAlign: 'center', padding: '90px 20px', color: 'var(--accent)', fontFamily: 'var(--font-ui)' }}>{error || 'Group not found'}</p>}

        {group && (() => {
          const going = group.members.filter(m => m.rsvp === 'going').length
          const maybe = group.members.filter(m => m.rsvp === 'maybe').length
          const invited = group.members.filter(m => m.rsvp === 'invited').length
          const organizer = group.members.find(m => m.role === 'organizer')
          const others = Math.max(0, group.members.length - 1)
          const goingMe = me?.rsvp === 'going'
          const mustPay = !me || (me.charge > 0 && !me.paid)
          return (
            <>
              {/* header */}
              <div className="jb-header">
                <button className="jb-iconbtn jb-iconbtn--ghost" aria-label="Back" onClick={() => router.back()}>{IcBack}</button>
                <div className="jb-wordmark">Club Fuoco</div>
                <button className="jb-iconbtn" aria-label="Share" onClick={share}>{IcShare}</button>
              </div>

              {/* hero */}
              <div className="jb-hero">
                <div className="jb-hero__riso" />
                {group.club_image && <img className="jb-hero__img" src={group.club_image} alt={group.club_name} />}
                <div className="jb-hero__shade" />
                <div className="jb-hero__body">
                  <span className="jb-tag">{group.booking_type === 'vip' ? 'VIP Table' : 'Entry · Guestlist'}</span>
                  <h1 className="jb-hero__title">{group.club_name}</h1>
                  <div className="jb-hero__meta">
                    <span>{fmtShort(group.booking_date)}</span><span className="dot" /><span>{group.club_name}</span>
                  </div>
                </div>
              </div>

              {/* sheet */}
              <div className="jb-sheet">
                {/* group strip */}
                <div className="jb-group">
                  <div className="jb-avs">
                    <div className="jb-av">{(organizer?.full_name ?? 'G').slice(0, 1).toUpperCase()}</div>
                    {others > 0 && <div className="jb-av jb-av--ghost">+{others}</div>}
                  </div>
                  <div className="jb-group__txt">
                    <div className="jb-group__name">{organizer?.is_me ? 'Your group' : `${group.organizer_name ?? 'Group'}'s group`}</div>
                    <div className="jb-group__sub">
                      <b>{going} going</b>{maybe > 0 ? ` · ${maybe} maybe` : ''}{invited > 0 ? ` · ${invited} invited` : ''} · {isOrganizer ? 'Hosted by you' : `Hosted by ${group.organizer_name ?? '—'}`}
                    </div>
                  </div>
                </div>

                {/* facts */}
                <div className="jb-facts">
                  <div className="jb-fact"><div className="jb-fact__l">Date</div><div className="jb-fact__v">{fmtShort(group.booking_date)}</div></div>
                  <div className="jb-fact"><div className="jb-fact__l">Going</div><div className="jb-fact__v">{going}</div></div>
                  <div className="jb-fact"><div className="jb-fact__l">Entry</div><div className="jb-fact__v">{group.booking_type === 'vip' ? 'VIP' : 'List'}</div></div>
                </div>

                {/* the party */}
                <div className="jb-sec">
                  <div className="jb-sec__head">
                    <span className="jb-sec__label">The Party</span>
                    {isOrganizer && (editing
                      ? <button className="jb-sec__aux" onClick={saveAllocations} disabled={savingAlloc}>{savingAlloc ? 'Saving…' : 'Done'}</button>
                      : <button className="jb-sec__aux" onClick={startEditing}>Who pays</button>)}
                  </div>
                  <div className="jb-roster">
                    {group.members.map(m => {
                      const statusLabel = m.rsvp === 'going' ? 'Going' : m.rsvp === 'maybe' ? 'Maybe' : m.rsvp === 'declined' ? 'Declined' : 'Pending'
                      const payLabel = m.paid ? 'Paid' : m.charge > 0 ? `€${m.charge.toFixed(0)}` : 'Guest'
                      return (
                        <div className={'jb-person' + (m.rsvp !== 'going' ? ' jb-person--pending' : '')} key={m.id}>
                          <div className="jb-person__av">{(m.full_name ?? '?').slice(0, 1).toUpperCase()}</div>
                          <div>
                            <div className="jb-person__name">{m.full_name ?? 'Member'}{m.is_me ? ' (you)' : ''}</div>
                            <div className="jb-person__role">{m.role === 'organizer' ? 'Host' : statusLabel}</div>
                          </div>
                          <div className="jb-person__right">
                            {editing && !m.paid ? (
                              <input className="jb-amt" type="number" inputMode="decimal" min="0" value={amounts[m.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [m.id]: e.target.value }))} />
                            ) : (
                              <>
                                <span className={'jb-status ' + (m.rsvp === 'going' ? 'jb-status--going' : 'jb-status--pending')}>{statusLabel}</span>
                                <span className="jb-pay__static">{payLabel}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {isOrganizer && !editing && (
                      <button className="jb-add" onClick={() => document.getElementById('jb-invite')?.scrollIntoView({ behavior: 'smooth' })}>
                        <span className="jb-add__ic">{IcPlus}</span>
                        <span><span className="jb-add__t" style={{ display: 'block' }}>Add friends</span><span className="jb-add__s">Pick from your friends</span></span>
                      </button>
                    )}
                  </div>
                  {editing && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 12 }}>Set €0 to make someone a free guest.</p>}
                </div>

                {/* invite friends (organizer) */}
                {isOrganizer && group.status === 'open' && (
                  <div className="jb-sec" id="jb-invite">
                    <div className="jb-sec__head"><span className="jb-sec__label">Invite friends</span></div>
                    {invitable.length > 0 && (
                      <>
                        {invitable.map(f => {
                          const sel = inviteSel.has(f.id)
                          return (
                            <button key={f.id} className="jb-pick" onClick={() => setInviteSel(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}>
                              <span className={'jb-pick__box' + (sel ? ' on' : '')}>{sel && IcCheck}</span>
                              <span className="jb-pick__name">{f.full_name ?? 'Member'}</span>
                            </button>
                          )
                        })}
                        <button className="jb-btn jb-btn--primary" style={{ marginTop: 16 }} onClick={invite} disabled={!inviteSel.size || inviting}>
                          {inviting ? 'Inviting…' : inviteSel.size ? `Invite ${inviteSel.size}` : 'Select friends'}
                        </button>
                      </>
                    )}
                    <p className="jb-invitecopy" style={{ marginTop: invitable.length > 0 ? 18 : 0 }}>
                      Send the link to anyone — they&rsquo;ll land straight on {group.club_name} with your group.
                    </p>
                    <button className={'jb-share' + (copied ? ' is-copied' : '')} onClick={share}>
                      <div className="jb-share__txt">
                        <div className="jb-share__t">{copied ? 'Link copied' : 'Share invite link'}</div>
                        <div className="jb-share__code">Code · <b>{group.invite_code}</b></div>
                      </div>
                      <div className="jb-share__ic">{copied ? IcCheck : IcShare}</div>
                    </button>
                    {group.members.some(m => m.rsvp === 'invited' || m.rsvp === 'maybe') && (
                      <button className="jb-btn jb-btn--ghost" onClick={remind} disabled={busy}>{remindMsg || 'Remind pending'}</button>
                    )}
                  </div>
                )}

                {error && <p style={{ color: 'var(--accent)', textAlign: 'center', padding: '16px 20px 0', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{error}</p>}

                {/* Cancelled banner */}
                {group.status === 'cancelled' && (
                  <div className="jb-rsvp jb-rsvp--out">
                    <div className="jb-rsvp__eyebrow">This night</div>
                    <div className="jb-rsvp__h">Called off</div>
                    <div className="jb-rsvp__sub">The organizer cancelled this plan</div>
                  </div>
                )}

                {/* RSVP */}
                {group.status !== 'cancelled' && (
                <div className={'jb-rsvp' + (goingMe ? '' : ' jb-rsvp--out')}>
                  <div className="jb-rsvp__eyebrow">Your spot</div>
                  {goingMe ? (
                    <>
                      <div className="jb-rsvp__h">You&rsquo;re going <span className="check">{IcCheck}</span></div>
                      <div className="jb-rsvp__sub">{fmtDate(group.booking_date)}</div>
                      <button className="jb-btn jb-btn--primary" onClick={() => router.push('/bookings')}>View your ticket</button>
                    </>
                  ) : mustPay ? (
                    <>
                      <div className="jb-rsvp__h">Reserve your spot</div>
                      <div className="jb-rsvp__price">{fee}</div>
                      <div style={{ background: '#221E1A', borderRadius: 16, padding: 6 }}>
                        <PaymentForm totalLabel={fee} onPay={join} loading={busy} />
                      </div>
                      <div className="jb-rsvp__row">
                        {me?.rsvp !== 'maybe' && <button className="jb-rsvp__alt" onClick={setMaybe} disabled={busy}>Maybe</button>}
                        {me && me.rsvp !== 'declined' && <button className="jb-rsvp__alt" onClick={decline} disabled={busy}>Can&rsquo;t make it</button>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="jb-rsvp__h">Not going yet</div>
                      <div className="jb-rsvp__sub">Reserve your place on the guestlist</div>
                      <button className="jb-btn jb-btn--primary" onClick={() => join()} disabled={busy}>{busy ? 'One sec…' : 'Count me in'}</button>
                      <div className="jb-rsvp__row">
                        {me?.rsvp !== 'maybe' && <button className="jb-rsvp__alt" onClick={setMaybe} disabled={busy}>Maybe</button>}
                        {me && me.rsvp !== 'declined' && <button className="jb-rsvp__alt" onClick={decline} disabled={busy}>Can&rsquo;t make it</button>}
                      </div>
                    </>
                  )}
                </div>
                )}

                {/* Organizer: call the night off */}
                {isOrganizer && group.status === 'open' && (
                  <div style={{ textAlign: 'center', padding: '18px 20px 0' }}>
                    <button className="jb-rsvp__alt" onClick={cancelNight} disabled={busy}>Cancel this night</button>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        <div className={'jb-toast' + (copied ? ' is-on' : '')}>Invite link copied</div>
      </div>
    </div>
  )
}
