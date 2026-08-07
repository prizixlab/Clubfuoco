'use client'

import { useEffect, useState } from 'react'
import {
  C, caps, font, serif, mono, api, Btn, Card, Field, TextInput,
  SectionLabel, ErrorLine, Modal, StatTile,
} from '../_ui'

type App = 'clubfuoco' | 'promoters'
interface Audience { devices: number; users: number }
interface SendResult { devices: number; delivered: number; pruned: number; failed: number; users: number }

const TITLE_MAX = 60
const BODY_MAX = 180

export default function NotificationsPage() {
  const [app, setApp] = useState<App>('clubfuoco')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Record<App, Audience> | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void loadAudience() }, [])

  async function loadAudience() {
    try {
      setAudience(await api<Record<App, Audience>>('/api/portal/notifications'))
    } catch {
      setError('Could not load the audience size.')
    }
  }

  const reach = audience?.[app]
  const canSend = title.trim().length > 0 && title.length <= TITLE_MAX && body.length <= BODY_MAX

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await api<SendResult>('/api/portal/notifications', {
        method: 'POST',
        body: JSON.stringify({ app, title: title.trim(), body: body.trim() }),
      })
      setResult(r)
      setConfirming(false)
      setTitle(''); setBody('')
      void loadAudience()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.')
      setConfirming(false)
    }
    setSending(false)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 24px 80px', fontFamily: font }}>
      <h1 style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 30, color: C.goldHi, margin: '0 0 6px' }}>
        Notifications
      </h1>
      <p style={{ color: C.dim, fontSize: 13, margin: '0 0 24px', lineHeight: 1.55 }}>
        Sends one push to every registered device. There is no undo, no schedule
        and no targeting — treat it as an announcement to your whole audience.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
        <StatTile label="Devices" value={reach ? reach.devices.toLocaleString() : '—'} />
        <StatTile label="People" value={reach ? reach.users.toLocaleString() : '—'} />
      </div>

      <Card>
        <SectionLabel>Audience</SectionLabel>
        <div style={{ display: 'flex', gap: 8, margin: '10px 0 20px' }}>
          {(['clubfuoco', 'promoters'] as App[]).map(a => (
            <button key={a} onClick={() => setApp(a)} style={{
              ...caps, cursor: 'pointer', borderRadius: 8, padding: '9px 14px',
              letterSpacing: '0.12em',
              background: app === a ? C.gold : 'transparent',
              color: app === a ? '#141416' : C.dim,
              border: `1px solid ${app === a ? C.gold : C.line}`,
            }}>
              {a === 'clubfuoco' ? 'Club Fuoco app' : 'Promoters app'}
              {audience && (
                <span style={{ marginLeft: 8, fontFamily: mono, letterSpacing: 0, opacity: 0.75 }}>
                  {audience[a].devices}
                </span>
              )}
            </button>
          ))}
        </div>

        <Field label="Title" hint={`${title.length}/${TITLE_MAX}`}>
          <TextInput
            value={title}
            maxLength={TITLE_MAX}
            placeholder="New offers available"
            onChange={e => setTitle(e.target.value)}
          />
        </Field>

        <Field label="Message" hint={`${body.length}/${BODY_MAX} · optional`}>
          <textarea
            value={body}
            maxLength={BODY_MAX}
            rows={3}
            placeholder="Tonight's guestlists just opened at 12 venues."
            onChange={e => setBody(e.target.value)}
            style={{
              width: '100%', background: '#131315', color: C.text, fontFamily: font,
              fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 8,
              padding: '11px 12px', resize: 'vertical', outline: 'none',
            }}
          />
        </Field>

        {/* Lock-screen preview — what the message will actually look like */}
        <div style={{ margin: '18px 0 6px' }}>
          <SectionLabel>Preview</SectionLabel>
          <div style={{
            marginTop: 10, background: 'rgba(255,255,255,0.07)', borderRadius: 14,
            padding: '12px 14px', display: 'flex', gap: 11, alignItems: 'flex-start',
            border: `1px solid ${C.line}`,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(140deg,#21120b,#832e22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: serif, fontStyle: 'italic', color: '#F3EBDB', fontSize: 17,
            }}>F</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>
                {title.trim() || 'Title'}
              </div>
              <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.4 }}>
                {body.trim() || 'Message body'}
              </div>
            </div>
          </div>
        </div>

        <ErrorLine error={error} />

        <div style={{ marginTop: 18 }}>
          <Btn kind="primary" wide disabled={!canSend} onClick={() => setConfirming(true)}>
            Submit notification
          </Btn>
        </div>
      </Card>

      {result && (
        <Card style={{ marginTop: 18 }}>
          <SectionLabel>Last send</SectionLabel>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <StatTile label="Delivered" value={result.delivered.toLocaleString()} />
            <StatTile label="Failed" value={result.failed.toLocaleString()} />
            <StatTile label="Stale removed" value={result.pruned.toLocaleString()} />
          </div>
          {result.delivered === 0 && result.devices === 0 && (
            <p style={{ color: C.dim, fontSize: 12.5, marginTop: 12 }}>
              No devices registered for that app yet — nothing was sent.
            </p>
          )}
        </Card>
      )}

      {confirming && (
        <Modal title="Send this notification?" onClose={() => setConfirming(false)}>
          <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
            This goes to <strong style={{ color: C.text }}>
              {reach ? reach.devices.toLocaleString() : '—'} device{reach?.devices === 1 ? '' : 's'}
            </strong>{reach ? <> ({reach.users.toLocaleString()} {reach.users === 1 ? 'person' : 'people'})</> : null} on the{' '}
            <strong style={{ color: C.text }}>
              {app === 'clubfuoco' ? 'Club Fuoco' : 'Promoters'}
            </strong> app, immediately. It can&apos;t be recalled.
          </p>
          <div style={{
            background: '#131315', border: `1px solid ${C.line}`, borderRadius: 10,
            padding: '12px 14px', marginBottom: 18,
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>{title.trim()}</div>
            {body.trim() && (
              <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.4, marginTop: 2 }}>{body.trim()}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn onClick={() => setConfirming(false)} disabled={sending}>Cancel</Btn>
            <Btn kind="primary" onClick={send} disabled={sending}>
              {sending ? 'Sending…' : 'Yes, send it'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
