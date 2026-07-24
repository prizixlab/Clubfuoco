import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Small key/value settings store (app_settings). Reads are DEFENSIVE: if the
// table isn't applied yet, every getter returns its default so deploying ahead
// of the migration behaves exactly like the feature being off.

export const AUTO_APPROVE = 'auto_approve_submissions'

export async function getBoolSetting(sb: SB, key: string): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('app_settings').select('value').eq('key', key).maybeSingle()
    if (error) return false
    return (data as { value?: unknown } | null)?.value === true
  } catch {
    return false
  }
}

export async function setBoolSetting(sb: SB, key: string, value: boolean): Promise<void> {
  const { error } = await sb
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}
