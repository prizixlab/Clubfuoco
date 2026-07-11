'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import {
  ActivateButton, Btn, Card, ErrorLine, Field, SupplierCredit, TextInput,
  api, C, font, mono, serif,
} from '../../_ui'
import OffersEditor from './_offers'

const LABEL_PRESETS = ['Guestlist by', 'Powered by', 'via']

// Brand editor — identity, logo, and the contractual attribution credit, with
// a live preview of exactly what the booking sheet will show. Offers below.
export default function BrandEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [brand, setBrand] = useState<BrandRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unsaved attribution edits, mirrored up from the identity form so the
  // preview is live — the operator sees the credit before committing it.
  const [draft, setDraft] = useState<{ attribution_required: boolean; attribution_label: string | null } | null>(null)

  const load = useCallback(() => {
    api<BrandRow>(`/api/portal/brands/${id}`)
      .then(setBrand)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [id])
  useEffect(load, [load])

  if (error) return <ErrorLine error={error} />
  if (!brand) return <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Link href="/portal" style={{ color: C.dim, textDecoration: 'none', fontFamily: font, fontSize: 13 }}>← Suppliers</Link>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: font }}>{brand.name}</h1>
          <span style={{ fontFamily: mono, fontSize: 12, color: C.faint }}>{brand.key}</span>
        </div>
        <ActivateButton brand={brand} onDone={load} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        <IdentityCard brand={brand} onSaved={load} onDraft={setDraft} />
        <PreviewCard brand={draft ? { ...brand, ...draft } : brand} />
      </div>

      <OffersEditor brand={brand} onOffersChanged={load} />
    </>
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
  const [busy, setBusy]   = useState<'save' | 'logo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const customLabel = !LABEL_PRESETS.includes(label)

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
      <h2 style={{ margin: '0 0 16px', fontSize: 14, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim, fontFamily: font }}>
        Identity
      </h2>

      <Field label="Name">
        <TextInput value={name} maxLength={60} onChange={e => setName(e.target.value)} />
      </Field>

      <Field label="Key" hint="Immutable — storage path + cache key.">
        <TextInput value={brand.key} readOnly disabled style={{ fontFamily: mono, opacity: 0.55, cursor: 'not-allowed' }} />
      </Field>

      <Field label="Brand color" hint="Only used inside the supplier’s credit/logo — never the app accent.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="color" value={/^#[0-9A-F]{6}$/i.test(color) ? color : '#C09950'}
            onChange={e => setColor(e.target.value.toUpperCase())}
            style={{ width: 44, height: 38, border: `1px solid ${C.line}`, borderRadius: 8, background: 'none', padding: 2, cursor: 'pointer' }} />
          <TextInput value={color} maxLength={7} style={{ width: 120, fontFamily: mono }}
            onChange={e => setColor(e.target.value.startsWith('#') ? e.target.value.toUpperCase() : `#${e.target.value.toUpperCase()}`)} />
        </div>
      </Field>

      <Field label="Logo" hint="PNG or SVG, max 2 MB. Stored at brand/<key>/ and cache-busted on re-upload.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 120, height: 52, borderRadius: 10, background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {brand.logo_url
              ? <img src={brand.logo_url} alt={brand.name} style={{ maxWidth: '84%', maxHeight: '72%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 11, color: C.faint, fontFamily: font }}>no logo</span>}
          </div>
          <input ref={fileRef} type="file" accept=".png,.svg,image/png,image/svg+xml" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
          <Btn onClick={() => fileRef.current?.click()} disabled={busy === 'logo'}>
            {busy === 'logo' ? 'Uploading…' : brand.logo_url ? 'Replace logo' : 'Upload logo'}
          </Btn>
        </div>
      </Field>

      <div style={{ borderTop: `1px solid ${C.line}`, margin: '4px 0 16px' }} />
      <h2 style={{ margin: '0 0 6px', fontSize: 14, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim, fontFamily: font }}>
        Attribution
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.faint, lineHeight: 1.5, fontFamily: font }}>
        Some supplier contracts require their brand stay visible. When on, the
        booking sheet shows a small subordinate credit — Club Fuoco stays dominant.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: C.gold, cursor: 'pointer' }} />
        <span style={{ fontSize: 14, fontFamily: font }}>Credit required on the booking sheet</span>
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
                onChange={e => setLabel(e.target.value)} style={{ width: 200 }} />
            )}
          </div>
        </Field>
      )}

      <ErrorLine error={error} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Btn kind="primary" onClick={save} disabled={busy === 'save' || !name.trim() || !/^#[0-9A-F]{6}$/i.test(color)}>
          {busy === 'save' ? 'Saving…' : 'Save changes'}
        </Btn>
        {saved && <span style={{ fontSize: 12.5, color: C.green, fontFamily: font }}>Saved ✓</span>}
      </div>
    </Card>
  )
}

// Live preview — the supplier credit as the booking sheet renders it, plus a
// sample offer card, so a contract's visibility clause can be honored exactly.
function PreviewCard({ brand }: { brand: BrandRow }) {
  return (
    <Card>
      <h2 style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim, fontFamily: font }}>
        Live preview
      </h2>

      {/* Booking sheet footer */}
      <p style={{ margin: '0 0 8px', fontSize: 11, color: C.faint, fontFamily: font }}>Booking sheet</p>
      <div style={{ background: '#0A0A0A', border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ height: 2, background: C.gold, margin: '-16px -18px 12px', borderRadius: '14px 14px 0 0' }} />
        <p style={{ margin: 0, textAlign: 'center', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: C.dim, fontFamily: font }}>
          A booking with
        </p>
        <p style={{ margin: '4px 0 14px', textAlign: 'center', fontFamily: serif, fontStyle: 'italic', fontSize: 22 }}>
          Club Fuoco
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.dim, fontFamily: font, padding: '6px 0' }}>
          <span>Operator</span><span style={{ color: C.text }}>Club Fuoco</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.dim, fontFamily: font, padding: '6px 0' }}>
          <span>Venue</span><span style={{ color: C.text }}>Opium Barcelona</span>
        </div>
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 12, textAlign: 'center' }}>
          {brand.attribution_required
            ? <SupplierCredit name={brand.name} label={brand.attribution_label} logoUrl={brand.logo_url} />
            : <span style={{ fontSize: 11, color: C.faint, fontFamily: font, fontStyle: 'italic' }}>no supplier credit (attribution off)</span>}
        </div>
      </div>

      {/* Sample offer card */}
      <p style={{ margin: '0 0 8px', fontSize: 11, color: C.faint, fontFamily: font }}>Offer card</p>
      <div style={{ background: '#0A0A0A', border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: font }}>Free Guestlist</span>
          <span style={{ fontSize: 12, color: C.gold, fontWeight: 600, fontFamily: font }}>Free</span>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: C.dim, fontFamily: font }}>Free till 1:00 AM · Sun – Fri</p>
        {brand.attribution_required && (
          <div style={{ marginTop: 10 }}>
            <SupplierCredit name={brand.name} label={brand.attribution_label} logoUrl={brand.logo_url} />
          </div>
        )}
      </div>
    </Card>
  )
}
