import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only this checkout's tests. Agent worktrees are created *inside* the repo
    // at .claude/worktrees/<name>/, each a full copy of src/ — without this,
    // `npm test` here collects their tests too and the pass count silently
    // includes work from another branch (121 tests instead of 38).
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.claude/**'],
  },
})
