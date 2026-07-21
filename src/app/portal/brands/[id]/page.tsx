'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import {
  ActivateButton, Badge, Btn, Card, ErrorLine, Field, SectionLabel, SupplierCredit, TextInput,
  api, C, caps, font, mono, serif,
} from '../../_ui'
import OffersEditor from './_offers'

const LABEL_PRESETS = ['Guestlist by', 'Powered by', 'via']

// Brand editor — identity, logo, and the contractual attribution credit, with
// a sticky live preview of exactly what the booking sheet will show. Offers
// below. Layout per the Stitch "brand & offers editor" screen.
export default function BrandEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [brand, setBrand] = useState<BrandRow | null>(null)
  const [currentLive, setCurrentLive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unsaved attribution edits, mirrored up from the identity form so the
  // preview is live — the operator sees the credit before committing it.
  const [draft, setDraft] = useState<{ attribution_required: boolean; attribution_label: string | null } | null>(null)

  const load = useCallback(() => {
    api<BrandRow>(`/api/portal/brands/${id}`)
      .then(setBrand)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
    // Who's live right now — shown in the activation ceremony.
    api<BrandRow[]>('/api/portal/brands')
      .then(all => setCurrentLive(all.find(b => b.is_active)?.name ?? null))
      .catch(() => setCurrentLive(null))
  }, [id])
  useEffect(load, [load])

  if (error) return <ErrorLine error={error} />
  if (!brand) return <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <Link href="/portal" style={{ ...caps, color: C.dim, textDecoration: 'none', letterSpacing: '0.12em' }}>
            ← Suppliers
          </Link>
          <h1 style={{ margin: '14px 0 0', fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
            Edit brand: <em style={{ fontStyle: 'italic', color: C.goldHi }}>{brand.name}</em>
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font, display: 'flex', alignItems: 'center', gap: 10 }}>
            Manage identity, attribution, and per-venue offers.
            <span style={{ fontFamily: mono, fontSize: 12, color: C.faint }}>/{brand.key}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {brand.offers_hidden && <Badge color={C.danger}>Offers hidden</Badge>}
          {brand.is_active
            ? <Badge color={C.gold}>Live now</Badge>
            : <ActivateButton brand={brand} onDone={load} currentLive={currentLive} />}
        </div>
      </div>

      <VisibilityCard brand={brand} onChanged={load} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18, alignItems: 'start' }}>
        <IdentityCard brand={brand} onSaved={load} onDraft={setDraft} />
        <PreviewCard brand={draft ? { ...brand, ...draft } : brand} />
      </div>

      <OffersEditor brand={brand} onOffersChanged={load} />
    </>
  )
}

// Supplier-level kill switch. Pulls every offer from this supplier out of the
// public feed AND refuses them at the booking gate, without touching a single
// offer row — each keeps its own active/archived state, order and skipped
// dates, so restoring puts things back exactly as they were.
//
// Deliberately separate from "Live now" (is_active), which picks the primary
// featured supplier. A supplier can be hidden without disturbing that.
function VisibilityCard({ brand, onChanged }: { brand: BrandRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hidden = brand.offers_hidden

  async function toggle() {
    setBusy(true); setError(null)
    try {
      await api(`/api/portal/brands/${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ offers_hidden: !hidden }),
      })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change visibility')
    }
    setBusy(false)
  }

  return (
    <Card style={{ marginTop: 18, borderColor: hidden ? `${C.danger}55` : C.line }}>
      <SectionLabel right={hidden ? <Badge color={C.danger}>Hidden</Badge> : <Badge color={C.green}>Public</Badge>}>
        Offer visibility
      </SectionLabel>
      <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: C.dim, fontFamily: font }}>
        {hidden
          ? `All ${brand.offer_count} offer${brand.offer_count === 1 ? '' : 's'} from ${brand.name} are hidden from the app and cannot be booked. Nothing was deleted — restoring puts them back exactly as they were.`
          : `Temporarily hide every offer from ${brand.name}. They stop appearing in the app and can’t be booked, but nothing is deleted and each offer keeps its own settings.`}
      </p>
      <ErrorLine error={error} />
      <div style={{ marginTop: 16 }}>
        <Btn kind={hidden ? 'primary' : 'danger'} onClick={toggle} disabled={busy}>
          {busy ? 'Saving…' : hidden ? 'Restore offers' : 'Hide all offers'}
        </Btn>
      </div>
    </Card>
  )
}

function IdentityCard({ brand, onSaved, onDraft }: {
  brand: BrandRow
  onSaved: () => void
  onDraft: (d: { attribution_required: boolean; attribution_label: string | null }) => void
}) {
  const [name, setName]   = useState(brand.name)
  const [color, setColor] = useState(brand.color.toUpperCase())
  const [required, setRequired] = useState(brand.attribution_required)
  const [label, setLabel] = useState(brand.attribution_label ?? 'Guestlist by')
  const [loginEmail, setLoginEmail] = useState(brand.login_email ?? '')
  const [busy, setBusy]   = useState<'save' | 'logo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const customLabel = !LABEL_PRESETS.includes(label)
  // Empty is allowed (no login yet); a non-empty value must look like an email.
  const emailValid = loginEmail.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail.trim())

  // Mirror attribution edits up so the preview card tracks them live.
  useEffect(() => {
    onDraft({ attribution_required: required, attribution_label: label.trim() || null })
  }, [required, label, onDraft])

  async function save() {
    setBusy('save')
    setError(null)
    setSaved(false)
    try {
      // Send only what changed — keeps name/color edits working even if the
      // attribution migration hasn't been applied to the live DB yet.
      const patch: Record<string, unknown> = {}
      if (name.trim() !== brand.name) patch.name = name.trim()
      if (color !== brand.color.toUpperCase()) patch.color = color
      if (required !== brand.attribution_required) patch.attribution_required = required
      // null label falls back to "Guestlist by" everywhere, so only a real
      // change (not the untouched default) counts as an edit.
      if ((label.trim() || null) !== (brand.attribution_label ?? 'Guestlist by')) patch.attribution_label = label.trim() || null
      if ((loginEmail.trim() || null) !== (brand.login_email ?? null)) patch.login_email = loginEmail.trim() || null
      if (Object.keys(patch).length > 0) {
        await api(`/api/portal/brands/${brand.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      }
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  async function uploadLogo(file: File) {
    setBusy('logo')
    setError(null)
    try {
      const form = new FormData()
      form.append('logo', file)
      await api(`/api/portal/brands/${brand.id}/logo`, { method: 'POST', body: form })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card>
      <SectionLabel>Brand identity</SectionLabel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Brand name">
          <TextInput value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Immutable key">
          <TextInput value={brand.key} readOnly disabled
            style={{ fontFamily: mono, fontSize: 13, opacity: 0.5, cursor: 'not-allowed', background: 'rgba(255,255,255,0.04)' }} />
        </Field>
      </div>

      <Field label="Primary accent (hex)" hint="Only used inside the supplier’s credit/logo — never the app accent.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="color" value={/^#[0-9A-F]{6}$/i.test(color) ? color : '#C09950'}
            onChange={e => setColor(e.target.value.toUpperCase())}
            style={{ width: 46, height: 40, border: `1px solid ${C.line}`, borderRadius: 4, background: 'rgba(0,0,0,0.35)', padding: 3, cursor: 'pointer' }} />
          <TextInput value={color} maxLength={7} style={{ width: 130, fontFamily: mono, fontSize: 13 }}
            onChange={e => setColor(e.target.value.startsWith('#') ? e.target.value.toUpperCase() : `#${e.target.value.toUpperCase()}`)} />
        </div>
      </Field>

      <Field label="Logo assets" hint="PNG or SVG, max 2 MB. Stored at brand/<key>/ and cache-busted on re-upload.">
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
          <div style={{
            flex: 1, minHeight: 84, borderRadius: 6, background: 'rgba(0,0,0,0.35)',
            border: `1px dashed rgba(255,255,255,0.18)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 10,
          }}>
            {brand.logo_url
              ? <img src={brand.logo_url} alt={brand.name} style={{ maxWidth: '86%', maxHeight: 60, objectFit: 'contain' }} />
              : <span style={{ ...caps, fontSize: 10, color: C.faint }}>No logo uploaded</span>}
          </div>
          <input ref={fileRef} type="file" accept=".png,.svg,image/png,image/svg+xml" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
          <Btn onClick={() => fileRef.current?.click()} disabled={busy === 'logo'}>
            {busy === 'logo' ? 'Uploading…' : brand.logo_url ? 'Replace' : 'Upload'}
          </Btn>
        </div>
      </Field>

      <div style={{ borderTop: `1px solid ${C.line}`, margin: '6px 0 20px' }} />
      <SectionLabel>Attribution</SectionLabel>
      <p style={{ margin: '-8px 0 16px', fontSize: 12.5, color: C.faint, lineHeight: 1.55, fontFamily: font }}>
        Some supplier contracts require their brand stay visible. When on, the
        booking sheet shows a small subordinate credit — Club Fuoco stays dominant.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: C.gold, cursor: 'pointer' }} />
        <span style={{ fontSize: 14, fontFamily: font, color: C.text }}>Credit required on the booking sheet</span>
      </label>

      {required && (
        <Field label="Credit label">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {LABEL_PRESETS.map(p => (
              <Btn key={p} small kind={label === p ? 'primary' : 'ghost'} onClick={() => setLabel(p)}>{p}</Btn>
            ))}
            <Btn small kind={customLabel ? 'primary' : 'ghost'} onClick={() => setLabel('')}>Custom…</Btn>
            {customLabel && (
              <TextInput value={label} maxLength={40} placeholder="In partnership with"
                onChange={e => setLabel(e.target.value)} style={{ width: 210 }} />
            )}
          </div>
        </Field>
      )}

      <div style={{ borderTop: `1px solid ${C.line}`, margin: '4px 0 16px' }} />
      <SectionLabel>Supplier access</SectionLabel>
      <p style={{ margin: '-8px 0 14px', fontSize: 12.5, color: C.faint, lineHeight: 1.55, fontFamily: font }}>
        The email this supplier uses to sign in to the FuocoPromoters app and
        manage their own offers. Save it, then send the password link below —
        they’ll get an email to create a password and sign in with it.
      </p>
      <Field label="Login email" hint="Leave blank if no login has been set up yet.">
        <TextInput type="email" value={loginEmail} maxLength={160} placeholder="team@rumba.com"
          autoComplete="off" onChange={e => setLoginEmail(e.target.value)} />
      </Field>

      <ProvisionAccess brand={brand} emailValue={loginEmail} onChanged={onSaved} />

      <ErrorLine error={error} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
        <Btn kind="primary" onClick={save} disabled={busy === 'save' || !name.trim() || !/^#[0-9A-F]{6}$/i.test(color) || !emailValid}>
          {busy === 'save' ? 'Saving…' : 'Publish changes'}
        </Btn>
        {saved && <span style={{ ...caps, fontSize: 10.5, color: C.green }}>● Saved</span>}
      </div>
    </Card>
  )
}

// Grant / revoke the supplier's FuocoPromoters access. "Send password link"
// creates (or links) a pre-approved promoter account for login_email and emails
// that address a link to create their password; they then sign in to the app
// with email + password. Save the email first — this uses the stored value.
function ProvisionAccess({ brand, emailValue, onChanged }: {
  brand: BrandRow; emailValue: string; onChanged: () => void
}) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote]   = useState<string | null>(null)

  // Sending uses the persisted login_email, so an unsaved edit must be published
  // first — guard against emailing a stale/blank address.
  const emailDirty = (emailValue.trim() || '') !== (brand.login_email ?? '')

  async function sendLink(isResend: boolean) {
    const verb = isResend ? 'Resend the password link to' : `Grant ${brand.name} access and email a "create your password" link to`
    if (!confirm(`${verb} ${brand.login_email}?`)) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await api<{ emailSent: boolean }>(`/api/portal/brands/${brand.id}/provision-login`, { method: 'POST' })
      if (r.emailSent) setNote(`Password link sent to ${brand.login_email}.`)
      else setError(`Access granted, but the email didn't send (email service not configured). Configure Resend and resend.`)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send link')
    } finally { setBusy(false) }
  }

  async function revoke() {
    if (!confirm(`Revoke ${brand.name}'s access? They'll no longer be able to manage offers in the app. (The account itself is kept.)`)) return
    setBusy(true); setError(null); setNote(null)
    try {
      await api(`/api/portal/brands/${brand.id}/provision-login`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed')
    } finally { setBusy(false) }
  }

  const blockedReason = !brand.login_email ? 'Set + publish a login email first'
    : emailDirty ? 'Publish the email change first' : undefined

  return (
    <div style={{ margin: '4px 0 4px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {brand.login_provisioned
        ? <>
            <Badge color={C.green}>Access active</Badge>
            <Btn small onClick={() => sendLink(true)} disabled={busy || !!blockedReason} title={blockedReason}>
              {busy ? 'Sending…' : 'Resend password link'}
            </Btn>
            <Btn small kind="danger" onClick={revoke} disabled={busy}>Revoke access</Btn>
          </>
        : <>
            <Badge color={C.faint}>No app access</Badge>
            <Btn small onClick={() => sendLink(false)} disabled={busy || !!blockedReason} title={blockedReason}>
              {busy ? 'Sending…' : 'Send password link & grant access'}
            </Btn>
            {emailDirty && brand.login_email && <span style={{ fontSize: 11.5, color: C.faint, fontFamily: font }}>Publish the email change first.</span>}
          </>}
      {note && <span style={{ fontSize: 12, color: C.green, fontFamily: font }}>{note}</span>}
      {error && <span style={{ fontSize: 12, color: C.danger, fontFamily: font }}>{error}</span>}
    </div>
  )
}

// Live consumer preview — the supplier credit as the booking sheet renders it,
// plus a sample offer card, so a contract's visibility clause can be honored
// exactly before flipping the switch. Sticky beside the form on wide screens.
function PreviewCard({ brand }: { brand: BrandRow }) {
  const credit = brand.attribution_required
  return (
    <div style={{ position: 'sticky', top: 88 }}>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
        {/* Panel chrome */}
        <div style={{
          padding: '14px 20px', borderBottom: `2px solid ${C.gold}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: C.goldHi }} />
          <span style={{ ...caps, color: C.goldHi, letterSpacing: '0.16em' }}>Live consumer preview</span>
        </div>

        <div style={{ padding: 24, background: '#0A0A0A' }}>
          {/* Booking sheet lockup — faithful to RumbalistBookSheet/OfferSheet */}
          <p style={{ ...caps, color: C.dim, margin: 0, textAlign: 'center', letterSpacing: '0.24em', fontSize: 10 }}>
            A booking with
          </p>
          <p style={{ margin: '8px 0 0', textAlign: 'center', fontFamily: serif, fontStyle: 'italic', fontSize: 26, color: C.text }}>
            Club Fuoco
          </p>
          <div style={{ width: 44, height: 1, background: C.gold, margin: '14px auto 0' }} />
          <div style={{ textAlign: 'center', marginTop: 14, minHeight: 16 }}>
            {credit
              ? <SupplierCredit name={brand.name} label={brand.attribution_label} logoUrl={brand.logo_url} />
              : <span style={{ fontSize: 11, color: C.faint, fontFamily: font, fontStyle: 'italic' }}>no supplier credit (attribution off)</span>}
          </div>

          {/* Sheet detail rows */}
          <div style={{ margin: '22px 0 0', borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
            {[['Operator', 'Club Fuoco'], ['Venue', 'Opium Barcelona']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 12.5, fontFamily: font }}>
                <span style={{ color: C.dim }}>{k}</span><span style={{ color: C.text }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Sample offer card */}
          <p style={{ ...caps, color: C.gold, margin: '20px 0 10px', fontSize: 10 }}>Selected option</p>
          <div style={{
            background: C.card, border: `1px solid ${C.line}`, borderRight: `2px solid ${C.gold}`,
            borderRadius: 6, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, fontFamily: font, color: C.text }}>Free Guestlist</span>
              <span style={{ fontFamily: mono, fontSize: 13, color: C.goldHi }}>Free</span>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 12, color: C.dim, fontFamily: font }}>
              Free till 1:00 AM · Sun – Fri
            </p>
            {credit && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                <SupplierCredit name={brand.name} label={brand.attribution_label} logoUrl={brand.logo_url} />
              </div>
            )}
          </div>

          <p style={{ margin: '18px 0 0', fontSize: 11, color: C.faint, fontFamily: font, textAlign: 'center', lineHeight: 1.5 }}>
            Preview updates instantly as you edit — save to publish.
          </p>
        </div>
      </div>
    </div>
  )
}
