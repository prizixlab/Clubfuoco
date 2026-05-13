import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validateWalletToken, userIdFromSerial } from '@/lib/wallet/token'

type Ctx = { params: Promise<{ deviceId: string; passTypeId: string; serialNumber: string }> }

// ── Authentication helper ─────────────────────────────────────────────────────

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const match = auth.match(/^ApplePass\s+(.+)$/i)
  return match ? match[1].trim() : null
}

// ── POST — register a device for updates ─────────────────────────────────────

export async function POST(req: NextRequest, { params }: Ctx) {
  const { deviceId, passTypeId, serialNumber } = await params

  // Validate auth token
  const token  = extractToken(req)
  const userId = userIdFromSerial(serialNumber)
  if (!token || !userId || !validateWalletToken(token, userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { pushToken?: string } = {}
  try { body = await req.json() } catch { /* no body */ }

  const pushToken = body.pushToken
  if (!pushToken) {
    return NextResponse.json({ error: 'pushToken required' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  const { error } = await supabase
    .from('wallet_pass_registrations')
    .upsert(
      {
        device_library_identifier: deviceId,
        push_token:                pushToken,
        pass_type_identifier:      passTypeId,
        serial_number:             serialNumber,
        user_id:                   userId,
        updated_at:                new Date().toISOString(),
      },
      { onConflict: 'device_library_identifier,serial_number' }
    )

  if (error) {
    console.error('[wallet register] upsert error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // 201 = newly registered, 200 = already existed (both are fine per Apple spec)
  return new NextResponse(null, { status: 201 })
}

// ── DELETE — unregister a device ─────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { deviceId, passTypeId, serialNumber } = await params

  const token  = extractToken(req)
  const userId = userIdFromSerial(serialNumber)
  if (!token || !userId || !validateWalletToken(token, userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  await supabase
    .from('wallet_pass_registrations')
    .delete()
    .eq('device_library_identifier', deviceId)
    .eq('pass_type_identifier',      passTypeId)
    .eq('serial_number',             serialNumber)

  return new NextResponse(null, { status: 200 })
}
