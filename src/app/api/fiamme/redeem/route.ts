import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

const REWARDS: Record<string, { label: string; cost: number }> = {
  comp_drink:     { label: 'Comp drink',     cost: 100  },
  skip_line:      { label: 'Skip the line',  cost: 250  },
  free_cover:     { label: 'Free cover',     cost: 500  },
  bottle_deposit: { label: 'Bottle deposit', cost: 1000 },
}

const schema = z.object({
  reward_key: z.enum(['comp_drink', 'skip_line', 'free_cover', 'bottle_deposit']),
})

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'FUO-'
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code + '-MMXXVI'
}

// POST /api/fiamme/redeem — spend Fiamme on a reward
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const reward = REWARDS[parsed.data.reward_key]
  const supabase = await createClient()

  // Check current balance
  const { data: ledger } = await supabase
    .from('fiamme_ledger')
    .select('amount')
    .eq('user_id', user!.id)

  const balance = (ledger ?? []).reduce((sum, r) => sum + r.amount, 0)

  if (balance < reward.cost) {
    return NextResponse.json({ error: 'Insufficient Fiamme' }, { status: 400 })
  }

  const code = generateCode()

  // Insert debit entry
  const { error } = await supabase
    .from('fiamme_ledger')
    .insert({
      user_id:     user!.id,
      amount:      -reward.cost,
      type:        'redemption',
      description: `Redeemed · ${reward.label}`,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Store the redeemed code (one-use, expires 24h)
  await supabase.from('fiamme_redemptions').insert({
    user_id:    user!.id,
    code,
    reward_key: parsed.data.reward_key,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })

  return NextResponse.json({ data: { code } }, { status: 201 })
}
