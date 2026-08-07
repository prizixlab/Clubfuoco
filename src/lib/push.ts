import crypto from 'node:crypto'
import http2 from 'node:http2'
import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// APNs sender for BOTH iOS apps. Fully env-gated: until APNS_TEAM_ID /
// APNS_KEY_ID / APNS_PRIVATE_KEY are configured (Vercel env), every call is a
// silent no-op — callers never need to guard. Errors never propagate: a failed
// push must never block the flow that triggered it (mirrors notify()'s
// contract).
//
// Env:
//   APNS_TEAM_ID            Apple developer team (4V87UVPTBW)
//   APNS_KEY_ID             Key id of the APNs auth key (.p8)
//   APNS_PRIVATE_KEY        Contents of the .p8 (literal \n allowed)
//   APNS_TOPIC_PROMOTERS    Promoter bundle id  (default com.clubfuoco.promoters)
//   APNS_TOPIC_APP          Consumer bundle id  (default com.clubfuoco.app)
//   APNS_TOPIC              Legacy alias for the promoter topic
//
// ONE auth key serves both bundles (same team), but the topic must match the
// receiving app exactly — APNs rejects a push whose apns-topic isn't the
// bundle that owns the token. That's why sends are scoped by `app`: a
// consumer notification sent under the promoter topic is silently dropped.

/** Which app a device token belongs to — mirrors device_tokens.app. */
export type PushApp = 'promoters' | 'clubfuoco'

function topicFor(app: PushApp): string {
  return app === 'clubfuoco'
    ? process.env.APNS_TOPIC_APP ?? 'com.clubfuoco.app'
    : process.env.APNS_TOPIC_PROMOTERS ?? process.env.APNS_TOPIC ?? 'com.clubfuoco.promoters'
}

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
function postToAPNs(host: string, token: string, jwt: string, body: string, topic: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const client = http2.connect(host)
      client.on('error', () => { client.close(); resolve(0) })
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        'authorization': `bearer ${jwt}`,
        'apns-topic': topic,
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
 * Push a message to every registered device of a user, for ONE app. No-op when
 * APNs isn't configured or the device_tokens table isn't applied yet
 * (drift-defensive). Dead tokens (410 Unregistered) are pruned.
 *
 * `app` defaults to 'promoters' so the pre-existing review-outcome caller keeps
 * its exact behaviour; consumer callers must pass 'clubfuoco'.
 */
export async function sendPushToUser(
  sb: SB,
  userId: string,
  msg: PushMessage,
  app: PushApp = 'promoters',
): Promise<void> {
  try {
    if (!configured()) return
    const { data: rows, error } = await sb
      .from('device_tokens')
      .select('token, environment')
      .eq('user_id', userId)
      .eq('app', app)
    if (error || !rows?.length) return   // table missing / no devices → nothing to do

    const jwt = providerJWT()
    const topic = topicFor(app)
    const body = JSON.stringify({
      aps: { alert: { title: msg.title, body: msg.body ?? '' }, sound: 'default' },
      ...(msg.payload ?? {}),
    })

    for (const row of rows as { token: string; environment: string | null }[]) {
      const status = await postToAPNs(apnsHost(row.environment ?? 'production'), row.token, jwt, body, topic)
      if (status === 410) {
        await sb.from('device_tokens').delete().eq('token', row.token)
      }
    }
  } catch {
    // Non-critical — never block the main flow
  }
}

export interface BroadcastResult {
  devices: number      // tokens attempted
  delivered: number    // APNs accepted (2xx)
  pruned: number       // dead tokens removed (410)
  failed: number       // everything else
  users: number        // distinct recipients
}

/** How many devices a broadcast would reach — for the portal's confirm step. */
export async function broadcastAudience(sb: SB, app: PushApp): Promise<{ devices: number; users: number }> {
  const { data, error } = await sb.from('device_tokens').select('user_id').eq('app', app)
  if (error || !data) return { devices: 0, users: 0 }
  return { devices: data.length, users: new Set(data.map(r => r.user_id)).size }
}

/**
 * Send ONE message to every registered device of an app.
 *
 * Unlike sendPushToUser this reports what happened: a broadcast is a deliberate,
 * one-shot action a human triggered, so silently swallowing failures would hide
 * a botched send from the person who pressed the button.
 *
 * Sent in bounded batches rather than all at once — a few thousand simultaneous
 * HTTP/2 connections would exhaust sockets and get throttled by APNs. Dead
 * tokens (410) are pruned as we go, which keeps the audience honest over time.
 */
export async function broadcastPush(
  sb: SB,
  msg: PushMessage,
  app: PushApp,
  opts: { batchSize?: number } = {},
): Promise<BroadcastResult> {
  const result: BroadcastResult = { devices: 0, delivered: 0, pruned: 0, failed: 0, users: 0 }
  if (!configured()) return result

  const { data: rows, error } = await sb
    .from('device_tokens')
    .select('token, environment, user_id')
    .eq('app', app)
  if (error || !rows?.length) return result

  const list = rows as { token: string; environment: string | null; user_id: string }[]
  result.devices = list.length
  result.users = new Set(list.map(r => r.user_id)).size

  const jwt = providerJWT()
  const topic = topicFor(app)
  const body = JSON.stringify({
    aps: { alert: { title: msg.title, body: msg.body ?? '' }, sound: 'default' },
    ...(msg.payload ?? {}),
  })

  const batchSize = opts.batchSize ?? 50
  const dead: string[] = []

  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize)
    const statuses = await Promise.all(
      batch.map(r => postToAPNs(apnsHost(r.environment ?? 'production'), r.token, jwt, body, topic)),
    )
    statuses.forEach((status, j) => {
      if (status >= 200 && status < 300) result.delivered++
      else if (status === 410) { result.pruned++; dead.push(batch[j].token) }
      else result.failed++
    })
  }

  if (dead.length) {
    // Chunked: a single .in() with thousands of tokens overflows the URL.
    for (let i = 0; i < dead.length; i += 100) {
      await sb.from('device_tokens').delete().in('token', dead.slice(i, i + 100))
    }
  }
  return result
}
