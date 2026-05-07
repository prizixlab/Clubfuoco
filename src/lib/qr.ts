import QRCode from 'qrcode'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'

// Returns a base64 PNG data URL for embedding in <img src="...">
export async function generateQRCodeDataURL(token: string): Promise<string> {
  const verifyUrl = `${APP_URL}/verify/${token}`
  return QRCode.toDataURL(verifyUrl, {
    width:  300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

// Returns an SVG string for server-side rendering
export async function generateQRCodeSVG(token: string): Promise<string> {
  const verifyUrl = `${APP_URL}/verify/${token}`
  return QRCode.toString(verifyUrl, { type: 'svg' })
}
