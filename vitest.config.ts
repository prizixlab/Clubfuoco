import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror the tsconfig path alias so modules that use '@/lib/…' (partner.ts
    // and friends) can be unit-tested without the Next bundler.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Only this checkout's tests. Agent worktrees are created *inside* the repo
    // at .claude/worktrees/<name>/, each a full copy of src/ — without this,
    // `npm test` here collects their tests too and the pass count silently
    // includes work from another branch (121 tests instead of 38).
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.claude/**'],
  },
})
