# MCP escrituras — Inventario

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-015-MCP-Interno]] · [[04-Decisiones-Tecnicas/ADR-019-Recepcion-Excedente]]

## Resumen

`store_inventory` es el stock de la **tienda** por `model_code` (`quantity INTEGER CHECK >= 0`, `location` = gaveta, `UNIQUE(model_code)`); la marca no vive aquí, la resuelve la vista `store_inventory_with_brand` al leer. Este grupo de rutas escribe alta, edición (cantidad absoluta, gaveta, renombrar código), baja e import por Excel (upsert/replace). El MCP hoy solo lee (`search_inventory`) y cambia la gaveta (`set_inventory_location`); **nunca** cantidades. Riesgo general **alto en cantidades**: no hay bitácora, ninguna escritura es atómica y la cantidad convive con lo que las órdenes abiertas ya descontaron.

Foto de la nube (consulta de solo lectura, 2026-10-22): 279 filas, 92 con stock, 0 `model_code` sin normalizar (trim+upper), 2 órdenes en `ordered`/`received` con 4 piezas tomadas del stock.

## Rutas que escriben

### `POST /api/inventory` — `src/app/api/inventory/route.ts`
- **Auth / rol:** `requireAuth` (cualquier sesión, member incluido). RLS: policy `"Authenticated users can manage inventory"` FOR ALL TO authenticated `USING (true)` — no hay `is_admin()`.
- **Entrada:** body `{ model_code, quantity?, location? }`, validación inline. `model_code` string con trim, obligatorio (400 "El código modelo es obligatorio"); **no** se pasa a mayúsculas. `quantity`: si es número → `Math.max(0, Math.trunc(n))`; cualquier otra cosa → 0 en silencio (sin 400). `location`: trim, `''` → `null`.
- **Qué hace:** `insert` en `store_inventory` + `.select().single()` → 201.
- **Reglas y efectos secundarios:** `23505` → 400 "Ya existe un producto con ese código modelo"; cualquier otro error → 500 genérico (no usa `explainPgError`). Sin bitácora. No consulta `etm_products` ni el catálogo. Una fila con cantidad > 0 queda disponible para la siguiente orden (`allocateInventory()` en create-order).
- **Dónde vive la lógica:** inline en la ruta. Hay que extraerla.
- **Quién la usa en la UI:** `useCreateInventoryItem` → `src/components/inventory/InventoryForm.tsx` (alta).

### `PATCH /api/inventory/[id]` — `src/app/api/inventory/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS abierta.
- **Entrada:** `id` del path (no se valida como uuid) + body `{ model_code?, quantity?, location? }`. `model_code` string → trim, vacío → 400. `quantity` debe ser número ≥ 0 (400 "La cantidad debe ser ≥ 0"), se trunca. `location` string → trim / `''` → null; un no-string → null. Sin cambios → 400.
- **Qué hace:** `update` por `id` + `.select().single()`. `PGRST116` → 404; `23505` → 400.
- **Reglas y efectos secundarios:** la cantidad es **absoluta** (pisa lo que haya, sin compararlo con lo leído). Choca con create-order (`src/app/api/quotations/[id]/create-order/route.ts`), que lee `quantity` y luego escribe `inv.quantity - quantityInStock` también absoluto: un ajuste manual entre la lectura y la escritura se pierde. La ruta **permite renombrar `model_code`** pero la UI lo bloquea (campo `disabled` al editar en `InventoryForm`); como todos los cruces son por valor (órdenes, ETM, vista de marca), renombrar desliga. Sin bitácora (solo `updated_at` por trigger).
- **Dónde vive la lógica:** inline. La parte de gaveta que usa el MCP **no** pasa por aquí: `setInventoryLocation()` en `src/lib/mcp/tools/inventory.ts` tiene su propia lógica (por `model_code`, no por `id`).
- **Quién la usa en la UI:** `useUpdateInventoryItem` → `InventoryForm` (edición; manda solo `{ quantity, location }`).

### `DELETE /api/inventory/[id]` — `src/app/api/inventory/[id]/route.ts`
- **Auth / rol:** `requireAuth`; RLS abierta.
- **Entrada:** `id` del path.
- **Qué hace:** `delete().eq('id', id)` → `{ ok: true }` **aunque la fila no exista** (no revisa filas afectadas).
- **Reglas y efectos secundarios:** no revisa órdenes abiertas ni stock; se pierde la gaveta. Si luego se cancela o elimina una orden abierta con ese código, `restoreOrderInventory()` (`src/lib/inventory.ts`) vuelve a crear la fila **sin** ubicación. No hay FK (cruce por valor), así que nada lo bloquea.
- **Dónde vive la lógica:** inline (trivial).
- **Quién la usa en la UI:** `useDeleteInventoryItem` → `src/components/inventory/InventoryTable.tsx` (diálogo de confirmación).

### `POST /api/inventory/import` — `src/app/api/inventory/import/route.ts`
- **Auth / rol:** `requireAuth`; RLS abierta.
- **Entrada:** multipart `file` (primera hoja, SheetJS) + `mode` (`'upsert'` default | `'replace'`). `mode` **no se valida**: cualquier valor distinto de `replace` actúa como upsert y se devuelve tal cual. Columnas: `MODEL_CODE` (nombre exacto, en mayúsculas; solo se revisa en la primera fila), `QUANTITY` (exacto) y ubicación por alias case-insensitive (`pickLocation`: `ubicacion`/`ubicación`/`location`/`gaveta`).
- **Qué hace:** `replace` → `delete().neq('id', <uuid nulo>)` borra **todo** y luego inserta fila por fila. `upsert` → por fila: `select` por `model_code` exacto → `update` (cantidad; gaveta solo si el archivo la trae) o `insert`.
- **Reglas y efectos secundarios:** **no transaccional**: en replace, si fallan inserts lo borrado no vuelve, y la gaveta de todo lo que no venga en el archivo se pierde. Cantidad absoluta; negativa → 0; un decimal numérico (2.5) no se trunca → error de la BD que solo suma al contador `errors` (no dice qué fila). Respuesta `{ imported, updated, errors, total, mode }`; 500 genérico si falla el parse.
- **Dónde vive la lógica:** inline (incluye `pickLocation`).
- **Quién la usa en la UI:** `useImportInventory` → `src/components/inventory/InventoryImporter.tsx` (radio "Actualizar" / "Reemplazar todo" con advertencia).

### Otros escritores de `store_inventory` (fuera de este grupo, pero chocan con un ajuste manual)
`POST /api/quotations/[id]/create-order` (descuenta al crear), `POST /api/orders/create`, `/api/orders/[id]/items` y `/items/[itemId]` (ítems manuales), `POST /api/orders/[id]/confirm-reception` (solo el excedente, por delta, con clamp en 0 y warning) y `restoreOrderInventory()` (cancelar/eliminar: `computeRestoration()` = `in_stock + min(recibido, pedido)`). Todos cruzan con `.eq('model_code', …)` **exacto**; la vista de marca cruza con `upper(trim())`.

## Cobertura MCP actual

- **`search_inventory`** (lectura, `searchInventory()` en `src/lib/mcp/tools/inventory.ts`): `search` (model_code parcial), `stockFilter` (`all | in_stock | low_stock | sin_stock`), paginación. Lee la **tabla** `store_inventory`, no la vista: no devuelve marca ni filtra por ella y no tiene `with_stock` (la ruta `GET /api/inventory` sí). Oculta la gaveta cuando no hay stock.
- **`set_inventory_location`** (escritura, `setInventoryLocation()`; ADR-015 enmienda #72): `model_code` (match exacto sin distinguir mayúsculas vía `ilike` escapado) + `location` (vacío/ausente = borrar). Solo hace `update({ location })`; no crea filas; si coinciden 2+ códigos por mayúsculas devuelve error **después** de actualizarlos. No es `adminOnly`.
- **No puede:** dar de alta, ajustar cantidades (ni delta ni absoluto), renombrar, borrar ni importar. Tampoco ve cuánto de un código está apartado en órdenes abiertas.

## Casos de uso desde el chat

1. "Conté el 6954: hay 12." → ajuste absoluto (`PATCH quantity`); choca con lo apartado en órdenes abiertas (ver Preguntas 1).
2. "Llegaron 5 del 7420MT por fuera de URREA, súmalos." → ajuste por **delta** (hoy no existe: la ruta solo acepta absoluto).
3. "Se rompió uno del 6954, bájalo 1." → delta negativo, clamp en 0.
4. "Da de alta el 1234X con 3 piezas en la gaveta C2." → `POST`.
5. "El 6954 quedó en la gaveta B3." → ya cubierto (`set_inventory_location`).
6. "Conteo de la gaveta A: 6954 10, 7420MT 3, 8811 0…" → lote de ajustes absolutos (lo que hoy se hace con import upsert).
7. "Quita el 9999 del inventario, ya no lo manejamos." → `DELETE`.
8. "¿Cuánto del 6954 está apartado para órdenes?" → lectura que no existe hoy; es el contexto que necesita cualquier ajuste.

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Asignar o borrar gaveta | bajo | Metadato duradero, reversible, ya existe en el MCP |
| Alta de código con cantidad 0 | bajo | No cambia lo que las órdenes pueden tomar |
| Alta con cantidad > 0 | medio | La siguiente orden la toma como stock; un código mal escrito crea una fila fantasma |
| Ajuste de una línea (delta o absoluto) | medio | Sin bitácora; escritura no atómica frente a create-order; conteo físico ≠ `quantity` si hay apartados |
| Lote de ajustes (conteo físico) | alto | Muchas líneas leídas de una foto/lista: un número mal leído es stock falso que se vende |
| Renombrar `model_code` | alto | Desliga órdenes, ETM y marca (cruce por valor); la UI no lo permite |
| Eliminar fila | medio | Se pierde la gaveta y no hay rastro; una restauración posterior la re-crea sin gaveta |
| Import upsert por archivo | alto | Absoluto, sin reporte por fila, header sensible a mayúsculas |
| Import replace | alto | Borra todo, no transaccional |

## Propuesta de tools

### `save_inventory_item` — reemplaza `set_inventory_location` (neto 0 tools)
- **Entidad:** `store_inventory`. Una por entidad (ADR-034): alta, gaveta y cantidades en la misma.
- **Parámetros:** `productos: [{ codigo, ubicacion?, ajuste?, cantidad_contada? }]` (1–50 líneas), `motivo` (texto, obligatorio si alguna línea toca cantidad), `crear` (`true` explícito para dar de alta códigos que no existen; sin él, un código desconocido es error — evita filas por typo), `confirmar`, `clave`. `ajuste` (entero ≠ 0, delta) y `cantidad_contada` (entero ≥ 0, absoluto) son excluyentes por línea. `codigo` con el mismo match que hoy (exacto sin distinguir mayúsculas); el alta normaliza según la Pregunta 4.
- **Confirmación:** solo gaveta → **directo** (como hoy). Cantidad en una línea → **confirmar**: sin `confirmar: true` devuelve por línea `actual → nueva`, lo apartado en órdenes abiertas y no escribe. Cantidad en 2+ líneas → **vista previa** con `clave` HMAC sobre las líneas canónicas (mismo admin, mismo contenido, 30 min), como `odoo_preview_quotation` → `odoo_save_quotation` pero dentro de la misma tool (la primera llamada solo lee y firma).
- **`adminOnly`:** sí. Ojo: la RLS de `store_inventory` está abierta a cualquier `authenticated`, así que para un member la barrera real es el handler por rol (no recibe la tool), no la BD.
- **Store / refactor necesario:**
  - `src/lib/inventory-store.ts` con `parseInventoryInput()`, `createInventoryItem()`, `updateInventoryItem()` y `setLocationByCode()` (mover la lógica de la tool actual); las rutas `POST`/`PATCH` la adoptan.
  - Ajuste **atómico** en la BD: RPC (p. ej. `adjust_store_inventory(model_code, delta | absoluto, motivo)`, INVOKER) con `quantity = greatest(0, quantity + delta)` que devuelve antes/después — el read-then-write de JS de hoy pierde escrituras concurrentes.
  - Lo **apartado** por código = `computeRestoration()` (`src/lib/inventory.ts`) sobre los `order_items` de órdenes `ordered`/`received`; es la misma matemática que devuelve el stock al cancelar.
  - **Bitácora:** trigger DEFINER sobre `store_inventory` → `audit_events` (`entity_type 'store_inventory'`, acción p. ej. `quantity_changed`, `data { from, to, motivo }`), mismo patrón que `audit_payable()` (ADR-028). `audit_events.action` no tiene CHECK, así que no requiere migración de esa columna; el motivo llegaría al trigger por `set_config` dentro de la RPC.
  - **Secreto HMAC propio:** `src/lib/odoo/preview-token.ts` deriva su secreto de `ODOO_WRITE_API_KEY`, que en Production solo existe "por ventanas"; reusarlo dejaría esta tool apagada casi siempre. Hay que generalizarlo (secreto del MCP, error genérico en vez de `OdooError`).
- **Fusión:** reemplaza `set_inventory_location`. ADR-034 dijo que las escrituras existentes no se renombran (rompe rutinas); aquí el cambio libera el lugar que la tool nueva ocupa, así que es decisión explícita (Pregunta 6). Alternativa sin renombrar: conservar el nombre viejo con más parámetros (nombre engañoso).
- **Lectura complementaria (sin tool nueva):** `search_inventory` debería leer la vista `store_inventory_with_brand` (marca + `with_stock`) y, al buscar un código exacto, devolver lo apartado en órdenes abiertas.

**Total del módulo:** 1 tool (reemplaza 1) → **0 tools netas** en el bloque app.

## Fuera a propósito

- **Renombrar `model_code`** (`PATCH` con `model_code`): desliga cruces por valor; la UI tampoco lo ofrece. Se corrige en la app (baja + alta).
- **`DELETE /api/inventory/[id]`**: borrar no tiene rastro y la gaveta se pierde; precedente de que el MCP no borra (`save_supplier`, `update_payable`, `save_payroll_employee`). Para "ya no lo manejamos" basta `cantidad_contada: 0`.
- **`POST /api/inventory/import`** (archivo): el modo replace borra todo sin transacción y el conteo por chat ya cabe como lote en `save_inventory_item` (279 filas en total; un conteo real es de una gaveta). Si algún día se lleva, sería como filas transcritas (precedente `save_time_entries`) y nunca en modo replace.

## Preguntas abiertas

1. **Conteo físico vs `quantity`:** lo que las órdenes `ordered`/`received` tomaron de stock sigue físicamente en la tienda hasta entregarse. ¿Está apartado en otro lugar? Si no, un "conté 12" debe escribir `12 − apartado`, y la tool tiene que decidirlo (o preguntarlo) antes de escribir.
2. ¿Se permiten los dos modos (delta y absoluto) o solo uno?
3. ¿Bitácora de ajustes de cantidad? ¿Solo los manuales (app + MCP) o también los de órdenes? ¿Visible solo para admin como la de facturas?
4. ¿Las altas normalizan `model_code` a trim+upper? La ruta solo hace trim, la nube está 100% normalizada y las órdenes cruzan exacto: una fila en minúsculas no la vería create-order.
5. ¿El alta desde el chat exige que el código exista en `etm_products` o `urrea_catalog` (evita fantasmas)?
6. ¿Se acepta retirar `set_inventory_location` y sustituirla por `save_inventory_item` (rompe rutinas que la nombren)?
7. ¿Umbral de líneas para pasar de `confirmar` a vista previa con `clave` (propuesta: 2+ líneas con cantidad)?
8. ¿Hace falta una vista MCP Apps (tabla del conteo con botón "Guardar") o basta el texto?
