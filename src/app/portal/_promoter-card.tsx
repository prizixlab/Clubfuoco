'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import type { PromoterRow } from '@/app/api/portal/promoters/route'
import { ActivateButton, HideOffersButton, Badge, Btn, Card, api, C, caps, font, mono } from './_ui'
import { FeeControl } from './_fee-control'

// Shared mutation helpers for the promoter roster. Every action targets the
// promoter's application (grant/revoke access, IG verification) via
// /api/portal/promoters/[applicationId].
export function usePromoterActions(onReload: () => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = useCallback(async (row: PromoterRow, decision: 'approve' | 'reject' | 'revoke') => {
    if (!row.application_id) return
    const who = row.full_name || row.email || `@${row.instagram}`
    let msg = decision === 'approve'
      ? `Approve ${who} as a promoter? They get full access to the FuocoPromoters app.`
      : decision === 'revoke'
        ? `Revoke ${who}'s promoter access? They'll be locked out of the app.`
        : `Reject ${who}'s application?`
    if (decision === 'approve' && !row.ig_verified) {
      msg = `Instagram NOT verified — you haven't confirmed the DM'd code came from @${(row.instagram ?? '').replace(/^@/, '')}.\n\n${msg}`
    }
    if (!confirm(msg)) return
    setBusy(row.id)
    try {
      await api(`/api/portal/promoters/${row.application_id}`, { method: 'POST', body: JSON.stringify({ decision }) })
      onReload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally { setBusy(null) }
  }, [onReload])

  const patch = useCallback(async (row: PromoterRow, body: { instagram?: string; ig_verified?: boolean }) => {
    if (!row.application_id) return
    setBusy(row.id)
    try {
      await api(`/api/portal/promoters/${row.application_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      onReload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally { setBusy(null) }
  }, [onReload])

  const toggleVerified = useCallback((row: PromoterRow) => {
    if (!row.ig_verified && !confirm(
      `Confirm the code ${row.ig_code ?? ''} was DM'd from @${(row.instagram ?? '').replace(/^@/, '')}?`
    )) return
    patch(row, { ig_verified: !row.ig_verified })
  }, [patch])

  const editHandle = useCallback((row: PromoterRow) => {
    const current = (row.instagram ?? '').replace(/^@/, '')
    const next = prompt(
      'Instagram handle (no @).\n\nChanging it clears verification — the code was proved against the old account.',
      current,
    )
    if (next === null) return
    const handle = next.trim().replace(/^@+/, '')
    if (!handle || handle === current) return
    patch(row, { instagram: handle })
  }, [patch])

  return { busy, error, decide, toggleVerified, editHandle }
}

type Actions = ReturnType<typeof usePromoterActions>

function displayName(row: PromoterRow): string {
  return row.brand?.name || row.full_name || row.email
    || (row.instagram ? `@${row.instagram.replace(/^@/, '')}` : '') || 'Unnamed'
}

// A promoter awaiting approval: the IG-verification workflow up top, then the
// application detail, then Approve / Reject.
export function PendingPromoterCard({ row, actions }: { row: PromoterRow; actions: Actions }) {
  const { busy, decide, toggleVerified, editHandle } = actions
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, fontFamily: font, color: C.text }}>{displayName(row)}</span>
          {row.instagram && (
            <a href={`https://instagram.com/${row.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer"
              style={{ fontFamily: mono, fontSize: 12.5, color: C.goldHi, textDecoration: 'none' }}>
              @{row.instagram.replace(/^@/, '')} ↗
            </a>
          )}
          <Badge color={row.ig_verified ? C.green : C.faint}>{row.ig_verified ? 'IG verified' : 'IG unverified'}</Badge>
        </div>
        {row.email && <p style={{ margin: '3px 0 0', fontFamily: mono, fontSize: 11.5, color: C.dim }}>{row.email}</p>}
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {row.clubs && <Fact label="Clubs" value={row.clubs} />}
          {row.experience && <Fact label="Experience" value={row.experience} />}
          {row.ig_code && <Fact label="DM code" value={row.ig_code} mono />}
          {row.created_at && <Fact label="Applied" value={new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.faint, fontFamily: font }}>
          {row.ig_verified ? 'Instagram confirmed — safe to decide on access.' : 'Check their IG DMs for the code above, then Verify.'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Btn small onClick={() => toggleVerified(row)} disabled={busy === row.id}>{row.ig_verified ? 'Unverify IG' : 'Verify IG'}</Btn>
          <Btn small onClick={() => editHandle(row)} disabled={busy === row.id}>Edit handle</Btn>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn kind="primary" onClick={() => decide(row, 'approve')} disabled={busy === row.id}>{busy === row.id ? '…' : 'Approve'}</Btn>
        <Btn kind="danger" onClick={() => decide(row, 'reject')} disabled={busy === row.id}>Reject</Btn>
      </div>
    </Card>
  )
}

// A roster promoter: their brand (logo/colour/offers/live) and their access
// state, with brand management and grant/revoke on one card.
export function PromoterCard({ row, live, actions, onReload }: {
  row: PromoterRow; live: BrandRow | null; actions: Actions; onReload: () => void
}) {
  const { busy, decide, toggleVerified, editHandle } = actions
  const b = row.brand
  const prospective = !row.user_id   // a brand seeded before its promoter has access

  return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        {/* Logo tile */}
        <div style={{
          width: 86, height: 46, borderRadius: 6, background: 'rgba(0,0,0,0.4)',
          border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {b?.logo_url
            ? <img src={b.logo_url} alt={b.name} style={{ maxWidth: '80%', maxHeight: '70%', objectFit: 'contain' }} />
            : <span style={{ ...caps, fontSize: 9, color: C.faint }}>No logo</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {b && <Badge color={b.offers_hidden ? C.danger : C.green}>{b.offers_hidden ? 'Hidden' : 'Live'}</Badge>}
          {b?.is_active && <Badge color={C.gold}>Featured</Badge>}
          {prospective
            ? <Badge color={C.faint}>No access yet</Badge>
            : <Badge color={row.is_promoter ? C.green : C.faint}>{row.is_promoter ? 'Active' : 'No access'}</Badge>}
        </div>
      </div>

      <p style={{ margin: '16px 0 0', fontSize: 16.5, fontWeight: 700, fontFamily: font, color: C.text }}>{displayName(row)}</p>
      <p style={{ margin: '4px 0 0', fontFamily: mono, fontSize: 12, color: C.dim }}>
        {b ? `/${b.key}` : (row.instagram ? `@${row.instagram.replace(/^@/, '')}` : 'No brand yet')}
      </p>

      {b && (
        <div style={{ display: 'flex', gap: 28, margin: '16px 0 18px' }}>
          <div>
            <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Accent</p>
            <span style={{ display: 'inline-block', width: 34, height: 17, borderRadius: 3, background: b.color, border: `1px solid ${C.line}` }} title={b.color} />
          </div>
          <div>
            <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Offers</p>
            <p style={{ margin: 0, fontFamily: font, fontSize: 14, fontWeight: 600, color: C.text }}>
              {b.offer_count} <span style={{ color: C.dim, fontWeight: 400 }}>live</span>
            </p>
          </div>
          {b.attribution_required && (
            <div>
              <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Credit</p>
              <p style={{ margin: 0, fontFamily: font, fontSize: 14, color: C.goldHi }}>Required</p>
            </div>
          )}
        </div>
      )}

      {b && (
        <div style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <p style={{ ...caps, fontSize: 10, color: C.faint, margin: 0 }}>Login</p>
          {b.login_email
            ? <span style={{ fontFamily: mono, fontSize: 12, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.login_email}>{b.login_email}</span>
            : <span style={{ fontSize: 12, color: C.faint, fontFamily: font, fontStyle: 'italic' }}>not set</span>}
        </div>
      )}

      {/* IG line for promoters who applied (roster still shows the handle). */}
      {!prospective && row.instagram && (
        <div style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a href={`https://instagram.com/${row.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: mono, fontSize: 12, color: C.goldHi, textDecoration: 'none' }}>
            @{row.instagram.replace(/^@/, '')} ↗
          </a>
          {!row.ig_verified && <Badge color={C.faint}>IG unverified</Badge>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 'auto', flexWrap: 'wrap' }}>
        {b && (
          <>
            <Link href={`/portal/brands/${b.id}`} style={{ textDecoration: 'none', flex: 1, display: 'flex' }}>
              <Btn wide>Edit</Btn>
            </Link>
            <span style={{ flex: 1, display: 'flex' }}>
              <HideOffersButton brand={b} onDone={onReload} wide />
            </span>
            {!b.is_active && (
              <span style={{ flex: '1 1 100%', display: 'flex' }}>
                <ActivateButton brand={b} onDone={onReload} wide />
              </span>
            )}
          </>
        )}
        {/* Access controls — only when there's an application behind the row. */}
        {row.application_id && (
          <span style={{ flex: '1 1 100%', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn small onClick={() => toggleVerified(row)} disabled={busy === row.id}>{row.ig_verified ? 'Unverify' : 'Verify'}</Btn>
            <Btn small onClick={() => editHandle(row)} disabled={busy === row.id}>Edit handle</Btn>
            {row.is_promoter
              ? <Btn small kind="danger" onClick={() => decide(row, 'revoke')} disabled={busy === row.id}>Revoke</Btn>
              : <Btn small onClick={() => decide(row, 'approve')} disabled={busy === row.id}>Grant access</Btn>}
            {/* Only for a promoter who actually has access — there is nothing to
                negotiate with someone who can't sell a ticket yet. Keyed on
                user_id, not the row id, because the rate lives on the user. */}
            {row.is_promoter && row.user_id && (
              <FeeControl userId={row.user_id} name={row.full_name || row.email || 'this promoter'} />
            )}
          </span>
        )}
      </div>
    </Card>
  )
}

function Fact({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span style={{ fontSize: 12, fontFamily: font, color: C.dim }}>
      <span style={{ ...caps, fontSize: 9, color: C.faint, marginRight: 5 }}>{label}</span>
      <span style={{ color: C.text, fontFamily: isMono ? mono : font, fontSize: isMono ? 11.5 : 12 }}>{value}</span>
    </span>
  )
}
