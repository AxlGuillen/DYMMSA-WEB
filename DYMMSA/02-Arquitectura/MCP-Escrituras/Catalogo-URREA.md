# MCP escrituras — Catálogo URREA

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]] · [[04-Decisiones-Tecnicas/ADR-018-Mayoreo-vs-Menudeo]]
> **Actualización 2026-10-24 (#157):** los bugs de esta ficha (replace que podía dejar el catálogo vacío, `std` decimal → 500, duplicados del archivo que tumbaban el upsert, descripción sin recortar, `description` no-string → 500) están arreglados. La validación y las escrituras viven en `src/lib/urrea-catalog-store.ts` (`parseCatalogItemInput`, `toStd`, `parseCatalogSheet`, `importCatalog`, `createCatalogItem`, `updateCatalogItem`) —el «store» que proponía esta ficha, sin `catalogChangeImpact()` todavía— y el replace es una sola llamada a la RPC `replace_urrea_catalog` ([[02-Arquitectura/Base-de-Datos]]). Los archivo:línea de abajo describen el código **anterior**.

## Resumen

`urrea_catalog` es el catálogo oficial multimarca (identidad **`UNIQUE(code, brand)`**, `code` y `brand` siempre trim+upper, `description` oficial, `std INTEGER CHECK > 0` = piezas por paquete; sin FK, cruce por valor con `catalogKey(model_code, brand)`). Pertenecer al catálogo decide **qué va a URREA** en el planificador y el Excel URREA, `std` decide los paquetes, y `description` gana la jerarquía de la Descripción DYMMSA. Estas rutas hacen CRUD, import por Excel (upsert/replace) y un lookup de solo lectura por POST. El MCP hoy solo lee (`search_urrea_catalog`). Riesgo general **medio-alto**: cualquier cambio altera al vuelo el plan de compra de **todas** las órdenes con ese código.

Foto de la nube (consulta de solo lectura, 2026-10-22): 14,067 filas, 3 marcas, 0 filas sin normalizar, ningún código repetido entre marcas (el diseño debe soportarlo igual).

## Rutas que escriben

### `POST /api/urrea-catalog` — `src/app/api/urrea-catalog/route.ts`
- **Auth / rol:** `requireAuth`. RLS: `"Authenticated users can manage urrea_catalog"` FOR ALL TO authenticated `USING (true)` (sin `is_admin()`).
- **Entrada:** body `{ code, brand?, description?, std? }`, validación inline. `code` → `normalizeCatalogCode()` (trim+upper), obligatorio (400). `brand`: si viene y no es string → 400; `normalizeCatalogBrand()` (trim+upper, vacío → `URREA`). `description` → trim o `null` (un no-string revienta en `.trim()` → 500). `std`: número > 0, si no → 1 (no se exige entero: 2.5 llega a la BD y falla con 500).
- **Qué hace:** `insert` + `.select().single()` → 201.
- **Reglas y efectos secundarios:** `23505` → 400 "Ya existe un producto con ese código y marca"; otro → 500. Al existir la fila, ese `(code, brand)` pasa a ir a URREA en el planificador (`fetchCatalogEntryMap`) de toda orden que lo traiga, y su `description` le gana a la curada de `etm_products` en cotizaciones futuras (las guardadas son snapshot).
- **Dónde vive la lógica:** mixta — normalizadores en `src/lib/business-rules.ts`, parseo inline.
- **Quién la usa en la UI:** `useCreateCatalogItem` → `src/components/urrea-catalog/CatalogForm.tsx`.

### `PATCH /api/urrea-catalog/[id]` — `src/app/api/urrea-catalog/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** `id` + body `{ code?, brand?, description?, std? }`. `code` string → normalizado, vacío → 400. `brand` string → normalizado (vacío → `URREA`). `description` → trim o null. `std`: número ≥ 1 o 400 "STD debe ser un entero ≥ 1" (pero no revisa que sea entero → 500 con 2.5). Sin cambios → 400.
- **Qué hace:** `update` por `id` (`updated_at` por trigger `moddatetime`). `23505` → 400, `PGRST116` → 404.
- **Reglas y efectos secundarios:** cambiar `std` deja **desactualizadas** las decisiones de mayoreo guardadas con otro `std_snapshot` (`isStale` en `src/lib/purchase-plan.ts`: `std_snapshot !== currentStd`) → esos grupos vuelven a pedir decisión. Cambiar `code`/`brand` equivale a sacar un código del catálogo y meter otro (pertenencia, descripción, staleness con `currentStd == null`).
- **Dónde vive la lógica:** mixta (normalizadores en `business-rules.ts`, validación inline).
- **Quién la usa en la UI:** `useUpdateCatalogItem` → `CatalogForm`.

### `DELETE /api/urrea-catalog/[id]` — `src/app/api/urrea-catalog/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** `id`.
- **Qué hace:** `delete().eq('id', id)` → `{ ok: true }` aunque no exista.
- **Reglas y efectos secundarios:** el código deja de ir a URREA (pasa a compra local en el planificador), sus decisiones guardadas quedan desactualizadas (`currentStd == null`) y la Descripción DYMMSA cae a la curada, que por ADR-013 suele estar vacía cuando había match. Sin rastro.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useDeleteCatalogItem` → `src/components/urrea-catalog/CatalogTable.tsx`.

### `POST /api/urrea-catalog/import` — `src/app/api/urrea-catalog/import/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** multipart `file` + `mode` (`upsert` default | `replace`). Columnas por alias case-insensitive (`pick`): `codigo`/`código`/`code` (obligatoria), `marca`/`brand`, `descripcion`/`descripción`/`description`, `std` (`parseInteger`; ≤ 0 o vacío → 1).
- **Qué hace:** arma todo el payload normalizado; `replace` → `delete().neq('id', <uuid nulo>)` y **un** `insert` del payload; `upsert` → **un** `upsert(payload, { onConflict: 'code,brand' })`.
- **Reglas y efectos secundarios:** replace **no es transaccional**: si el insert falla (p. ej. un `(code, brand)` repetido dentro del archivo → 23505) el catálogo queda **vacío** y responde 500. En upsert, un duplicado dentro del archivo hace fallar la sentencia completa (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time"; comportamiento de Postgres, no probado aquí) y no se guarda nada. La descripción no se recorta. La respuesta cuenta todo como `imported` (`updated` siempre 0).
- **Dónde vive la lógica:** mixta (normalizadores en `business-rules.ts`, `parseInteger` en `format.ts`, el resto inline).
- **Quién la usa en la UI:** `useImportUrreaCatalog` → `src/components/urrea-catalog/CatalogImporter.tsx` (replace pide confirmación aparte).

### `POST /api/urrea-catalog/lookup` — `src/app/api/urrea-catalog/lookup/route.ts`
- **Confirmado: es lectura.** POST solo para mandar `{ codes: string[] }` (sin tope de tamaño); responde `{ descriptions: Record<catalogKey, desc> }` vía `fetchCatalogDescriptionMap()` (`src/lib/urrea-catalog.ts`), por **todas** las marcas del código y sin las filas sin descripción. No escribe nada.
- **Auth:** `requireAuth`.
- **Quién la usa:** `useCatalogDescription` → `ProductForm` y `src/components/quoter/ProductModal.tsx`.
- La nota de `API-Routes.md` ("aún cruza solo por `code` (sin marca — issue #27)", `Record<code, desc>`) está desfasada: hoy responde por `catalogKey` (`MARCA|CÓDIGO`).

## Cobertura MCP actual

- **`search_urrea_catalog`** (lectura, `searchUrreaCatalog()` en `src/lib/mcp/tools/urrea.ts`): `query`; primero match exacto por código normalizado (todas las marcas), si no, parcial por código o descripción (máx 20). Devuelve `code`, `brand`, `description`, `std`. No filtra por marca.
- **No puede:** dar de alta, corregir descripción o `std`, cambiar identidad, borrar ni importar.

## Casos de uso desde el chat

1. "El 6954 ahora viene en paquete de 12, no de 10." → `PATCH std` → decisiones de mayoreo de ese grupo quedan desactualizadas.
2. "Corrige la descripción del 6954: 'Llave combinada 1/2'." → `PATCH description` (solo cotizaciones futuras).
3. "Agrega al catálogo el SK-120 de SURTEK, paquete de 6." → `POST` con marca → ese código pasa a ir a URREA.
4. "El 6954A está mal capturado, es 6954-A." → `PATCH code` (cambio de identidad).
5. "Llegó la lista nueva de URREA, cárgala." → import (14k filas) → se queda en la app.
6. "Quita el 9999 del catálogo, URREA ya no lo surte." → `DELETE` (pasa a compra local).
7. "¿Qué órdenes se mueven si cambio el STD del 6954?" → lectura previa que hoy no existe (insumo de la confirmación).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Corregir descripción | bajo | Solo resoluciones futuras; snapshot en lo guardado |
| Cambiar `std` | medio | Deja desactualizadas las decisiones de mayoreo de ese grupo en órdenes abiertas |
| Alta de `(code, brand)` | medio | Mueve el código de compra local a URREA en todas las órdenes y su descripción le gana a la curada |
| Cambiar `code`/`brand` | medio | Equivale a baja + alta: pertenencia, descripción y decisiones |
| Eliminar | alto | Saca el código del Excel URREA y su descripción oficial, sin rastro |
| Import upsert | alto | 14k filas en una sentencia; un duplicado en el archivo tumba todo |
| Import replace | alto | Borra todo; si el insert falla el catálogo queda vacío |
| Lookup (POST) | bajo | Lectura |

## Propuesta de tools

### `save_catalog_item` — nueva (+1 tool)
- **Entidad:** `urrea_catalog`. Crea o edita (ADR-034).
- **Parámetros:** `codigo` (normalizado), `marca` (default `URREA` vía `normalizeCatalogBrand`; si se omite y el código existe en 2+ marcas → error que las lista, `requireSingleMatch`), `crear` (alta explícita: sin él un `(code, brand)` inexistente es error), `descripcion` (`''` → null), `std` (entero ≥ 1, `z.number().int()` — corrige el 500 de la ruta), `nuevo_codigo` / `nueva_marca` (cambio de identidad), `confirmar`.
- **Confirmación:** solo `descripcion` → **directo** con antes → después. Alta, `std` o identidad → **confirmar**: sin `confirmar: true` devuelve el resumen (std antes → después y cuántas decisiones guardadas quedarán desactualizadas en órdenes no cerradas; en un alta, cuántas líneas de órdenes abiertas pasan de compra local a URREA) y no escribe.
- **`adminOnly`:** sí (RLS abierta a `authenticated`; la barrera para un member es el handler por rol).
- **Store / refactor necesario:** `src/lib/urrea-catalog-store.ts` con `parseCatalogInput()` (normalizadores de `business-rules.ts`, `std` entero, tipos), `createCatalogItem()`, `updateCatalogItem()` y `catalogChangeImpact()` (cuenta `order_purchase_decisions` cuyo `std_snapshot` dejaría de coincidir, con `isStale` de `purchase-plan.ts`; y `order_items` de órdenes abiertas con ese `catalogKey`). Las rutas `POST`/`PATCH` lo adoptan. `src/lib/urrea-catalog.ts` se queda con las lecturas.
- **Fusión:** ver `save_product` — juntarlas ahorraría 1 tool pero mezcla dos entidades y dos jerarquías; no recomendado.

**Total del módulo:** **+1 tool** en el bloque app.

## Fuera a propósito

- **`DELETE /api/urrea-catalog/[id]`**: alto impacto sin rastro; si URREA deja de surtir algo, se borra en la app (o se reimporta la lista).
- **`POST /api/urrea-catalog/import`**: 14,067 filas no caben en una llamada del chat (el precedente `preview_time_report` topa en 1,000 filas) y el catálogo se reemplaza con el archivo oficial, no transcrito. Además replace hoy puede dejar el catálogo vacío: arreglarlo (RPC transaccional o borrar después de insertar) es trabajo de la app, no del MCP.
- **`POST /api/urrea-catalog/lookup`**: es lectura; `search_urrea_catalog` ya cubre la consulta por código con todas las marcas.

## Preguntas abiertas

1. ¿Tiene sentido dar de alta o corregir el catálogo desde el chat, o el catálogo solo debe cambiar con la lista oficial de URREA (y el MCP se limita a `descripcion`/`std`)?
2. ¿Cambiar `std` desde el chat exige ver antes las órdenes afectadas (lista) o basta el conteo?
3. ¿Se permite cambiar la identidad `(code, brand)` desde el chat?
4. Import replace no transaccional: ¿se abre issue aparte para corregirlo en la app?
5. ¿`search_urrea_catalog` debería aceptar `marca` para leer exactamente la fila que `save_catalog_item` va a tocar?
