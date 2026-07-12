import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { ok, err } from '@/lib/utils'

// GET /api/supplier/clubs — id + name for the supplier app's club picker when
// adding an offer. Auth-gated to a linked brand (same shape the portal picker
// uses), so an unlinked account can't enumerate the catalog here.
export async function GET() {
  const { sb, response } = await resolveSupplierBrand()
  if (response) return response
  const { data, error } = await sb
    .from('clubs')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) return err(error.message, 500)
  return ok(data ?? [])
}
