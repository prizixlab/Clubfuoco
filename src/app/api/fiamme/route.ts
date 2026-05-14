import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

// GET /api/fiamme — user's balance, tier, and recent activity
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  // Ledger rows for this user
  const { data: ledger, error } = await supabase
    .from('fiamme_ledger')
    .select('id, amount, type, description, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Compute balance
  const balance = (ledger ?? []).reduce((sum, row) => sum + row.amount, 0)

  // Review count for tier computation
  const { count: reviewCount } = await supabase
    .from('booking_surveys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user!.id)

  return NextResponse.json({
    data: {
      balance:       Math.max(0, balance),
      review_count:  reviewCount ?? 0,
      activity:      ledger ?? [],
    },
  })
}
