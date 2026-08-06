import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import {
  authDevice, buildManifest, billableForKind, isoNoMs, type CredentialKind,
} from '@/lib/door'

interface IncomingScan {
  scan_id?: string
  action?: 'admit' | 'void'
  token_ref?: string
  count?: number
  device_time?: string
  holder_name?: string
  kind?: CredentialKind
  reason?: string | null
}

// POST /api/door/sync  { venue, date, scans[] }
// The one full-transfer endpoint (the client batches scans AND voids through it,
// rather than per-scan /scan + /void). Records every well-formed scan
// idempotently on scan_id — the same admission from a retry or a second offline
// door collapses to one row, which is where multi-door overscan is finally
// computed. Returns the refreshed, re-signed manifest + accepted ids so the app
// can prune its queue.
export async function POST(req: NextRequest) {
  const supabase = await createServiceClient()
  const device = await authDevice(supabase)
  if (!device) return err('Unauthorized', 401)

  let body: { venue?: string; date?: string; scans?: IncomingScan[] }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const date = body.date
  if (!date) return err('date required (yyyy-mm-dd)', 400)
  if (body.venue && body.venue !== device.club_id) {
    return err('Device is not enrolled for that venue', 403)
  }

  const scans = body.scans ?? []
  const accepted: string[] = []
  const rejected: string[] = []
  const rows = []

  for (const s of scans) {
    if (!s.scan_id || !s.token_ref || (s.action !== 'admit' && s.action !== 'void')) {
      if (s.scan_id) rejected.push(s.scan_id)
      continue
    }
    const kind = (s.kind ?? 'paid_entry') as CredentialKind
    rows.push({
      scan_id: s.scan_id,
      door_device_id: device.id,
      club_id: device.club_id,
      night_date: date,
      token_ref: s.token_ref,
      credential_kind: kind,
      action: s.action,
      count: Math.max(1, Math.floor(s.count ?? 1)),
      billable: billableForKind(kind),
      holder_name: s.holder_name ?? null,
      reason: s.reason ?? null,
      device_time: s.device_time ?? isoNoMs(),
    })
    accepted.push(s.scan_id)
  }

  if (rows.length) {
    // Idempotent: ignore rows whose scan_id already landed (retry / other door).
    const { error } = await supabase
      .from('admission_scans')
      .upsert(rows, { onConflict: 'scan_id', ignoreDuplicates: true })
    if (error) return err(error.message)
  }

  const manifest = await buildManifest(supabase, device.club_id, date)
  return ok({
    accepted_scan_ids: accepted,
    rejected_scan_ids: rejected,
    manifest,
  })
}
