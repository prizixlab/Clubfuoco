import type { createServiceClient } from '@/lib/supabase/server'
import { createOffer, updateOffer, deleteOffer, type OfferInput } from '@/lib/partner'

type SB = Awaited<ReturnType<typeof createServiceClient>>

export interface PendingChange {
  id:                string
  source:            'supplier' | 'promoter'
  submitter_user_id: string | null
  brand_id:          string | null
  action:            string
  entity:            string
  target_id:         string | null
  payload:           Record<string, unknown> | null
  summary:           string
  status:            'pending' | 'approved' | 'rejected'
  created_at:        string
  reviewed_at:       string | null
  note:              string | null
}

export async function enqueue(
  sb: SB,
  c: {
    source: 'supplier' | 'promoter'; submitter_user_id?: string | null; brand_id?: string | null
    action: string; entity: string; target_id?: string | null
    payload?: Record<string, unknown> | null; summary: string
  },
): Promise<PendingChange> {
  const { data, error } = await sb
    .from('pending_changes')
    .insert({
      source: c.source, submitter_user_id: c.submitter_user_id ?? null, brand_id: c.brand_id ?? null,
      action: c.action, entity: c.entity, target_id: c.target_id ?? null,
      payload: c.payload ?? null, summary: c.summary,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PendingChange
}

// Pending items a given submitter has waiting (shown in the app).
export async function listOwnPending(sb: SB, userId: string): Promise<PendingChange[]> {
  const { data, error } = await sb
    .from('pending_changes')
    .select('*')
    .eq('submitter_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as PendingChange[]
}

// Everything awaiting review (portal queue).
export async function listPending(sb: SB): Promise<PendingChange[]> {
  const { data, error } = await sb
    .from('pending_changes')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as PendingChange[]
}

export async function getChange(sb: SB, id: string): Promise<PendingChange | null> {
  const { data } = await sb.from('pending_changes').select('*').eq('id', id).maybeSingle()
  return (data as PendingChange | null) ?? null
}

// Apply an approved change to the live table. Offer actions use the same
// partner.ts helpers the portal uses. (night.* handled in phase 2.)
export async function applyChange(sb: SB, c: PendingChange): Promise<void> {
  switch (c.action) {
    case 'offer.create':
      if (!c.brand_id || !c.payload) throw new Error('Malformed offer.create')
      await createOffer(sb, c.brand_id, c.payload as unknown as OfferInput)
      return
    case 'offer.update':
      if (!c.target_id || !c.payload) throw new Error('Malformed offer.update')
      await updateOffer(sb, c.target_id, c.payload as Partial<OfferInput>)
      return
    case 'offer.delete':
      if (!c.target_id) throw new Error('Malformed offer.delete')
      await deleteOffer(sb, c.target_id)
      return
    default:
      throw new Error(`Don't know how to apply “${c.action}”`)
  }
}

// Enqueue for review, but if the pending_changes table isn't applied yet, fall
// back to writing the change live (the pre-approval behavior) so the app never
// breaks in the window before the migration lands. Returns whether it queued.
export async function enqueueOrApplyDirect(
  sb: SB,
  c: Parameters<typeof enqueue>[1],
): Promise<{ queued: boolean }> {
  try {
    await enqueue(sb, c)
    return { queued: true }
  } catch (e) {
    const msg = String((e as Error)?.message ?? '')
    if (/pending_changes|does not exist|relation|schema cache/i.test(msg)) {
      await applyChange(sb, {
        id: '', status: 'pending', created_at: '', reviewed_at: null, note: null,
        source: c.source, submitter_user_id: c.submitter_user_id ?? null, brand_id: c.brand_id ?? null,
        action: c.action, entity: c.entity, target_id: c.target_id ?? null, payload: c.payload ?? null,
        summary: c.summary,
      })
      return { queued: false }
    }
    throw e
  }
}

export async function markReviewed(sb: SB, id: string, status: 'approved' | 'rejected', note?: string): Promise<void> {
  const { error } = await sb
    .from('pending_changes')
    .update({ status, reviewed_at: new Date().toISOString(), note: note ?? null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
