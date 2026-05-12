import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServiceClient()
  const { error } = await supabase.rpc('exec_migration' as any, {
    sql: `
      ALTER TABLE booking_surveys
        ADD COLUMN IF NOT EXISTS drink_kinds  jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS other_drinks text  NOT NULL DEFAULT '';
    `
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
