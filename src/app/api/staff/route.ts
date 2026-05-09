import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// GET /api/staff — admin only — list all non-user role accounts
export async function GET() {
  const { response } = await requireRole(['admin'])
  if (response) return response

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .in('role', ['staff', 'admin'])
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

// POST /api/staff — admin only — set user role by email
export async function POST(request: NextRequest) {
  const { response } = await requireRole(['admin'])
  if (response) return response

  const body = await request.json()
  const { email, role } = body

  if (!email || !role) return err('email and role are required')
  if (!['staff', 'admin', 'user'].includes(role)) return err('role must be staff, admin, or user')

  const supabase = await createServiceClient()

  const { data: user, error: findError } = await supabase
    .from('users')
    .select('id, email, role')
    .eq('email', email)
    .single()

  if (findError || !user) return err('User not found', 404)

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', user.id)
    .select('id, email, full_name, role')
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}
