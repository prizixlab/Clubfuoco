import { brandOrNull } from '@/lib/supplier-auth'
import { ok, err } from '@/lib/utils'

// GET /api/supplier/clubs — id + name for the club picker when adding a
// public offer. Any signed-in promoter may pick a venue (the brand is
// provisioned on their first offer), so this is auth-gated but not
// brand-gated.
export async function GET() {
  const { sb, response } = await brandOrNull()
  if (response) return response
  const { data, error } = await sb
    .from('clubs')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) return err(error.message, 500)
  return ok(data ?? [])
}
