# Fase 6: Mejoras y Optimización 🔄

> **Módulos mejorados:** [[03-Modulos/Cotizador]], [[03-Modulos/Ordenes]], [[03-Modulos/Inventario]], [[03-Modulos/Dashboard]]  
> **ADRs implementados:** [[04-Decisiones-Tecnicas/ADR-001-Separadores]], [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]], [[04-Decisiones-Tecnicas/ADR-003-sort_order]], [[04-Decisiones-Tecnicas/ADR-005-Modo-Discreto]], [[04-Decisiones-Tecnicas/ADR-006-Refactor-Utils-Phase-0]]  
> **Changelog:** [[06-Changelog/2026-04]] · [[06-Changelog/2026-05]]

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

## Testing — unit + mock de Supabase ✅

> 2026-05-25 · [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing]]

Fase 1 y 2 de QA con el runner integrado de Bun (`bun:test`), sin dependencias nuevas.

- **Fase 1 — funciones puras** (`tests/lib/*`, 104 tests): format, business-rules, auto-learn, inventory.
- **Fase 2 — route handlers** (`tests/api/*`, 73 tests): handlers reales con Supabase mockeado vía `tests/helpers/supabase-mock.ts`. Smoke, auth-guards (18 rutas → 401), quotations, orders, imports (con `.xlsx` real).
- Reglas de negocio críticas cubiertas: separadores excluidos, deducción de stock al crear orden, rollback, preservación de `is_approved`, auto-learn URREA, `requireAuth`, invariante de allocation.
- Scripts: `bun test` / `test:watch` / `test:coverage` → `tests/`.

Resultado: **177 tests, 0 fallos** (~250 ms). 7 commits atómicos en `stg`.

## Pendiente / Próximo

- **Integration tests** de route handlers contra Supabase local/branch (constraints, RLS, triggers reales).
- **Component tests** con Testing Library; **E2E** con Playwright.
- Tests de los parsers de Excel en `src/lib/excel/*`.
- **Divergencia API vs UI en `sent_for_approval`** (a evaluar): `PATCH /api/quotations/[id]/update` admite editar `sent_for_approval`, pero el UI usa `canEdit = isDraft || isApproved` y no expone la edición en ese estado. No es alcanzable por el producto, pero editar vía API mientras el cliente revisa el link regenera los IDs de `quotation_items` (DELETE+INSERT) y el `POST /approve/[token]` actualizaría por IDs obsoletos. Decisión actual: dejarlo (documentado en `tests/api/quotations.test.ts`). Evaluar si conviene alinear el guard del API con `canEdit`.
