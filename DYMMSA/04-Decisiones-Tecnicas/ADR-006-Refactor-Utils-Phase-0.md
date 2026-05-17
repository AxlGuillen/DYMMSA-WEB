# ADR-006: Refactor Fase 0 — Extracción de lógica duplicada a utilidades

> **Estado:** Implementado 2026-05-16  
> **Fase:** 6 — Mejoras (preparación para Fase 1 de QA)  
> **Archivos clave:** `src/lib/format.ts`, `src/lib/business-rules.ts`, `src/lib/api-helpers.ts`, `src/lib/inventory.ts`, `src/lib/auto-learn.ts`

---

## Contexto

El proyecto no tenía infraestructura de tests. Antes de instalar un test runner (Bun test), conviene **primero refactorizar la lógica duplicada** en utilidades puras. Esto:

1. **Reduce el bug surface inmediatamente** — pasamos de 8 copias del cálculo de subtotal a 1 implementación centralizada
2. **Hace el código testable** — funciones puras (sin DB, sin DOM, sin `Date.now()` inline) son triviales de probar
3. **Encoda las reglas de negocio críticas** del CLAUDE.md como funciones documentadas que son la única fuente de verdad

---

## Decisión

Crear 5 módulos en `src/lib/`, separando lógica pura de operaciones con side effects:

### 1. `src/lib/format.ts` — formato puro

```ts
export function formatRelative(dateStr: string, now: Date = new Date()): string
export function formatAbsolute(dateStr: string): string
export function formatISODate(date: Date = new Date()): string
export function normalizeString(value: string): string
export function sanitizeFilename(name: string): string
export function parseNumber(value: unknown): number | null
export function parseInteger(value: unknown): number | null
```

**Consolida:** `formatRelative`/`formatAbsolute` duplicados exactos en 3 tablas, `toISOString().split('T')[0]` en 4 sitios, `replace(/[^a-z0-9]/gi, '_')` en 2 sitios, parseo de números con NaN-check en 4 sitios.

### 2. `src/lib/business-rules.ts` — reglas de negocio puras

```ts
export function isSeparator(item): boolean
export function isProductItem(item): boolean
export function filterProductItems(items)
export function calculateLineTotal(unitPrice, quantity)
export function calculateQuotationTotal(items, options)   // separadores excluidos
export function calculateOrderTotal(items)                // unit_price * quantity_approved
export function calculateDeliveredTotal(items)            // confirm-reception
export function allocateInventory(needed, available)      // Math.min(...) + invariante
export function validateAllocationInvariant(item)         // in_stock + to_order = approved
```

**Consolida:** 8 implementaciones inline del cálculo `unit_price * quantity`, 6 filtros de tipo producto, 2 implementaciones de `Math.min(needed, stock)`.

### 3. `src/lib/api-helpers.ts` — helpers para route handlers

```ts
export async function requireAuth(supabase): Promise<{ user } | { error: NextResponse }>
export const unauthorized = () => NextResponse.json(...)
export const notFound, badRequest, forbidden, serverError
```

**Patrón de uso:**

```ts
const auth = await requireAuth(supabase)
if ('error' in auth) return auth.error
const { user } = auth
```

**Consolida:** El patrón `getUser() + 401` repetido en 15 route handlers (eliminamos ~75 líneas).

### 4. `src/lib/inventory.ts` — restauración de inventario

```ts
export function computeRestoration(items): Array<{model_code, quantityToRestore}>  // PURA
export async function restoreOrderInventory(supabase, orderId)                      // IMPURA
```

**Consolida:** La lógica de restauración en `orders/[id]/cancel/route.ts` (L54-88 → 1 línea).

### 5. `src/lib/auto-learn.ts` — enriquecimiento del catálogo ETM

```ts
export function isEligibleForAutoLearn(item): boolean
export function computeNewEtmFields(item)              // INSERT — encoda regla "brand=URREA solo con model_code"
export function mergeEtmFields(existing, incoming)     // UPDATE — encoda regla "solo campos no vacíos"
export async function processAutoLearn(supabase, userId, items)
```

**Consolida:** ~100 líneas duplicadas (85% idénticas) entre `quotations/save/route.ts` y `quotations/[id]/update/route.ts`.

---

## Reglas de diseño aplicadas

Para que estas utilidades sean trivialmente testables:

1. **Sin imports de Supabase en funciones puras.** Las puras viven separadas de las impuras dentro del mismo archivo.
2. **Reloj inyectable.** `formatRelative(date, now = new Date())` permite fijar el "ahora" en tests.
3. **Tipos genéricos amplios.** `<T extends { item_type?: string }>` acepta tanto `QuotationItem` como `OrderItem`.
4. **Errores como valores, no throws.** `requireAuth` retorna `{ user } | { error: NextResponse }`.
5. **Reglas de negocio del CLAUDE.md codificadas explícitamente** en funciones con docstrings.

---

## Consecuencias

### Métricas del refactor
- **-315 líneas netas** (435 eliminadas, 120 agregadas)
- **25 archivos modificados**, 5 nuevos
- **Build pasa**, `bunx tsc --noEmit` limpio
- **5 commits atómicos** en rama `stg` (uno por módulo, cada uno compila por sí mismo)

### Para futuras features
- Agregar un nuevo route handler: importar `requireAuth` y los helpers de business-rules ya disponibles
- Agregar un cálculo de totales: extender `business-rules.ts` (no copiar lógica)
- Agregar formato de fecha o número: extender `format.ts`

### Habilitador de Fase 1 (QA)
- Las funciones puras pueden testearse con Bun test sin mockear Supabase
- Funciones recomendadas para los primeros tests: `calculateQuotationTotal` (excluir separadores), `allocateInventory` (invariante), `mergeEtmFields` (regla URREA), `validateAllocationInvariant`

---

## NO incluido en este refactor (intencionalmente)

- **No se cambió ningún comportamiento de negocio** — solo reorganización
- **No se cambiaron tipos de BD** ni migraciones
- **No se agregaron tests aún** (eso es Fase 1)
- **Función `formatCurrency` en DashboardMetrics** ya estaba centralizada en el hook `useCurrency` (ADR-005), solo se eliminó el helper local

---

**Ver también:** [[02-Arquitectura/Estructura-de-Carpetas]] · [[05-Fases/Fase-6-Mejoras]] · [[04-Decisiones-Tecnicas/ADR-001-Separadores]] (regla codificada en `isSeparator`/`isProductItem`)
