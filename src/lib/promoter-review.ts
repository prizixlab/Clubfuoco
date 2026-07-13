import type { SupabaseClient } from '@supabase/supabase-js'

// Guard for the guest-join boundary: a promoter night/series must be approved
// before its invite link works. DEFENSIVE by design — if the review_status
// column isn't applied yet (or the row is missing), it returns false (not
// blocked) so deploying this code before the migration can never break joins.
// Only an explicit 'pending' / 'rejected' blocks.

function blocked(status: unknown): boolean {
  return status === 'pending' || status === 'rejected'
}

export async function nightBlocked(sb: SupabaseClient, nightId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('promoter_nights')
    .select('review_status')
    .eq('id', nightId)
    .maybeSingle()
  if (error) return false            // column/table issue → don't block
  return blocked((data as { review_status?: unknown } | null)?.review_status)
}

export async function seriesBlocked(sb: SupabaseClient, seriesId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('promoter_series')
    .select('review_status')
    .eq('id', seriesId)
    .maybeSingle()
  if (error) return false
  return blocked((data as { review_status?: unknown } | null)?.review_status)
}

// Given an allocation id, block if its night isn't approved.
export async function allocationBlocked(sb: SupabaseClient, allocationId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('promoter_allocations')
    .select('night:promoter_nights(review_status)')
    .eq('id', allocationId)
    .maybeSingle()
  if (error || !data) return false
  const night = (data as { night?: { review_status?: unknown } | { review_status?: unknown }[] }).night
  const status = Array.isArray(night) ? night[0]?.review_status : night?.review_status
  return blocked(status)
}
