import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/**
 * Completes a promoter signup after the email OTP is verified. Marks the
 * account as a 'promoter' kind (so it can't be used in the consumer app),
 * generates an Instagram verification code, and files the application for
 * manual review (status 'pending'). The promoter stays locked until an admin
 * confirms the DM'd code + 5k followers and sets is_promoter = true.
 */
function genCode(): string {
  // 6-char human-friendly code, no ambiguous chars.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `FUOCO-${s}`
}

export async function POST(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  const user = userResp.user
  if (!user) return err('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const instagram = typeof body.instagram === 'string' ? body.instagram.trim() : ''
  const clubs = typeof body.clubs === 'string' ? body.clubs.trim() : ''
  const experience = typeof body.experience === 'string' ? body.experience.trim() : ''
  if (!instagram) return err('Instagram handle is required', 400)

  // Mark the account as a promoter identity.
  await sb.from('users').update({ account_kind: 'promoter' }).eq('id', user.id)

  // Reuse an existing code if they're re-finalizing; else mint one.
  const { data: existing } = await sb
    .from('promoter_applications')
    .select('ig_code')
    .eq('user_id', user.id)
    .maybeSingle()
  const code = existing?.ig_code ?? genCode()

  await sb.from('promoter_applications').upsert({
    user_id: user.id,
    instagram,
    clubs: clubs || null,
    experience: experience || null,
    ig_code: code,
    ig_verified: false,
    status: 'pending',
  }, { onConflict: 'user_id' })

  return ok({ igCode: code })
}
