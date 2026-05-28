import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Runner único del proyecto, dos entornos:
//   - unit:       node   → tests/lib + tests/api (handlers con Supabase mockeado)
//   - components: jsdom  → tests/components (React 19 + Testing Library)
// El alias `@/` → `src/` se resuelve nativamente desde tsconfig.json.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Cobertura acotada a lo que la suite cubre hoy (funciones puras + handlers).
    // Excluye componentes (solo smoke por ahora) para no falsear el porcentaje.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/app/api/**'],
      // Gaps deferidos (documentados en ADR-007): parsers de Excel y factories
      // de cliente Supabase (mockeadas, no se ejercitan en unit). No cuentan.
      exclude: ['src/lib/excel/**', 'src/lib/supabase/**', 'src/lib/delivery.ts'],
      // Piso de regresión sobre el total (lib + api). Actual ≈ 68/63/81/68;
      // floors con holgura para no romper ante refactors menores. Subir al
      // agregar la batería de componentes / tests de los routes con baja cobertura.
      thresholds: { statements: 64, branches: 58, functions: 75, lines: 63 },
    },
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
