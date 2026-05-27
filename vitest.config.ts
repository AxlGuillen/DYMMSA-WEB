import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Runner único del proyecto, dos entornos:
//   - unit:       node   → tests/lib + tests/api (handlers con Supabase mockeado)
//   - components: jsdom  → tests/components (React 19 + Testing Library)
// El alias `@/` → `src/` se resuelve nativamente desde tsconfig.json.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/lib/**/*.test.ts', 'tests/api/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/components/setup.ts'],
        },
      },
    ],
  },
})
