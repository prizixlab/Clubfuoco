import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Small key/value settings store (app_settings). Reads are DEFENSIVE: if the
// table isn't applied yet, every getter returns its default so deploying ahead
// of the migration behaves exactly like the feature being off.

export const AUTO_APPROVE = 'auto_approve_submissions'
/** Operator-chosen order of the portal roster: an array of PromoterRow ids. */
export const ROSTER_ORDER = 'portal_roster_order'

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

/**
 * Read a JSON setting. Same defensive contract as getBoolSetting: a missing
 * table or key yields the fallback rather than throwing, so an unapplied
 * migration can't take a page down.
 */
export async function getJsonSetting<T>(sb: SB, key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await sb
      .from('app_settings').select('value').eq('key', key).maybeSingle()
    if (error || !data) return fallback
    return (data.value as T) ?? fallback
  } catch {
    return fallback
  }
}

export async function setJsonSetting(sb: SB, key: string, value: unknown): Promise<void> {
  await sb
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}
