# ADR-042 — Escrituras atómicas en funciones de BD y stores compartidos

**Fecha:** 2026-10-24
**Estado:** Aceptado
**Issue:** #157 (Track 0 de #155) · **PRs:** #163 (`atomic_order_stock`), #166 (`atomic_quotation_writes`), #169 (`replace_urrea_catalog`) · **Relacionado:** [[ADR-009-Errores-Descriptivos]], [[ADR-021-Testing-E2E-Supabase-Local]], [[ADR-034-MCP-Reglas-de-Crecimiento]], [[ADR-041-Dos-Conectores-MCP-y-Composicion-de-Tools]]

## Contexto

El mapeo de escrituras de #155 encontró el mismo defecto en varios módulos: una operación que debe ser **todo o nada** se armaba en la ruta con varias llamadas sueltas a PostgREST. Cada llamada es su propia transacción, así que un fallo a la mitad dejaba datos a medias:
- el stock se apartaba y luego fallaba el insert de la orden;
- la cotización quedaba con 0 ítems entre el `delete` y el `insert`;
- el catálogo URREA quedaba vacío si el insert del modo «Reemplazar» fallaba.

Además, la validación vivía repartida entre la ruta y el formulario. Por ejemplo, la guarda ADR-013 solo existía en `ProductForm`. El MCP va a escribir en esos mismos módulos (#155 D), y no puede saltarse esas reglas.

## Decisión

### 1. Lo que debe ser atómico vive en una función SQL

Una escritura que toca varias filas o tablas y no admite quedar a medias se hace en **una función de BD** que la ruta llama con `rpc()`. Así corre en una sola transacción, con los bloqueos que haga falta.

| Función | Para qué |
|---|---|
| `atomic_order_stock` (#163) | Mover stock de órdenes |
| `atomic_quotation_writes` (#166) | Editar y aprobar cotizaciones |
| `replace_urrea_catalog` (#169) | Reemplazar el catálogo |

Convenciones fijas:
- **`SECURITY INVOKER`**: la RLS aplica al que llama, igual que en la ruta.
- **`SET search_path = ''`**, con todo calificado como `public.`.
- **`REVOKE ALL … FROM PUBLIC, anon`** + **`GRANT EXECUTE … TO authenticated`**. `service_role` solo cuando la ruta es pública, como en `/approve`.
- **Orden de bloqueo** documentado: la fila padre primero.
- **Errores de regla como `RAISE EXCEPTION '<clave>'`** (P0001). El store los traduce a mensajes en español (ADR-009).
- **Aditivas e idempotentes** (`CREATE OR REPLACE`). La función va en `schema.sql` y en el baseline en el mismo commit. En el baseline va después del `GRANT ALL ON ALL ROUTINES`, para que su `REVOKE` a `anon` no se pierda.
- **Prueba de integración** contra el Supabase local con tres casos: todo o nada, la regla que rechaza y los privilegios.

Lo que una sola sentencia ya hace atómico (un `upsert`, un `update` por id) **no** necesita función.

### 2. Rutas y tools del MCP comparten un store

La validación y la escritura de cada entidad viven en `src/lib/<entidad>-store.ts`: `orders-store`, `quotations-store`, `urrea-catalog-store`, `products-store`, y antes `suppliers-store`, `payroll-store` y `time-entries-store`.
- Las rutas quedan como **adaptadores**: autentican, leen el body o el archivo, llaman al store y responden.
- Las tools del MCP llaman al **mismo** store. Así una regla no se escribe dos veces ni se desincroniza.

Los errores del store extienden **`DomainError`** (`src/lib/domain-error.ts`). Su `kind` determina el status: `invalid` → 400, `not_found` → 404, `forbidden` → 403, `conflict` → 409, `failed` → 500. La ruta responde `error.status` con `error.body`; una tool lo convierte en `ToolError`. #155 C1 usa el mismo archivo, que debe quedar idéntico entre ramas.

Los imports por archivo **validan el archivo completo antes de escribir** y responden 400 nombrando las filas. Los helpers de hoja viven en `src/lib/excel/sheet-rows.ts`.

### 3. La función se aplica en la nube ANTES de mergear

stg, previews y producción **comparten la BD**. El código nuevo llama a la función, y el código viejo no la conoce. Por eso:
- la migración se aplica en la nube **antes** del merge;
- se verifica con las consultas que lista `supabase/migrations-log.md` («Pendientes»);
- después se mergea.

Aplicarla primero es seguro precisamente porque es aditiva. Al revés (código sin función), la ruta respondería 500.

## Consecuencias

- Un fallo a la mitad ya no deja datos a medias, y el mensaje dice qué regla se rompió.
- Las reglas tienen un solo lugar. El revisor de PR y el MCP leen la misma lógica.
- **Costo:** la lógica que vive en SQL (fórmulas de stock, de excedente) se repite en JS para la UI y los tests. Un comentario liga ambas, y la prueba de integración las ata.
- **Costo:** cada PR con función obliga a coordinar el `apply_migration` antes del merge.
