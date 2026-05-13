import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type Ctx = { params: Promise<{ deviceId: string; passTypeId: string }> }

// ── GET — list serial numbers for passes that have changed since a given date ─
//
// Apple Wallet calls this when it reconnects to check if any registered passes
// need updating. We return all active serial numbers so Wallet knows to fetch
// the latest pass from /api/wallet/v1/passes/{passTypeId}/{serialNumber}.

export async function GET(req: NextRequest, { params }: Ctx) {
  const { deviceId, passTypeId } = await params
  const since = req.nextUrl.searchParams.get('passesUpdatedSince')

  const supabase = await createServiceClient()

  let query = supabase
    .from('wallet_pass_registrations')
    .select('serial_number, updated_at')
    .eq('device_library_identifier', deviceId)
    .eq('pass_type_identifier',      passTypeId)

  if (since) {
    query = query.gte('updated_at', since)
  }

  const { data, error } = await query

  if (error) {
    console.error('[wallet list] query error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    // 204 = no updates — Apple spec says return 204 when nothing changed
    return new NextResponse(null, { status: 204 })
  }

  const serialNumbers = data.map((r) => r.serial_number)
  const lastUpdated   = data
    .map((r) => r.updated_at)
    .sort()
    .at(-1) ?? new Date().toISOString()

  return NextResponse.json({ serialNumbers, lastUpdated })
}
