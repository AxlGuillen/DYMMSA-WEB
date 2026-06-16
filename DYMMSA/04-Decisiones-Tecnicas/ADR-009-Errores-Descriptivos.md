# ADR-009: Errores descriptivos al guardar / convertir cotizaciones

> **Estado:** Implementado 2026-05-27
> **Fase:** 6 — Mejoras
> **Archivos clave:** `src/lib/supabase-errors.ts`, `src/lib/quotation-validation.ts`, `src/lib/dom-helpers.ts`, `src/hooks/useQuotations.ts` (`ApiError`, `fetchJson`), `src/app/dashboard/quoter/page.tsx`, `src/components/quotations/QuotationDetail.tsx`, `src/components/quoter/QuotationEditor.tsx`

---

## Contexto

Han ocurrido 2 incidentes donde guardar una cotización (o convertirla a orden)
falla con un mensaje genérico ("Error al crearla"). El último caso conocido: un
ítem con `quantity = 0` violaba la `CHECK` constraint
`quotation_items_quantity_check`. El backend rechazaba con 500 y la UI mostraba
el mensaje genérico — el usuario no podía saber **qué ítem ni qué campo arreglar**.

---

## Decisión

**Defensa en profundidad en 4 capas**, cada una atrapando casos que las otras
podrían dejar pasar:

### 1. Pre-flight en cliente (`src/lib/quotation-validation.ts`)
Función pura `validateQuotationItems(items)` que escanea los ítems ANTES del
request HTTP y reporta `{ itemId, etm, field, severity, message }` por cada
violación conocida:
- `quantity == null || quantity <= 0` → error
- `unit_price != null && unit_price < 0` → error
- `!etm` → error
- `!model_code` → warning (no bloquea)

**NO se valida ETMs duplicados** dentro de la misma cotización: el mismo ETM
puede aparecer en distintas secciones (comportamiento intencional).

Helpers: `getBlockingIssues()` (solo errores) y `getErrorItemIds()` (Set para UI).

### 2. Parseo de error de Postgres en backend (`src/lib/supabase-errors.ts`)
Cuando la pre-flight no atrapa el caso (constraint nueva, race condition),
`explainPgError(error, items?)` mapea el `PostgrestError`:
- `code 23514` (CHECK) → identifica la constraint por nombre y escanea `items`
  para encontrar el ETM ofensor.
- `code 23505` (UNIQUE), `23503` (FK), `23502` (NOT NULL) → mensajes específicos.
- Devuelve `{ userMessage, offendingEtm?, isConstraintViolation, constraintName? }`.
- Status code: `400` si es violación de regla del usuario, `500` si es genuino
  error interno.

Constraints conocidas mapeadas (verificadas vía MCP Supabase contra `pg_constraint`):
| Constraint | Mensaje |
|------------|---------|
| `quotation_items_quantity_check` | "ETM X: la cantidad debe ser mayor a 0" |
| `quotation_items_price_check` | "ETM X: el precio no puede ser negativo" |
| `order_items_quantity_approved_check` | "El producto aprobado con ETM X tiene cantidad 0" |
| `order_items_unit_price_check` | "ETM X: tiene precio negativo" |
| `check_quantity_sum` | "Las cantidades del pedido no cuadran (bug interno)" |
| `check_received_not_exceed_ordered` | "La cantidad recibida no puede ser mayor a la pedida" |
| `store_inventory_quantity_check` | "El stock cambió mientras se procesaba" (race) |
| `quotations_total_check` / `orders_total_amount_check` | "El total es negativo" |
| `etm_products_etm_unique` | "El ETM ya existe en el catálogo" |
| `store_inventory_model_code_key` | "El código de modelo ya existe en inventario" |
| Genéricas (`_check` / `_key` / `_fkey`) | Fallback con nombre |

### 3. Aislar `auto-learn` (caso que confundía)
Antes: si `processAutoLearn` tiraba excepción **tras** un insert exitoso, el
catch externo respondía 500 "Error al guardar la cotización" → confundía al
usuario porque sus datos SÍ estaban guardados.

Ahora: `save` y `update` envuelven `processAutoLearn` en su propio `try/catch`
después del insert principal. Si auto-learn falla, devuelven 200 con
`warning: 'auto_learn_failed'`. La cotización queda salvada, solo el catálogo
no se enriqueció.

### 4. Errores transversales en hooks (`useQuotations.ts`)
- **Clase `ApiError`** enriquecida con `code` (`AUTH_EXPIRED` | `NETWORK` |
  `VALIDATION` | `SERVER`), `offendingEtm` y `status`.
- **`fetchJson()` helper** que normaliza todas las mutations:
  - `fetch` rechaza → `ApiError('Sin conexión...', 'NETWORK')`
  - `401` → `ApiError('Tu sesión expiró...', 'AUTH_EXPIRED')`
  - `4xx/5xx` con body `{ message, offendingEtm }` → `ApiError(..., 'VALIDATION'|'SERVER', offendingEtm)`
- Los componentes (`quoter/page.tsx`, `QuotationDetail.tsx`) hacen
  `if (error instanceof ApiError && error.code === 'AUTH_EXPIRED') push('/login')`
  y `if (error.offendingEtm) setErrorItemIds + scrollToRow`.

### 5. UI: highlight + scroll a la fila ofensora
- Cada `<tr>` lleva `data-row-id={item._id}` (productos; separadores se ignoran).
- `QuotationEditor` y `QuotationDetail` aceptan/manejan `errorItemIds: Set<string>`
  y pintan la fila con `outline outline-2 outline-red-500 bg-red-50` cuando
  está en el set.
- `scrollToRow(id)` en `src/lib/dom-helpers.ts` lleva al usuario al primer error.

---

## Consecuencias

- **El usuario ve qué ítem corregir**: toast con ETM + fila roja + scroll.
- **Status code más fino**: violaciones de regla del usuario regresan 400
  (no 500), distinguiendo errores corregibles de fallas reales del servidor.
- **`auto-learn` ya no tira el save**: warning informativo en vez de 500
  misleading.
- **Errores de red y sesión expirada se manejan distinto**: el usuario sabe si
  el problema es su conexión, sus credenciales o el servidor.
- **Defensa en profundidad**: si la pre-flight olvida una regla nueva (ej.
  al agregar una constraint en BD), el backend la atrapa con mensaje específico.

---

## Tests

- **`tests/lib/supabase-errors.test.ts`** (17 tests): mapeo de cada código
  de Postgres + identificación del ítem ofensor + fallback.
- **`tests/lib/quotation-validation.test.ts`** (14 tests): cada regla
  (quantity, precio, etm, model_code, onlyApproved, ETMs duplicados permitidos).
- **`tests/api/quotations.test.ts`** (+4): `quotation_items_quantity_check`,
  `quotation_items_price_check`, `order_items_quantity_approved_check`,
  auto-learn fallido devuelve 200 con warning.
- **`tests/api/orders.test.ts`** (+1): `order_items_unit_price_check` con
  `offendingEtm`.

**Total nuevo: +36 tests** sobre los 226 previos → **262 en total**.

---

## NO incluido

- Migrar las constraints a triggers de Postgres con `RAISE` custom (más
  invasivo; parsear `pg_constraint` desde el handler basta).
- Validación contra duplicados globales en `etm_products` desde la pre-flight
  (es responsabilidad de auto-learn, no del save).
- Internacionalización de mensajes (todo en español por ahora).
- UI de "lista de problemas" tipo panel lateral (un toast + highlight basta).

---

**Ver también:** [[06-Changelog/2026-05]] · [[CLAUDE.md]]
