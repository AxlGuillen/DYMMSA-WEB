import { defineConfig } from 'vitest/config'

// Tests de INTEGRACIÓN (Fase C1): route handlers reales contra el Supabase
// LOCAL (`bunx supabase start`). Config SEPARADA a propósito — NO entra en
// `bun run check` ni en el CI (que no tienen el stack local). Se corre a mano:
//   bun run test:integration
// Requiere: supabase start corriendo + fixtures del seed (db reset los aplica).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Sin paralelismo entre archivos: comparten la BD local; el reset por test
    // (resetDb en beforeEach) asume que no hay otro archivo mutando en paralelo.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
