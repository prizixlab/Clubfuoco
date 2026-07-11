'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import { Btn, Card, ErrorLine, Field, SectionLabel, TextInput, api, C, caps, font, mono, serif } from '../../_ui'

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

// New brand — name, key (slug, immutable after create), color. Logo, offers
// and attribution live in the editor this screen lands on.
export default function NewBrandPage() {
  const router = useRouter()
  const [name, setName]   = useState('')
  const [key, setKey]     = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [color, setColor] = useState('#C09950')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const brand = await api<BrandRow>('/api/portal/brands', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), key, color }),
      })
      router.push(`/portal/brands/${brand.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create brand')
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Link href="/portal" style={{ ...caps, color: C.dim, textDecoration: 'none', letterSpacing: '0.12em' }}>
          ← Suppliers
        </Link>
        <h1 style={{ margin: '14px 0 0', fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
          Onboard new supplier
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Identity first — logo, attribution and offers come next in the editor.
        </p>
      </div>

      <Card style={{ maxWidth: 520 }}>
        <SectionLabel>Brand identity</SectionLabel>
        <form onSubmit={create}>
          <Field label="Brand name" hint="Display name shown in the supplier credit, e.g. “Aashi”.">
            <TextInput value={name} autoFocus maxLength={60} placeholder="Aashi"
              onChange={e => {
                setName(e.target.value)
                if (!keyTouched) setKey(slugify(e.target.value))
              }} />
          </Field>
          <Field label="Immutable key" hint="Stable slug — storage path + cache key. Cannot be changed later.">
            <TextInput value={key} maxLength={32} placeholder="aashi" style={{ fontFamily: mono, fontSize: 13 }}
              onChange={e => { setKeyTouched(true); setKey(slugify(e.target.value)) }} />
          </Field>
          <Field label="Primary accent (hex)" hint="Confined to the supplier’s small credit/logo — the app accent stays ember.">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value.toUpperCase())}
                style={{ width: 46, height: 40, border: `1px solid ${C.line}`, borderRadius: 4, background: 'rgba(0,0,0,0.35)', padding: 3, cursor: 'pointer' }} />
              <TextInput value={color} maxLength={7} style={{ width: 130, fontFamily: mono, fontSize: 13 }}
                onChange={e => setColor(e.target.value.startsWith('#') ? e.target.value.toUpperCase() : `#${e.target.value.toUpperCase()}`)} />
            </div>
          </Field>
          <ErrorLine error={error} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn kind="primary" type="submit" disabled={busy || !name.trim() || key.length < 2 || !/^#[0-9A-F]{6}$/i.test(color)}>
              {busy ? 'Creating…' : 'Create brand'}
            </Btn>
            <Btn kind="ghost" onClick={() => router.push('/portal')}>Cancel</Btn>
          </div>
        </form>
      </Card>
    </>
  )
}
