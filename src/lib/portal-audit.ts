import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

export interface AuditEntry {
  id:          string
  action:      string
  summary:     string
  target_type: string | null
  target_id:   string | null
  meta:        Record<string, unknown> | null
  created_at:  string
}

// Best-effort audit write — never throws, so a logging failure (e.g. the table
// isn't applied yet) can't break the actual operation the operator performed.
export async function logAudit(
  sb: SB,
  entry: { action: string; summary: string; target_type?: string; target_id?: string; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    await sb.from('portal_audit_log').insert({
      action:      entry.action,
      summary:     entry.summary,
      target_type: entry.target_type ?? null,
      target_id:   entry.target_id ?? null,
      meta:        entry.meta ?? null,
    })
  } catch {
    // swallow — auditing is advisory, not load-bearing
  }
}

export async function listAudit(sb: SB, limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await sb
    .from('portal_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  // Tolerate the table not being applied yet — show an empty log, not an error.
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as AuditEntry[]
}
