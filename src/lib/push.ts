import crypto from 'node:crypto'
import http2 from 'node:http2'
import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// APNs sender for the promoter app. Fully env-gated: until APNS_TEAM_ID /
// APNS_KEY_ID / APNS_PRIVATE_KEY are configured (Vercel env), every call is a
// silent no-op — callers never need to guard. Errors never propagate: a failed
// push must never block the review flow (mirrors notify()'s contract).
//
// Env:
//   APNS_TEAM_ID      Apple developer team (4V87UVPTBW)
//   APNS_KEY_ID       Key id of the APNs auth key (.p8)
//   APNS_PRIVATE_KEY  Contents of the .p8 (literal \n allowed)
//   APNS_TOPIC        Bundle id, defaults to com.clubfuoco.promoters

const APNS_TOPIC = process.env.APNS_TOPIC ?? 'com.clubfuoco.promoters'

interface PushMessage {
  title: string
  body?: string
  /** Custom keys delivered alongside `aps` (e.g. { type: 'review_outcome', … }). */
  payload?: Record<string, unknown>
}

function configured(): boolean {
  return Boolean(process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY)
}

// ES256 provider JWT (header.claims.signature, IEEE-P1363 signature as APNs
// expects). Regenerated per send batch — volume here is tiny.
function providerJWT(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })
  const claims = b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  const key = (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  const sig = crypto
    .sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url')
  return `${head}.${claims}.${sig}`
}

function apnsHost(environment: string): string {
  return environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
}

/** One HTTP/2 POST to APNs. Resolves to the status code (0 on transport error). */
function postToAPNs(host: string, token: string, jwt: string, body: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const client = http2.connect(host)
      client.on('error', () => { client.close(); resolve(0) })
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        'authorization': `bearer ${jwt}`,
        'apns-topic': APNS_TOPIC,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      })
      let status = 0
      req.on('response', (h) => { status = Number(h[':status'] ?? 0) })
      req.on('close', () => { client.close(); resolve(status) })
      req.on('error', () => { client.close(); resolve(0) })
      req.setTimeout(10_000, () => { req.close(); client.close(); resolve(0) })
      req.end(body)
    } catch {
      resolve(0)
    }
  })
}

/**
 * Push a message to every registered device of a user. No-op when APNs isn't
 * configured or the device_tokens table isn't applied yet (drift-defensive).
 * Dead tokens (410 Unregistered) are pruned.
 */
export async function sendPushToUser(sb: SB, userId: string, msg: PushMessage): Promise<void> {
  try {
    if (!configured()) return
    const { data: rows, error } = await sb
      .from('device_tokens')
      .select('token, environment')
      .eq('user_id', userId)
    if (error || !rows?.length) return   // table missing / no devices → nothing to do

    const jwt = providerJWT()
    const body = JSON.stringify({
      aps: { alert: { title: msg.title, body: msg.body ?? '' }, sound: 'default' },
      ...(msg.payload ?? {}),
    })

    for (const row of rows as { token: string; environment: string | null }[]) {
      const status = await postToAPNs(apnsHost(row.environment ?? 'production'), row.token, jwt, body)
      if (status === 410) {
        await sb.from('device_tokens').delete().eq('token', row.token)
      }
    }
  } catch {
    // Non-critical — never block the main flow
  }
}
