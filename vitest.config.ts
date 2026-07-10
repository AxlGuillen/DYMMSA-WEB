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
      // Solo la superficie con tests: funciones puras, route handlers, y los
      // componentes/hook con batería propia. Los componentes aún sin test
      // (tablas, forms, layout) quedan fuera para no falsear el porcentaje.
      include: [
        'src/lib/**',
        'src/app/api/**',
        'src/hooks/useCurrency.ts',
        'src/components/quotations/QuotationStatusBadge.tsx',
        'src/components/orders/OrderStatusBadge.tsx',
        'src/components/dashboard/MetricCard.tsx',
        'src/components/discrete-mode-toggle.tsx',
        'src/components/quoter/QuotePreview.tsx',
        'src/components/quoter/ProductModal.tsx',
        'src/components/quoter/QuotationEditor.tsx',
      ],
      // Gaps deferidos (documentados en ADR-007): parsers de Excel y factories
      // de cliente Supabase (mockeadas, no se ejercitan en unit). No cuentan.
      exclude: ['src/lib/excel/**', 'src/lib/supabase/**', 'src/lib/delivery.ts'],
      // Piso de regresión sobre el total. Actual ≈ 72/69/81/72; floors con
      // holgura para no romper ante refactors menores; subir al ampliar la batería.
      thresholds: { statements: 67, branches: 63, functions: 77, lines: 66 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/lib/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/mcp/**/*.test.ts'],
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
