// ─────────────────────────────────────────────────────────────────────────────
// check-credentials.mjs — is the partner-credential store live and correct?
//
//   node --env-file=.env.local scripts/check-credentials.mjs
//
// Runs against the REAL Supabase, because the thing worth proving is not that
// AES works (a unit test covers that) but that a key written through our code
// comes back out of the actual database, encrypted in between.
//
// The round-trip writes to a reserved platform-level slot and deletes it again,
// so it never touches a real promoter's credential.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MASTER = process.env.CREDENTIAL_MASTER_KEY

const ok = s => console.log(`  \x1b[32m✓\x1b[0m ${s}`)
const no = s => console.log(`  \x1b[31m✗\x1b[0m ${s}`)
const info = s => console.log(`    ${s}`)

if (!URL || !KEY) {
  no('Missing Supabase env. Run with --env-file=.env.local')
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
let failures = 0

console.log('\nEnvironment')
if (!MASTER) {
  no('CREDENTIAL_MASTER_KEY is not set')
  failures++
} else if (Buffer.from(MASTER, 'base64').length !== 32) {
  no(`CREDENTIAL_MASTER_KEY is ${Buffer.from(MASTER, 'base64').length} bytes, needs 32`)
  failures++
} else {
  ok('CREDENTIAL_MASTER_KEY present and 32 bytes')
}

console.log('\nSchema')
const TABLES = ['partner_credentials', 'partner_credential_secrets', 'credential_intake_tokens']
let schemaOk = true
for (const t of TABLES) {
  const { error } = await sb.from(t).select('*').limit(1)
  if (error) {
    no(`${t} — ${error.message}`)
    schemaOk = false
    failures++
  } else {
    ok(t)
  }
}

if (!schemaOk) {
  console.log('\n  Apply supabase/migrations/20260918_partner_credentials.sql in the')
  console.log('  Supabase SQL editor, then run this again.\n')
  process.exit(1)
}

// ── Round trip ───────────────────────────────────────────────────────────────
// Mirrors src/lib/credentials.ts. Kept as its own copy rather than importing the
// TypeScript: this script must be runnable with plain node, and the point is to
// prove the DATABASE path, not to re-test the library's internals.
console.log('\nRound trip')
const master = Buffer.from(MASTER, 'base64')
const seal = plain => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', master, iv)
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
  return { iv: iv.toString('hex'), ciphertext: out.toString('hex') }
}
const open = (iv, ct) => {
  const buf = Buffer.from(ct, 'hex')
  const d = crypto.createDecipheriv('aes-256-gcm', master, Buffer.from(iv, 'hex'))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')
}

const probe = `selftest_${crypto.randomBytes(12).toString('hex')}`
let credId = null
try {
  const { data: row, error: insErr } = await sb
    .from('partner_credentials')
    .insert({
      owner_type: 'platform', owner_id: null,
      provider: 'fourvenues', kind: 'channel_manager',
      label: 'self-test (delete me)',
      fingerprint: crypto.createHash('sha256').update(probe).digest('hex'),
      last4: probe.slice(-4), status: 'pending',
    })
    .select('id, last4, status')
    .single()
  if (insErr) throw new Error(`metadata insert: ${insErr.message}`)
  credId = row.id
  ok('wrote credential metadata')

  const { iv, ciphertext } = seal(probe)
  const { error: secErr } = await sb
    .from('partner_credential_secrets')
    .insert({ credential_id: credId, iv, ciphertext })
  if (secErr) throw new Error(`secret insert: ${secErr.message}`)
  ok('wrote encrypted secret')

  // The guarantee: the plaintext is nowhere in the stored row.
  const { data: stored } = await sb
    .from('partner_credential_secrets')
    .select('iv, ciphertext').eq('credential_id', credId).single()
  if (stored.ciphertext.includes(probe)) {
    no('plaintext found in the stored ciphertext')
    failures++
  } else {
    ok('stored ciphertext does not contain the key')
  }

  const back = open(stored.iv, stored.ciphertext)
  if (back === probe) ok('decrypted back to the original key')
  else { no(`decrypt mismatch: got ${back}`); failures++ }

  // The metadata table must not leak the secret to a bare select.
  const { data: meta } = await sb
    .from('partner_credentials').select('*').eq('id', credId).single()
  if (JSON.stringify(meta).includes(probe)) {
    no('the key appears in partner_credentials — it must live only in the secrets table')
    failures++
  } else {
    ok('select * on partner_credentials returns no secret')
  }

  // The partial unique index: one live row per owner+provider+kind.
  const { error: dupErr } = await sb.from('partner_credentials').insert({
    owner_type: 'platform', owner_id: null,
    provider: 'fourvenues', kind: 'channel_manager',
    label: 'self-test duplicate', status: 'pending',
  })
  if (dupErr) ok('duplicate live credential rejected by the unique index')
  else { no('a second live credential was accepted — the unique index is missing'); failures++ }
} catch (e) {
  no(e.message)
  failures++
} finally {
  if (credId) {
    // Cascade removes the secret row with it.
    await sb.from('partner_credentials').delete().eq('id', credId)
    await sb.from('partner_credentials')
      .delete().eq('label', 'self-test duplicate').eq('owner_type', 'platform')
    info('cleaned up the self-test rows')
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll good — the credential store is live.\x1b[0m\n'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
