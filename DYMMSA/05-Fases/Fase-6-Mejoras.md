# Fase 6: Mejoras y Optimización 🔄

> **Módulos mejorados:** [[03-Modulos/Cotizador]], [[03-Modulos/Ordenes]], [[03-Modulos/Inventario]], [[03-Modulos/Dashboard]]  
> **ADRs implementados:** [[04-Decisiones-Tecnicas/ADR-001-Separadores]], [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]], [[04-Decisiones-Tecnicas/ADR-003-sort_order]], [[04-Decisiones-Tecnicas/ADR-005-Modo-Discreto]], [[04-Decisiones-Tecnicas/ADR-006-Refactor-Utils-Phase-0]], [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing]], [[04-Decisiones-Tecnicas/ADR-009-Errores-Descriptivos]], [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]  
> **Changelog:** [[06-Changelog/2026-04]] · [[06-Changelog/2026-05]] · [[06-Changelog/2026-06]]

**Estado:** En curso (desde 2026-04)

## UX y UI completados ✅

- Stats cards con filtros activos en Cotizaciones, Órdenes e Inventario.
- `QuotationStatusBadge` y `OrderStatusBadge` con punto de color por estado.
- `QuotationDetail`: sort arrows en cabeceras, filter cards por estado/color.
- `OrderDetail`: header reestructurado, tarjetas resumen mejoradas.
- `QuotationsTable` / `OrdersTable`: columna `name` como título principal, `customer_name` secundario, conteo de ítems, fechas relativas.
- `InventoryTable`: sort por cantidad, resaltado de filas, fechas relativas.
- Catálogo ETM: ordenamiento por columnas.
- Dialog de confirmación al cerrar sesión (Navbar y Sidebar).

## Campo `name` en Cotizaciones y Órdenes ✅

- `name` obligatorio al crear cotización; se propaga a la orden al convertir.
- Buscable en listados.
- Título principal en `QuotationDetail` y `OrderDetail`.
- Migración: `20260321010344` + `20260321010959`.

## Separadores ✅

- Filas separadoras con etiqueta editable en `QuotationEditor`.
- Renderizados como divisores en `QuotationDetail`, `ApprovalClient`, `OrderDetail`.
- Copiados a `order_items` al crear orden preservando posición.
- Excluidos de totales, auto-learn, conteos, aprobación, Excels.
- Migración: `20260330002338`.

## ETM editable y códigos DYMMSA ✅

- ETM editable en `ProductModal` con validación de unicidad.
- Productos sin ETM → `DYMMSA-TEMP-{n}` durante parseo.
- `GET /api/products/next-dymmsa-code` para código permanente.
- Auto-learn no asigna brand URREA sin model_code.
- Ítems sin model_code resaltados en gris con leyenda.

## sort_order en order_items ✅

- Campo `sort_order` preserva orden de entrada al crear orden desde cotización.
- Ítems manuales: `max(sort_order) + 1`.
- `OrderDetail` ordenado por `sort_order`.
- Migraciones: `20260401042130` + `20260401050143`.

## Rename de estados de orden ✅

- Migración `20260409055423`: estados renombrados a genéricos.
- `pending_urrea_order` → `ordered`
- `received_from_urrea` → `received`
- `pending_payment` → `delivered`
- `paid` → (eliminado / fusionado)
- `completed` → `completed`
- `cancelled` → `cancelled`

## Modo Discreto ✅

> 2026-05-07 · [[04-Decisiones-Tecnicas/ADR-005-Modo-Discreto]]

Toggle global para ocultar todos los valores monetarios en las páginas autenticadas, sin afectar la página pública de aprobación de clientes.

- `discreteModeStore` (Zustand + persist) — estado global persistido en `localStorage`.
- `useCurrency()` — hook que devuelve una función formateadora; retorna `$•,•••.••` en modo activo o el valor real (`es-MX`, 2 decimales) en modo normal.
- `DiscreteModeToggle` (Eye/EyeOff) añadido al footer del Sidebar junto a ThemeToggle.
- Implementado en 8 componentes autenticados. `ApprovalClient` excluido intencionalmente.
- Eliminada función local `formatCurrency` en `DashboardMetrics`; formato centralizado en el hook.

## Dashboard — Filtro "Todo" ✅

> 2026-05-16

Agregado un cuarto preset `'all'` al segmented control del dashboard para ver métricas históricas completas.

- `DashboardMetrics.tsx` — `Preset = '7d' | '30d' | 'month' | 'all'`
- `getPresetRange('all')` retorna `from = new Date(0)` (Unix epoch).
- El input de fecha "desde" queda vacío cuando "Todo" está activo.

## Refactor Fase 0 — Utilidades en `src/lib/*` ✅

> 2026-05-16 · [[04-Decisiones-Tecnicas/ADR-006-Refactor-Utils-Phase-0]]

Preparación para Fase 1 de QA. Extracción de lógica duplicada a 5 módulos puros, sin cambios de comportamiento.

- `format.ts` — fechas, strings, números (8 funciones puras)
- `business-rules.ts` — separadores, totales, allocation, invariantes (9 funciones puras)
- `api-helpers.ts` — `requireAuth()` aplicado a 15 routes
- `inventory.ts` — `computeRestoration` (pura) + `restoreOrderInventory` (DB)
- `auto-learn.ts` — `mergeEtmFields`/`computeNewEtmFields` (puras) + `processAutoLearn` (orchestración)

Resultado: **-315 líneas netas**, 25 archivos tocados, 5 commits atómicos en `stg`.

## Fix — UI sync al editar cotización aprobada ✅

> 2026-05-16

Tras guardar una cotización en `approved`, los badges de aprobación caían a "Pendiente" hasta recargar.

- Causa: el route hace DELETE+INSERT regenerando IDs, pero el `useEffect` en `QuotationDetail.tsx` solo dependía de `[quotation.id]`, por lo que `localItems` retenía los IDs viejos.
- Fix: agregar `itemsSignature` (string con todos los IDs concatenados) como dep del useEffect.

**Archivo:** `src/components/quotations/QuotationDetail.tsx` L417-426

## Claude PR Reviewer ✅

> 2026-05-17

GitHub Action que revisa automáticamente cada PR contra las reglas de negocio del proyecto.

- `.github/workflows/claude.yml` con `anthropics/claude-code-action@v1`
- Trigger automático en `pull_request` (opened, synchronize, reopened)
- Prompt con stack, 10 reglas de negocio críticas y módulos `src/lib/`
- Tres niveles: 🔴 bloqueante · 🟡 advertencia · 🟢 sugerencia
- `use_sticky_comment`: un comment consolidado por PR, se actualiza en cada push
- `@claude` disponible en comentarios para consultas on-demand

## Testing — Vitest + mock de Supabase ✅

> 2026-05-25 (inicial) · **2026-05-26 migrado a Vitest** · [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing]]

Fase 1 y 2 de QA. Runner único **Vitest** (`vitest.config.ts`), entornos `node` (backend) y `jsdom` (componentes). La primera iteración usó `bun:test`; se migró a Vitest para unificar componentes + backend en un solo runner.

- **Fase 1 — funciones puras** (`tests/lib/*`, 104 tests): format, business-rules, auto-learn, inventory.
- **Fase 2 — route handlers** (`tests/api/*`, 73 tests): handlers reales con Supabase mockeado vía `tests/helpers/supabase-mock.ts`. Smoke, auth-guards (18 rutas → 401), quotations, orders, imports (con `.xlsx` real).
- **Batería de componentes** (`tests/components/*`, jsdom + Testing Library, 2026-05-27): badges, MetricCard, useCurrency, DiscreteModeToggle, QuotePreview (presentacional/estado); ProductModal, QuotationEditor (interactivos); QuotationDetail (toggle de aprobación ✓/✗ con hooks mockeados). DnD y flujos completos → E2E.
- Reglas de negocio críticas cubiertas: separadores excluidos, deducción de stock al crear orden, rollback, preservación de `is_approved`, auto-learn URREA, `requireAuth`, invariante de allocation.
- Scripts: `bun run test` / `test:watch` / `test:coverage`. ⚠️ Usar `bun run test`, no `bun test`.

Resultado: **226 tests, 0 fallos** (~5 s). Coverage de la superficie con tests ≈ 72% stmts.

## Cambio manual de estado + reapertura de cotizaciones ✅

> 2026-06-10 · [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]

Dropdown de estado en `QuotationDetail` (`PATCH /api/quotations/[id]/status`) para mover la
cotización entre los 4 estados no terminales y retrabajarla sin recrearla.

- `converted_to_order` no es destino manual; reabrir una convertida exige **eliminar** la
  orden (restaura inventario, garantiza ≤1 orden por cotización).
- Cada cambio de estado **regenera `approval_token`** → el link de aprobación viejo muere (404).
- `PATCH /update` preserva `is_approved` en **todos** los estados → al reabrir y agregar
  ítems nuevos, los aprobados se conservan y el cliente solo decide los nuevos.
- Dropdown deshabilitado con cambios sin guardar (`isDirty`) y con orden vinculada (tooltip + hint).
- `src/lib/quotation-status.ts` (labels + estados manuales), `useChangeQuotationStatus`.

## Errores descriptivos al guardar / convertir ✅

> 2026-05-27 · [[04-Decisiones-Tecnicas/ADR-009-Errores-Descriptivos]]

Defensa en 4 capas: pre-flight en cliente (`quotation-validation.ts`), parseo de
`PostgrestError` (`supabase-errors.ts` → ETM ofensor + 400 vs 500), `auto-learn` aislado
(warning en vez de 500), `ApiError`/`fetchJson` (401/red), y highlight + scroll a la fila.

## Performance del editor (Fase 1) ✅

> 2026-05-27

`QuotationEditor`: `React.memo` + `useCallback` + `useMemo(itemIds)` + selectores slice de
Zustand + commit-on-blur en el input de separador. Borrar/editar 1 fila en una lista de 1000
deja de re-renderizar las otras 999. Mismo patrón aplicado a `QuotationDetail` (`displayItemIds`).

## Fix — límite de filas de PostgREST (>1000 ítems) ✅

> 2026-06-09

Las queries con relación embebida (`quotation_items(*)`, `order_items`) usaban el default de
PostgREST (1000) → truncaban cotizaciones/órdenes grandes y al re-guardar se perdían ítems.
Fix: `.limit(5000)` en todas las lecturas server-side + el global "Max rows" subido a 5000 en
Supabase (Data API). Defensa en profundidad.

## Página de Novedades (changelog en la app) ✅

> 2026-06-09

`CHANGELOG.md` (raíz, lenguaje de usuario) renderizado como línea de tiempo en
`/dashboard/changelog` (parser puro `src/lib/changelog.ts`, sin dependencias nuevas). Botón
"Novedades" en el Sidebar. La bóveda `06-Changelog/` sigue siendo el detalle técnico.

## Pendiente / Próximo

- **Segunda batería de componentes**: tablas de datos (QuotationsTable/OrdersTable/InventoryTable), formularios e importadores.
- **E2E** con Playwright: drag&drop (reorder) y flujos completos (send → approve → convert). Entorno de BD por decidir.
- **Integration tests** de route handlers contra Supabase local/branch (constraints, RLS, triggers reales).
- **E2E** con Playwright (entorno de BD por decidir).
- Tests de los parsers de Excel en `src/lib/excel/*`.
- **Editar en `sent_for_approval` invalida los IDs que ve el cliente** (a evaluar): `canEdit` ya incluye `sent_for_approval` (Fase 5.5) y el dropdown de estado lo hace alcanzable. `PATCH /update` hace DELETE+INSERT → regenera los IDs de `quotation_items`. Si el cliente tiene el link abierto y envía decisiones, `POST /approve/[token]` actualiza por IDs obsoletos (no matchean → silencioso). Nota: el cambio de **estado** sí regenera el token (mata el link), pero **editar/guardar sin cambiar estado no**. Opciones: (a) regenerar token también en `update` cuando el estado es `sent_for_approval`, o (b) que `approve` resuelva por ETM/sort_order en vez de id. Pendiente de decisión.
- **Gaps menores del cambio de estado** ([[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]): sin historial/auditoría de cambios de estado; el dropdown permite saltar a `approved` manualmente (mitigado: `orders/create` bloquea sin aprobados); sin control por rol; sin test de componente del dropdown/tooltip.
