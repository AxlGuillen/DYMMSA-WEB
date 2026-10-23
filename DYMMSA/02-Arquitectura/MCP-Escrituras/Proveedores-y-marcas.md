# MCP escrituras — Proveedores y marcas

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]]

## Resumen

Proveedores de menudeo (#21): contacto, días de crédito (`payment_terms_days`, #84/#92) y las marcas que surten (M2M `supplier_brands` contra el catálogo global `brands`). Seis métodos escriben sobre `suppliers`, `brands` y `supplier_brands`. El MCP ya da de alta y edita proveedores (`save_supplier`, #134). No borra proveedores ni toca el catálogo de marcas: no las crea, no las renombra y no las borra. El riesgo general es bajo: son datos de contacto, sin dinero ni inventario. Lo único destructivo es borrar un proveedor, y la BD lo bloquea si tiene facturas por pagar.

## Rutas que escriben

### `POST /api/suppliers` — `src/app/api/suppliers/route.ts`
- **Auth / rol:** `requireAuth` (cualquier sesión, member incluido). RLS `"Authenticated users can manage suppliers"` y `"… supplier brands"`: `FOR ALL TO authenticated USING (true)` → la BD no distingue rol.
- **Entrada:** body `{ name, phone?, whatsapp?, email?, address?, notes?, payment_terms_days?, brandIds? }`. `parseSupplierInput(body, { requireName: true })`: trim; texto vacío → `null`; `payment_terms_days` entero ≥ 0 o `null` (= contado). La ruta revisa inline que `brandIds` sea arreglo; no valida que sean UUID ni que existan. El email no se valida.
- **Qué hace:** `createSupplier(db, value, brandIds)`:
  1. insert en `suppliers` (`.select().single()`);
  2. insert de los links en `supplier_brands`, con los ids deduplicados por `Set`.
- **Reglas y efectos secundarios:**
  - **Rollback del padre:** si falla el insert de links, borra el proveedor recién creado (`SupplierError 'failed'` → 500).
  - `23505` en el UNIQUE de `name` → 400 "Ya existe un proveedor con ese nombre". El UNIQUE distingue mayúsculas: `Perfiles` y `PERFILES` pueden coexistir. CHECK `suppliers_name_not_blank`.
  - Un `brandId` inexistente choca con la FK al insertar los links → rollback y **500**, no 400.
  - Responde 201 con el proveedor, sin marcas embebidas.
- **Dónde vive la lógica:** `src/lib/suppliers-store.ts` (`parseSupplierInput`, `createSupplier`, `SupplierError`). La ruta solo revisa el arreglo y mapea errores. Ya es reutilizable: `save_supplier` la usa.
- **Quién la usa en la UI:** `useCreateSupplier` → `SupplierForm` (`/dashboard/proveedores`). El plazo se captura con `PAYMENT_TERM_PRESETS` (7/15/30/60/90 → 1 semana…3 meses) más "Otro…". Los presets son solo de la UI: la API acepta cualquier entero ≥ 0, y `paymentTermsLabel()` pinta 0 y `null` como "Contado".

### `PATCH /api/suppliers/[id]` — `src/app/api/suppliers/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS abierta.
- **Entrada:** los mismos campos en modo sparse (`requireName: false`: si viene `name`, no puede quedar vacío), más `brandIds?` = el conjunto **completo** deseado. La ruta valida inline que sea arreglo.
- **Qué hace:** `updateSupplier(db, id, value, brandIds)`:
  1. si hay campos, update con `.select('id').single()`, que sirve de chequeo de existencia (PGRST116 → 404);
  2. si solo vienen marcas, un select de existencia (404 preciso en vez del 23503 del insert);
  3. lee los links actuales, inserta los que faltan y borra los sobrantes: **replace por diff**, nunca queda una ventana sin links.
- **Reglas y efectos secundarios:**
  - Sin campos ni marcas → 400 "No hay cambios para guardar". `23505` → 400.
  - **No es atómico.** Si el update de campos pasa y luego falla el insert o el delete de links, los campos quedan guardados y la ruta responde 500. El diff también puede quedar a medias: los insertados entran y los borrados no.
  - `moddatetime` en `updated_at`.
  - Cambiar `payment_terms_days` no recalcula facturas ya registradas: solo pre-llena el vencimiento de las nuevas, en la UI y en `create_payable`.
- **Dónde vive la lógica:** lib (`suppliers-store.ts`). Reutilizable.
- **Quién la usa en la UI:** `useUpdateSupplier` → `SupplierForm`.

### `DELETE /api/suppliers/[id]` — `src/app/api/suppliers/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** solo el `id` del path.
- **Qué hace:** `delete().eq('id', id)` sobre `suppliers`. Los links caen por `ON DELETE CASCADE` de `supplier_brands.supplier_id`; las marcas del catálogo no se tocan.
- **Reglas y efectos secundarios:**
  - La FK `payables.supplier_id` va **sin cascade** → 23503 → 400 "El proveedor tiene facturas por pagar registradas — elimínalas o reasígnalas primero".
  - No verifica que exista: un id inexistente responde `{ ok: true }` (200). Un id que no es UUID da 22P02 → 500.
- **Dónde vive la lógica:** **inline en la ruta**. Antes de cablear la tool hay que extraer `deleteSupplier(db, id)` a `suppliers-store.ts`, con 404 y el conteo de facturas para el mensaje (mismo patrón que el pre-conteo de marcas).
- **Quién la usa en la UI:** `useDeleteSupplier` → `SuppliersTable`, con AlertDialog "Esta acción no se puede deshacer. El proveedor y sus marcas asignadas se eliminarán…".

### `POST /api/brands` — `src/app/api/brands/route.ts`
- **Auth / rol:** `requireAuth`. RLS `"Authenticated users can manage brands"` abierta (`USING (true)`).
- **Entrada:** `{ name }` → `normalizeBrandTag()` (`business-rules.ts`: trim+upper, **sin** default URREA). Vacío → 400.
- **Qué hace:** insert en `brands` (`.select().single()`), 201.
- **Reglas y efectos secundarios:** `23505` → 400 "La marca ya existe". CHECK `brands_name_not_blank`.
- **Dónde vive la lógica:** inline; solo la normalización está en lib. Hay que extraer `createBrand` (en `suppliers-store.ts` o en un `brands-store.ts`).
- **Quién la usa en la UI:** `useCreateBrand` → `BrandsManager`, y también `SupplierForm`: el botón "Crear marca y asignarla" crea la marca y la deja seleccionada en el mismo formulario.

### `PATCH /api/brands/[id]` — `src/app/api/brands/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `{ name }` normalizado con `normalizeBrandTag`; vacío → 400.
- **Qué hace:** update `.select('id').single()`.
- **Reglas y efectos secundarios:**
  - PGRST116 → 404 "Marca no encontrada". `23505` → 400 "Ya existe una marca con ese nombre": renombrar **no fusiona** dos marcas.
  - Los links van por id, así que todos los proveedores que tienen la marca ven el nombre nuevo.
  - El cruce por valor con `etm_products.brand` y `urrea_catalog.brand` es futuro (CLAUDE.md). Hoy el nombre solo lo usan los filtros y las tools de proveedores (`list_suppliers.marca`, `save_supplier.agregar_marcas`).
- **Dónde vive la lógica:** inline. Hay que extraer `renameBrand`.
- **Quién la usa en la UI:** `useUpdateBrand` → `BrandsManager` (edición en línea, sin confirmación).

### `DELETE /api/brands/[id]` — `src/app/api/brands/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** solo el `id`.
- **Qué hace:**
  1. pre-conteo en `supplier_brands` (`count: 'exact', head: true`);
  2. si es > 0 → 400 "La marca está asignada a N proveedor(es). Quítala de sus proveedores antes de eliminarla.";
  3. si no, delete.
- **Reglas y efectos secundarios:** la FK `supplier_brands.brand_id` va sin cascade y sirve de respaldo (23503 → 400). Un id inexistente → `{ ok: true }`; un id no-UUID hace fallar el conteo → 500.
- **Dónde vive la lógica:** inline. Hay que extraer `deleteBrand`.
- **Quién la usa en la UI:** `useDeleteBrand` → `BrandsManager`. El botón se deshabilita si `suppliersCount > 0` y borra **sin diálogo** de confirmación.

## Cobertura MCP actual

- **`list_suppliers`** (lectura): `buscar`, `marca`, `limit` (≤ 100). Devuelve contacto, `plazo_pago` (`paymentTermsLabel`), `dias_credito` y marcas por nombre. El filtro por marca es un substring en JS sobre una lectura de hasta 1000 filas.
- **`save_supplier`** (escritura, **no** `adminOnly`: hoy la recibe un member):
  - Parámetros: `proveedor?` (nombre o parte → `resolveSupplier`; ausente = alta), `nombre`, `telefono`, `whatsapp`, `email`, `direccion`, `notas`, `dias_credito` (int ≥ 0 | `null` = contado), `agregar_marcas[]` y `quitar_marcas[]`.
  - Pasa por `parseSupplierInput` → `createSupplier` / `updateSupplier`. Convierte agregar/quitar en el conjunto completo antes del diff, así "agrégale TRUPER" no borra SURTEK.
  - Marcas por nombre exacto normalizado (`brandIdsFor`). Una marca inexistente es un error que lista el catálogo y **no se crea** (ADR-037: un error de dedo no debe dejar una marca basura).
  - Un texto vacío borra ese dato. En un alta, `quitar_marcas` es error.
- **`resolveSupplier`** (compartido con las tools de facturas): `ilike %q%`, límite 6, `requireSingleMatch`. **No acepta UUID ni prefiere el nombre exacto.** El buscador de nómina sí lo hace ("An exact name wins", `tools/payroll.ts`). Si existen "Perfiles" y "Perfiles MX", "Perfiles" es ambiguo y no hay forma de elegirlo por el MCP.
- **Lectura parcial:** `tests/mcp/coverage.test.ts` mapea `GET /api/brands` a `list_suppliers`, pero ninguna tool lista el catálogo de marcas con su conteo. Una marca sin proveedores solo aparece dentro del error de `brandIdsFor`.
- **No puede hoy:** borrar un proveedor; crear, renombrar o borrar marcas.

## Casos de uso desde el chat

1. "Da de alta a Tornillos MX, 30 días de crédito, WhatsApp 443…, surte SURTEK" → `POST /api/suppliers` (`save_supplier`, ya existe).
2. "Perfiles ya nos da 60 días" / "cámbiale el teléfono a Perfiles" → `PATCH /api/suppliers/[id]` (ya existe).
3. "A Perfiles agrégale TRUPER y quítale FOY" → `PATCH` con `brandIds` por diff (ya existe, por nombre).
4. "Registra a Ferretería López, surte PRETUL" cuando PRETUL no existe → `POST /api/brands` + `POST /api/suppliers`. Hoy falla: la marca se crea en la app.
5. "Borra el proveedor duplicado 'Tornillos  MX'" → `DELETE /api/suppliers/[id]`. Si tiene facturas, primero se reasignan (`PATCH /api/payables/[id]` `supplier_id`, ver [[02-Arquitectura/MCP-Escrituras/Finanzas]]).
6. "La marca SUTREK está mal escrita, es SURTEK" → `PATCH /api/brands/[id]`. Si SURTEK ya existe da 400: renombrar no fusiona.
7. "Borra la marca FOY, ya nadie la surte" → `DELETE /api/brands/[id]` (bloqueado si sigue asignada).
8. "¿Qué marcas tengo dadas de alta?" → lectura sin tool hoy (ver hallazgo de cobertura).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Alta de proveedor | bajo | Solo contacto; si fallan las marcas se revierte; nombre único |
| Editar contacto / días de crédito | bajo | Reversible; el plazo solo pre-llena facturas nuevas |
| Agregar / quitar marcas a un proveedor | bajo | Diff por nombre, reversible |
| Borrar proveedor | medio | Irreversible: se pierden el contacto y las marcas asignadas; la BD lo bloquea si tiene facturas |
| Crear marca | bajo | Entrada de catálogo; el riesgo es una marca basura por un error de dedo (ADR-037) → se confirma el nombre normalizado |
| Renombrar marca | bajo | Reversible; cambia el nombre en todos sus proveedores; no fusiona |
| Borrar marca | bajo | Bloqueado mientras esté asignada; se recrea igual (la UI ni pide confirmación) |

## Propuesta de tools

**1. `save_supplier` (existe, se extiende)** — entidad: proveedor.
- Nuevos parámetros: `quitar?: true` y `confirmar?: true`.
- Borrar es de riesgo medio: sin `confirmar`, devuelve el resumen (nombre, marcas, días de crédito y cuántas facturas tiene) y no borra nada; con `confirmar: true`, borra.
- Si tiene facturas, error con el conteo y la pista "reasígnalas con la escritura de facturas".
- Arreglar `resolveSupplier`: aceptar UUID y preferir el nombre exacto (como `resolveEmployee`). Beneficia también a `create_payable`, `update_payable` y `list_payables`.
- `adminOnly`: sí, por la decisión de #155 (ver pregunta 1: hoy la recibe un member).
- Refactor: `deleteSupplier(db, id)` en `suppliers-store.ts` (pre-conteo de `payables`, 23503 como respaldo, 404 si no existe), compartido con `DELETE /api/suppliers/[id]`.
- Costo: 0 tools; unos 150 caracteres más de descripción y esquema (estimado).

**2. `save_brand` (nueva)** — entidad: marca del catálogo.
- Parámetros:
  - `marca?`: la existente, para renombrar o borrar; ausente = alta;
  - `nombre?`: la nueva o el nombre nuevo;
  - `quitar?: true`.
- Todo pasa por `normalizeBrandTag`. La marca se busca por nombre exacto normalizado; si no está, error que lista el catálogo (como `brandIdsFor`).
- Respuesta: la marca y su conteo de proveedores. Así cubre de paso la pregunta "¿qué marcas hay?".
- Confirmación: directo (riesgo bajo). La guía general del servidor ya pide confirmar el nombre antes de escribir.
- `adminOnly`: sí.
- Refactor: `createBrand`, `renameBrand` y `deleteBrand` (con el mensaje del conteo) en `suppliers-store.ts` o en `brands-store.ts`, compartidos con `POST /api/brands` y `PATCH`/`DELETE /api/brands/[id]`. Hoy los tres viven inline.
- Costo: +1 tool, ~900 caracteres de `tools/list` (estimado).

**Alternativa mínima (0 tools):** `save_supplier.crear_marcas?: true`, que da de alta las marcas de `agregar_marcas` que no existan, igual que el botón "Crear marca y asignarla" del formulario. Renombrar y borrar marcas se quedan en la app (es raro y la app lo hace en un clic). Exige revertir explícitamente la decisión de ADR-037 de no crear marcas desde el MCP, aunque aquí la creación es opt-in.

**Total del módulo:** +1 tool nueva (`save_brand`) en la propuesta principal, o 0 con la alternativa mínima.

## Fuera a propósito

- En la propuesta principal no queda fuera ninguna ruta del módulo.
- Los `brandIds` (UUID) crudos no se exponen al modelo: el MCP trabaja por nombre de marca.
- No se inventa un "quitar esta marca a todos sus proveedores" ni un "fusionar dos marcas": la app no los tiene, y la regla de borrar una marca en uso es justamente que no se pueda.

## Preguntas abiertas

1. Hoy `save_supplier` la recibe un member. ¿Pasa a `adminOnly` como toda escritura nueva? Ojo: la RLS de `suppliers`/`brands`/`supplier_brands` es `USING (true)`, así que `adminOnly` sería la única barrera del lado MCP, y en la app un member sigue pudiendo hacer todo.
2. Marcas: ¿`save_brand` completa (+1 tool) o solo `crear_marcas` en `save_supplier` (0 tools, renombrar/borrar en la app)?
3. Borrar un proveedor con facturas: ¿basta el error con el conteo, o la tool debe ofrecer reasignarlas a otro proveedor en la misma llamada? Propuesta: no, son dos escrituras de dos entidades.
4. ¿Se arregla `resolveSupplier` (UUID + nombre exacto) en el mismo PR? Hoy un proveedor cuyo nombre está contenido en otro no se puede elegir.
5. ¿Se aprovecha la extracción para que `PATCH /api/suppliers/[id]` sea atómico (RPC o rollback del diff), o se acepta la escritura a medias actual?
