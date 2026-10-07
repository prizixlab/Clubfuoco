import { createServiceClient } from '@/lib/supabase/server'
import { resolveIntakeToken } from '@/lib/credential-intake'
import CredentialIntakeClient from './_client'

/**
 * Where a partner hands us an API key.
 *
 * Public by design: the recipient has no Club Fuoco account, and the single-use
 * token in the URL is the authentication. Server-resolves the token so an
 * expired or already-used link shows an honest dead end instead of a form that
 * fails on submit.
 *
 * force-dynamic because a link's validity changes the moment it is used, and a
 * cached "still valid" page would invite a second submission.
 */
export const dynamic = 'force-dynamic'

const PROVIDER_LABEL: Record<string, string> = { fourvenues: 'Fourvenues' }

export default async function CredentialIntakePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const sb = await createServiceClient()
  const ctx = await resolveIntakeToken(sb, token)

  return (
    <CredentialIntakeClient
      token={token}
      valid={!!ctx}
      providerLabel={ctx ? (PROVIDER_LABEL[ctx.provider] ?? ctx.provider) : 'Fourvenues'}
      displayName={ctx?.displayName ?? null}
      expiresAt={ctx?.expiresAt ?? null}
    />
  )
}
