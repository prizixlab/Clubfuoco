import { NextRequest, NextResponse } from 'next/server'
import { verifyNotification, verifyTransaction, applyTransaction } from '@/lib/apple-iap'

/**
 * POST /api/webhooks/apple
 *
 * App Store Server Notifications V2 endpoint. Apple calls this for the whole
 * subscription lifecycle that happens outside the app — renewals, cancellations,
 * billing retries, refunds, expirations. The signed payload is verified against
 * Apple's certificate chain before any database change.
 *
 * Configure the URL in App Store Connect → App → App Store Server Notifications.
 */
export async function POST(request: NextRequest) {
  let signedPayload: string
  try {
    const body = await request.json()
    signedPayload = body.signedPayload
    if (!signedPayload) throw new Error('missing signedPayload')
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  let notification
  try {
    notification = await verifyNotification(signedPayload)
  } catch (e) {
    console.error('Apple notification signature verification failed:', e)
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 })
  }

  try {
    const signedTx = notification.data?.signedTransactionInfo
    if (signedTx) {
      const tx = await verifyTransaction(signedTx)

      // notificationType drives intent; applyTransaction already derives
      // active/expired from the transaction's expiry + revocation fields,
      // so renewals, expirations and refunds all converge correctly.
      // See: SUBSCRIBED, DID_RENEW, EXPIRED, DID_CHANGE_RENEWAL_STATUS,
      //      REVOKE, REFUND, GRACE_PERIOD_EXPIRED.
      await applyTransaction(tx)
    }
  } catch (e) {
    console.error('Error processing Apple notification:', notification.notificationType, e)
    // Fall through to 200 — a non-2xx makes Apple retry; we don't want
    // an internal error to cause an endless retry storm.
  }

  return NextResponse.json({ received: true })
}
