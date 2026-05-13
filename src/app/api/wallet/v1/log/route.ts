import { NextRequest, NextResponse } from 'next/server'

// POST /api/wallet/v1/log
// Apple Wallet sends diagnostic messages here. We log them and return 200.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.info('[apple wallet log]', JSON.stringify(body))
  } catch { /* ignore parse errors */ }
  return new NextResponse(null, { status: 200 })
}
