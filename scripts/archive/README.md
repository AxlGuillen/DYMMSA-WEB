# Archivo histórico — Fase 0 (migración inicial)

Scripts one-shot y datos fuente usados **una sola vez** para poblar la BD al inicio
del proyecto (junio 2026). Se conservan como referencia, **no se mantienen**:
están excluidos del lint (`eslint.config.mjs`) y sus rutas internas (`inputs/...`)
ya no existen — si algún día se re-ejecutan, ajustar rutas primero.

- `migrate-initial-data.ts` — carga inicial de `etm_products` desde el Excel
- `run-migration.ts` — runner de la migración inicial
- `DB-ETM-v1.xlsm` — el Excel fuente original
