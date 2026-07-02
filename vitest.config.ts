import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Integration tests hit the live Supabase project sequentially —
    // the bidding engine relies on row locks (FOR UPDATE) that make
    // concurrent test files racing the same fixtures unreliable.
    fileParallelism: false,
  },
})
