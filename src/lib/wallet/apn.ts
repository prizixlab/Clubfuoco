import http2 from 'http2'

// Use production APN gateway. Apple Wallet passes always use production,
// even during development — there is no sandbox for pass push notifications.
const APN_HOST = 'api.push.apple.com'

/**
 * Send an empty APN push to a registered device so Apple Wallet knows
 * to fetch an updated pass from our web service.
 * The payload is intentionally empty — Apple fetches the pass on its own schedule.
 */
export async function sendPassUpdate(
  pushToken:  string,
  passTypeId: string,
): Promise<void> {
  const certB64  = process.env.APPLE_SIGNER_CERT_PEM
  const keyB64   = process.env.APPLE_SIGNER_KEY_PEM
  const passphrase = process.env.APPLE_SIGNER_KEY_PASS

  if (!certB64 || !keyB64) {
    throw new Error('Apple certificate/key not configured for APN push')
  }

  const cert = Buffer.from(certB64, 'base64').toString('utf8')
  const key  = Buffer.from(keyB64,  'base64').toString('utf8')

  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${APN_HOST}`, {
      cert,
      key,
      ...(passphrase && { passphrase }),
    })

    client.on('error', (err) => {
      reject(new Error(`APN connect error: ${err.message}`))
    })

    const payload = '{}'
    const req = client.request({
      ':method':        'POST',
      ':path':          `/3/device/${pushToken}`,
      'apns-topic':     passTypeId,
      'apns-push-type': 'background',
      'content-type':   'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    })

    req.write(payload)
    req.end()

    let statusCode = 0
    req.on('response', (headers) => {
      statusCode = headers[':status'] as number
    })

    let responseBody = ''
    req.on('data', (chunk) => { responseBody += chunk })

    req.on('end', () => {
      client.close()
      if (statusCode === 200) {
        resolve()
      } else {
        reject(new Error(`APN push failed (${statusCode}): ${responseBody}`))
      }
    })

    req.on('error', (err) => {
      client.close()
      reject(err)
    })
  })
}
