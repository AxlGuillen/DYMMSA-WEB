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

Agregado un cuarto preset `'all'` al segmented control del dashboard para ver métricas históricas completas (no solo últimos 30 días).

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

- Causa: el route hace DELETE+INSERT regenerando IDs, pero el `useEffect` en `QuotationDetail.tsx` solo dependía de `[quotation.id]`, por lo que `localItems` retenía los IDs viejos y `quotation_items.find(i => i.id === item._id)` retornaba undefined.
- Fix: agregar `itemsSignature` (string con todos los IDs concatenados) como dep del useEffect.

**Archivo:** `src/components/quotations/QuotationDetail.tsx` L417-426

## Pendiente / Próximo

- **Fase 1 de QA:** Instalar Bun test y escribir tests unitarios sobre `src/lib/*` puras (ver ADR-006).
- _(agregar aquí lo que se planifique para Fase 6 adicional)_
