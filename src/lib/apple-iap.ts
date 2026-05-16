/**
 * Apple IAP — server-side verification of StoreKit 2 signed transactions
 * and App Store Server Notifications V2, using Apple's official
 * `@apple/app-store-server-library`.
 *
 * The device is never trusted: every JWS the app sends is verified against
 * Apple's certificate chain here before a membership tier is granted.
 *
 * Required environment variables:
 *   APPLE_IAP_BUNDLE_ID        — e.g. com.clubfuoco.app
 *   APPLE_IAP_APP_APPLE_ID     — numeric App Store app ID (App Store Connect → App Information)
 *   APPLE_ROOT_CERTS_BASE64    — comma-separated base64 of Apple root CA .cer files
 *                                (download from https://www.apple.com/certificateauthority/)
 */
import {
  SignedDataVerifier,
  Environment,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import { tierForProductId, type PaidTier } from '@/lib/membership'
import { createServiceClient } from '@/lib/supabase/server'
import { pushWalletUpdate } from '@/lib/wallet/push'

const BUNDLE_ID    = process.env.APPLE_IAP_BUNDLE_ID ?? 'com.clubfuoco.app'
const APP_APPLE_ID = Number(process.env.APPLE_IAP_APP_APPLE_ID ?? '0') || undefined

function rootCerts(): Buffer[] {
  const raw = process.env.APPLE_ROOT_CERTS_BASE64
  if (!raw) throw new Error('APPLE_ROOT_CERTS_BASE64 is not configured')
  return raw.split(',').map(s => Buffer.from(s.trim(), 'base64'))
}

// One verifier per environment — Sandbox builds and TestFlight use Sandbox,
// App Store releases use Production. We try Production first, then Sandbox.
let _verifiers: Record<'prod' | 'sandbox', SignedDataVerifier> | null = null

function verifiers() {
  if (!_verifiers) {
    const certs = rootCerts()
    _verifiers = {
      prod:    new SignedDataVerifier(certs, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
      sandbox: new SignedDataVerifier(certs, true, Environment.SANDBOX,    BUNDLE_ID, APP_APPLE_ID),
    }
  }
  return _verifiers
}

/** Verify a signed StoreKit 2 transaction JWS, trying Production then Sandbox. */
export async function verifyTransaction(jws: string): Promise<JWSTransactionDecodedPayload> {
  const v = verifiers()
  try {
    return await v.prod.verifyAndDecodeTransaction(jws)
  } catch {
    return await v.sandbox.verifyAndDecodeTransaction(jws)
  }
}

/** Verify an App Store Server Notification V2 signed payload. */
export async function verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  const v = verifiers()
  try {
    return await v.prod.verifyAndDecodeNotification(signedPayload)
  } catch {
    return await v.sandbox.verifyAndDecodeNotification(signedPayload)
  }
}

/**
 * Apply a verified transaction to the database — the single place membership
 * state is written. Called by both the verify endpoint and the Apple webhook.
 *
 * @param userId  Supabase user id. Required for first-time grants; on renewals
 *                from the webhook we look the user up by originalTransactionId.
 */
export async function applyTransaction(
  tx: JWSTransactionDecodedPayload,
  userId?: string,
): Promise<{ tier: PaidTier | 'free'; active: boolean } | null> {
  const productId = tx.productId
  if (!productId) return null

  const tier = tierForProductId(productId)
  if (!tier) return null  // not a membership product — ignore

  const supabase = await createServiceClient()
  const originalTxId = tx.originalTransactionId ?? ''

  // Expiry / revocation check — StoreKit gives ms epoch timestamps.
  const expiresMs = tx.expiresDate ?? 0
  const revoked   = !!tx.revocationDate
  const active    = !revoked && expiresMs > Date.now()

  // Resolve the user: explicit (first purchase) or by original transaction id (renewals).
  let resolvedUserId = userId
  if (!resolvedUserId && originalTxId) {
    const { data } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('apple_original_transaction_id', originalTxId)
      .single()
    resolvedUserId = data?.user_id
  }
  if (!resolvedUserId) return null  // cannot attribute this transaction

  await supabase
    .from('memberships')
    .upsert(
      {
        user_id:                       resolvedUserId,
        tier,
        status:                        active ? 'active' : 'cancelled',
        provider:                      'apple',
        apple_original_transaction_id: originalTxId,
        apple_product_id:              productId,
        current_period_end:            expiresMs ? new Date(expiresMs).toISOString() : null,
        valid_from:                    new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

  // Reflect tier on the user row + assign a sequential member number once.
  const { data: existing } = await supabase
    .from('users')
    .select('member_number')
    .eq('id', resolvedUserId)
    .single()

  const updates: Record<string, unknown> = {
    membership_tier: active ? tier : 'free',
  }
  if (active && !existing?.member_number) {
    const { data: num } = await supabase.rpc('next_member_number')
    if (num != null) updates.member_number = num
  }
  await supabase.from('users').update(updates).eq('id', resolvedUserId)

  void pushWalletUpdate(resolvedUserId)

  return { tier: active ? tier : 'free', active }
}
