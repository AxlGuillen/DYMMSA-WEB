# MCP escrituras — Matriz y hallazgos (Fase 0)

> Issue #155 · Fase 0 (mapa, sin código) · 2026-10-22
> Cada fila sale de leer el código (rutas, `src/lib/`, `src/lib/mcp/`, `supabase/schema.sql`) y, donde hizo falta, de consultas SELECT a la nube. El detalle de cada ruta vive en su ficha.

## Fichas

**Plan y auditorías:**
- [[02-Arquitectura/MCP-Escrituras/01-Plan]]: dos conectores, composición de tools y código.
- [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]]
- [[02-Arquitectura/MCP-Escrituras/Auditoria-Odoo]]
- [[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]]

| Módulo | Ficha |
|---|---|
| Cotizaciones | [[02-Arquitectura/MCP-Escrituras/Cotizaciones]] |
| Aprobación pública | [[02-Arquitectura/MCP-Escrituras/Aprobacion-publica]] |
| Órdenes (ciclo de vida, ítems, recepción) | [[02-Arquitectura/MCP-Escrituras/Ordenes]] |
| Órdenes · planificador de compra y plan de corte | [[02-Arquitectura/MCP-Escrituras/Ordenes-compra-y-corte]] |
| Inventario | [[02-Arquitectura/MCP-Escrituras/Inventario]] |
| BD ETM (productos) | [[02-Arquitectura/MCP-Escrituras/Productos-ETM]] |
| Catálogo URREA | [[02-Arquitectura/MCP-Escrituras/Catalogo-URREA]] |
| Proveedores y marcas | [[02-Arquitectura/MCP-Escrituras/Proveedores-y-marcas]] |
| Materiales (presentaciones de corte) | [[02-Arquitectura/MCP-Escrituras/Materiales]] |
| Ajustes | [[02-Arquitectura/MCP-Escrituras/Ajustes]] |
| Finanzas (facturas por pagar, refrescos de Odoo) | [[02-Arquitectura/MCP-Escrituras/Finanzas]] |
| Horas | [[02-Arquitectura/MCP-Escrituras/Horas]] |
| Nómina | [[02-Arquitectura/MCP-Escrituras/Nomina]] |
| Equipo y Mi perfil | [[02-Arquitectura/MCP-Escrituras/Equipo-y-perfil]] |
| Tareas | [[02-Arquitectura/MCP-Escrituras/Tareas]] |

## Números

- **57 rutas** de negocio escriben (más el transporte del propio MCP, `src/app/api/[transport]`, que no cuenta), con **67 handlers** `POST`/`PATCH`/`PUT`/`DELETE`. El issue decía «unos 85»: el conteo real es 67.
- **Hoy:**
  - El MCP tiene **15 tools de escritura**: 12 del bloque app y 3 de Odoo.
  - El bloque app tiene **36 de 36** tools.
  - El `tools/list` completo del admin mide **46,692 de 47,000** caracteres, medido el 2026-10-22 con el método de `tests/mcp/manifest.test.ts`: nombre + título + descripción + esquema + `_meta`. En el cable (con anotaciones y estructura JSON) son **53,163**, según el snapshot de #155 A1. Los 46,588 del review del PR #152 son anteriores a las escrituras con moneda de #153.
- **Lo que propone el mapa:** 13 tools de escritura nuevas y 4 que salen por fusión, así que el bloque app queda **+9 neto → 45**.
  - Fusionar también lecturas (`list_quotations`, `list_orders`, `get_cut_plan`, `get_purchase_plan`, `get_hours_trend`, y `create_task` con `update_task`) lo deja en **~39**.
  - Ni con todas las fusiones cabe en 36, y el `tools/list` ya está a 400 caracteres de su tope. **Ese es el dato duro para decidir si se separa en dos conectores.**

## Matriz

Columnas:
- **Lógica hoy:** dónde vive la regla. `ruta` = inline en el handler, `lib` = ya compartida en `src/lib/`, `mixta` = parte y parte. La lógica `ruta`/`mixta` se extrae a un store antes de cablear la tool.
- **Confirmación:**
  - `directo`: escribe de una vez.
  - `confirmar`: la tool devuelve un resumen y pide `confirmar: true`.
  - `vista previa`: clave HMAC firmada, como `odoo_preview_quotation`.

| Módulo | Ruta | Tool propuesta | Riesgo | Confirmación | Lógica hoy | Nota |
|---|---|---|---|---|---|---|
| Cotizaciones | `POST /api/quotations/save` | save_quotation (crear) | medio | confirmar | mixta | El merge Excel↔catálogo y la validación viven en el cliente (`quoter/page.tsx`); auto-learn pisa `etm_products.price` |
| Cotizaciones | `PATCH /api/quotations/[id]/update` | save_quotation (editar) | medio (alto en sent_for_approval) | confirmar | mixta | Replace-all delete+insert: ids nuevos en cada guardado, sin transacción ni versión; re-aprende todas las líneas |
| Cotizaciones | `PATCH /api/quotations/[id]/status` | save_quotation (estado) | medio | confirmar | ruta | Regenera `approval_token` (incluso al mismo estado); sin matriz de transiciones; sella `approved_at` |
| Cotizaciones | `POST /api/quotations/[id]/send-for-approval` | save_quotation (estado) | bajo | directo | ruta | Solo desde draft; conserva el token; no valida líneas |
| Cotizaciones | `DELETE /api/quotations/[id]` | fuera | alto | — | ruta | Irreversible, en cascada, sin bitácora; bloqueada con orden ligada |
| Cotizaciones | `POST /api/quotes/lookup` | fuera (es lectura) | bajo | — | mixta | POST que solo lee; la red de escritura debe clasificarla como lectura |
| Aprobación pública | `POST /api/approve/[token]` | fuera | alto | — | ruta | Es la voz del cliente (service role, sin sesión); lo interno va por save_quotation |
| Órdenes | `POST /api/quotations/[id]/create-order` | save_order (crear desde cotización) | alto | vista previa | mixta | Descuenta stock al final sin transacción; **bug de model_code repetido** |
| Órdenes | `POST /api/orders/create` | save_order (orden manual) | alto | vista previa | mixta | Validación mínima; mismo bug de duplicados; incluirla es pregunta abierta |
| Órdenes | `PATCH /api/orders/[id]` | save_order (odoo_id) | bajo | directo | ruta | Solo `odoo_id`; no está en API-Routes.md |
| Órdenes | `DELETE /api/orders/[id]` | fuera | alto | — | mixta | Restaura stock solo en ordered/received y luego ignora el error del delete |
| Órdenes | `PATCH /api/orders/[id]/status` | save_order (estado) | medio | confirmar | ruta | Cualquier transición entre ordered/received/delivered/completed; el estado decide si borrar devuelve stock |
| Órdenes | `POST /api/orders/[id]/cancel` | save_order (cancelar) | alto | confirmar | mixta | Terminal; restaura antes del update sin revisar su error; permite cancelar delivered |
| Órdenes | `POST /api/orders/[id]/confirm-reception` | save_order_items (recibir) | alto | vista previa | mixta | Delta del excedente (ADR-019) sin transacción; no acota ítems a la orden |
| Órdenes | `POST /api/orders/[id]/items` | save_order_items (agregar) | medio | confirmar | mixta | Descuenta stock antes del insert y no lo devuelve si falla |
| Órdenes | `PATCH /api/orders/[id]/items/[itemId]` | save_order_items (editar) | medio | directo (entrega) / confirmar (precio) | ruta | No revisa el error del update |
| Órdenes | `DELETE /api/orders/[id]/items/[itemId]` | save_order_items (quitar) | medio | confirmar | ruta | Devuelve solo `in_stock`, en cualquier estado abierto |
| Órdenes | `POST /api/orders/auto-learn` | fuera | medio | — | ruta | Alta de ETMs con brand=URREA fijo; es paso previo de la orden manual |
| Órdenes · compra y corte | `PUT /api/orders/[id]/purchase-decisions` | save_purchase_decisions | medio | confirmar | mixta | Replace-all; el server confía en std/needed del cliente y no bloquea «Revisar» |
| Órdenes · compra y corte | `PUT /api/orders/[id]/cut-plan` | save_cut_plan | medio | directo (agregar) / confirmar (quitar) | mixta | Replace-all sin transacción; `source_item_id` no se acota a la orden |
| Inventario | `POST /api/inventory` | save_inventory_item (alta) | medio | confirmar | ruta | Con cantidad 0 = directo; model_code solo trim |
| Inventario | `PATCH /api/inventory/[id]` | save_inventory_item (reemplaza set_inventory_location) | medio | confirmar | ruta | Gaveta sola = directo; cantidad absoluta, no atómica frente a create-order, sin bitácora |
| Inventario | `DELETE /api/inventory/[id]` | fuera | medio | — | ruta | Se pierde la gaveta sin rastro; responde ok aunque no exista |
| Inventario | `POST /api/inventory/import` | fuera (el conteo por lote va en save_inventory_item) | alto | — | ruta | Replace borra todo fila por fila sin transacción |
| Productos ETM | `POST /api/products` | save_product (alta) | bajo | directo | ruta | La guarda ADR-013 solo vive en `ProductForm`: llevarla al store |
| Productos ETM | `PATCH /api/products/[id]` | save_product | bajo | directo | ruta | Confirmar si cambia etm/model_code/marca; acepta precio negativo |
| Productos ETM | `DELETE /api/products/[id]` | fuera | medio | — | ruta | Se pierden curada, is_sold y cut_*; el auto-learn lo recrea incompleto |
| Productos ETM | `POST /api/products/import` | fuera | alto | — | ruta | 1,611 filas; el upsert pisa con vacíos |
| Catálogo URREA | `POST /api/urrea-catalog` | save_catalog_item (alta) | medio | confirmar | mixta | El código pasa de compra local a URREA en todas las órdenes |
| Catálogo URREA | `PATCH /api/urrea-catalog/[id]` | save_catalog_item | medio | confirmar | mixta | Cambiar std deja desactualizadas las decisiones de mayoreo; std no se valida entero |
| Catálogo URREA | `DELETE /api/urrea-catalog/[id]` | fuera | alto | — | ruta | Saca el código del Excel URREA sin rastro |
| Catálogo URREA | `POST /api/urrea-catalog/import` | fuera | alto | — | mixta | 14,067 filas; un replace fallido deja el catálogo vacío |
| Catálogo URREA | `POST /api/urrea-catalog/lookup` | fuera (es lectura) | bajo | — | lib | Lo cubre search_urrea_catalog |
| Proveedores y marcas | `POST /api/suppliers` | save_supplier (existe) | bajo | directo | lib | Ya cubierta (ADR-037) |
| Proveedores y marcas | `PATCH /api/suppliers/[id]` | save_supplier (existe) | bajo | directo | lib | Ya cubierta; el diff de marcas no es atómico |
| Proveedores y marcas | `DELETE /api/suppliers/[id]` | save_supplier + `quitar` | medio | confirmar | ruta | Extraer `deleteSupplier`; 23503 si tiene facturas |
| Proveedores y marcas | `POST /api/brands` | save_brand | bajo | directo | ruta | `normalizeBrandTag`; alternativa: `crear_marcas` en save_supplier |
| Proveedores y marcas | `PATCH /api/brands/[id]` | save_brand | bajo | directo | ruta | Renombrar; 23505 si ya existe (no fusiona) |
| Proveedores y marcas | `DELETE /api/brands/[id]` | save_brand + `quitar` | bajo | directo | ruta | 400 con conteo si está en uso |
| Materiales | `POST /api/material-presentations` | save_material_presentation (existe) | bajo | directo | mixta | Upsert repetido en ruta y tool |
| Materiales | `DELETE /api/material-presentations/[id]` | save_material_presentation + `quitar` | bajo | directo | ruta | Borrar por medidas (llave UNIQUE), no por id |
| Ajustes | `PATCH /api/settings` | save_app_settings | medio | confirmar | ruta | Whitelist inline → settings-store; 3 keys; ADR-037 lo dejó fuera |
| Finanzas | `POST /api/payables` | save_payable (fusiona create_payable) | bajo | directo | mixta | Validación duplicada ruta/tool; siempre nace pending |
| Finanzas | `PATCH /api/payables/[id]` | save_payable (fusiona update_payable + mark_payable_paid) | bajo (medio: cifras de una pagada) | directo / confirmar | mixta | Falta reactivar cancelada; el trigger no audita monto ni moneda |
| Finanzas | `DELETE /api/payables/[id]` | save_payable + `quitar` | medio | confirmar | ruta | Borrado duro; propuesta: las pagadas no |
| Finanzas | `POST /api/finance/income/refresh` | fuera | bajo | — | mixta | Solo purga caché; opcional `fresco: true` en get_month_closing |
| Finanzas | `POST /api/clients/refresh` | fuera | bajo | — | ruta | Ninguna tool usa esa caché |
| Horas | `POST /api/time-entries` | save_time_entries (existe) | bajo | directo | lib | `createManualEntry` compartida |
| Horas | `PATCH /api/time-entries/[id]` | save_time_entries (existe) | bajo | directo | lib | `correctTimeEntry` |
| Horas | `DELETE /api/time-entries/[id]` | save_time_entries + `checada.borrar` | medio | confirmar | ruta | Extraer `deleteTimeEntry`; el re-import restaura las importadas |
| Horas | `POST /api/time-entries/import` | save_time_entries (filas, existe) | medio | vista previa | lib | `preview_time_report` aún sin clave HMAC; el binario queda fuera (ADR-035) |
| Horas | `POST /api/excused-days` | save_excused_day (existe) | bajo | directo | mixta | La tool hace upsert inline, la ruta solo insert |
| Horas | `DELETE /api/excused-days/[id]` | save_excused_day (existe) | bajo | directo | mixta | Borrado duplicado ruta/tool |
| Nómina | `PUT /api/payroll/days` | save_payroll_period (`corregir_dia`) | medio | confirmar | mixta | Queda manual+confirmado; borrado del día vacío inline |
| Nómina | `POST /api/payroll/employees` | save_payroll_employee (existe) | bajo | directo | lib | `createEmployee` |
| Nómina | `PATCH /api/payroll/employees/[id]` | save_payroll_employee (existe) | bajo | directo | lib | Cambiar jornada recalcula cortes cerrados |
| Nómina | `PATCH /api/payroll/periods/[start]` | save_payroll_period (`cerrar`/`reabrir`) | medio | confirmar | lib | `setPeriodClosed`; re-cerrar re-sella |
| Nómina | `POST /api/payroll/periods/[start]/confirm` | save_payroll_period (`confirmar_borradores`) | alto | vista previa | lib | ADR-033 lo descartó; clave sobre el set de borradores |
| Nómina | `POST /api/payroll/periods/[start]/prefill` | record_payroll_hours (existe) | bajo | directo | lib | `prefillFromHours`, solo borradores |
| Equipo y perfil | `PATCH /api/profile` | save_profile (sin persona = yo) | bajo | directo | mixta | Con adminOnly un member no edita su nombre/NSS desde el chat |
| Equipo y perfil | `POST /api/profile/avatar` | fuera | — | — | ruta | Binario + storage solo de la carpeta propia |
| Equipo y perfil | `DELETE /api/profile/avatar` | fuera | bajo | — | ruta | Para otra persona deja el archivo huérfano |
| Equipo y perfil | `PATCH /api/profiles/[id]` | save_profile (con persona) | medio | confirmar | ruta | Extraer `updateProfileAsAdmin`; rol y tarifa fuera por default |
| Tareas | `POST /api/tasks` | create_task (existe) | bajo | directo | mixta | Reporter fijo «Asistente (MCP)»; podría usar `ctx.email` |
| Tareas | `PATCH /api/tasks/[number]` | update_task (existe) | bajo | directo | mixta | Mezcla de labels/state_reason duplicada → tasks-store |
| Tareas | `POST /api/tasks/[number]/comments` | update_task (existe) | bajo | directo | mixta | Sin rollback a propósito |
| Tareas | `POST /api/tasks/upload` | fuera | medio | — | ruta | Binario por chat; bucket público con service role |

**Conteo:** 67 handlers.
- **50 al MCP:**
  - 16 ya cubiertos por tools que existen: 14 marcados «existe» más los 2 de facturas, que hoy cubren `create_payable`/`update_payable`/`mark_payable_paid`.
  - 34 los cubren tools nuevas o extendidas.
- **17 fuera a propósito:**
  - **4 son lecturas o caché:** `quotes/lookup`, `urrea-catalog/lookup`, `finance/income/refresh` y `clients/refresh`.
  - **13 son decisión:**
    - borrados de cotización, orden, inventario, producto y catálogo;
    - los imports de inventario, productos y catálogo;
    - `approve/[token]` y `orders/auto-learn`;
    - el avatar (POST y DELETE) y la subida de imágenes de tareas.

## Tools: lo que propone el mapa

> **Superado por [[02-Arquitectura/MCP-Escrituras/01-Plan]] §3** (2026-10-22). Cambios respecto de esta tabla:
> - no se fusionan lecturas;
> - no hay `save_brand` (las marcas se crean con `save_supplier.crear_marcas`);
> - la recepción va en `save_order_reception`;
> - los borrados van en `delete_record`.
>
> El total objetivo queda en 44 tools. Esta tabla se conserva como la propuesta original del mapa.

| Módulo | Nuevas | Salen o se fusionan | Neto en escrituras | Fusión de lectura opcional |
|---|---|---|---|---|
| Cotizaciones | `save_quotation` | — | +1 | `list_quotations` → `get_quotation` (−1) |
| Órdenes | `save_order`, `save_order_items`, `save_purchase_decisions`, `save_cut_plan` | — | +4 | `list_orders`, `get_cut_plan`, `get_purchase_plan` → `get_order` (−3) |
| Inventario | `save_inventory_item` | `set_inventory_location` | 0 | — |
| Productos ETM | `save_product` | — | +1 | — |
| Catálogo URREA | `save_catalog_item` | — | +1 | — |
| Proveedores y marcas | `save_brand` | — (save_supplier gana `quitar`) | +1 | — |
| Materiales | — | — (save_material_presentation gana `quitar`) | 0 | — |
| Ajustes | `save_app_settings` | — | +1 | — |
| Finanzas | `save_payable` | `create_payable`, `update_payable`, `mark_payable_paid` | −2 | — |
| Horas | — | — (save_time_entries gana `checada.borrar`) | 0 | `get_hours_trend` → `get_week_hours` (−1) |
| Nómina | `save_payroll_period` | — | +1 | — |
| Equipo y perfil | `save_profile` | — | +1 | — |
| Tareas | — | — | 0 | `create_task` + `update_task` → `save_task` (−1) |
| **Total** | **13** | **4** | **+9 → 45 de 36** | **−6 → ~39** |

## Hallazgos transversales (entran a la Fase 1, ADR-041)

1. **El stock no es atómico.**
   - Create-order, orden manual, recepción, cancelar, borrar orden e ítems hacen leer → calcular → escribir un absoluto desde la ruta, sin transacción.
   - Varios restauran stock y luego ignoran el error del paso siguiente, así que un reintento duplica el stock.
   - Antes de abrir Órdenes o Inventario al MCP hace falta una función en la BD (RPC transaccional, o al menos un delta atómico sobre `store_inventory`).
2. **La RLS de casi todo el negocio está abierta** (`FOR ALL TO authenticated USING (true)`): quotations, orders, store_inventory, etm_products, urrea_catalog, suppliers, brands, payables, app_settings, material_presentations…
   - `adminOnly` en el MCP solo quita la tool de la lista de un member; no es una barrera.
   - La whitelist de `/api/settings` solo existe en la ruta: por PostgREST se escribe cualquier key.
   - Decidir si «solo admin» es una regla de producto (la lista de tools) o de seguridad (cambiar policies, cosa que afecta a la app de los members).
3. **El secreto HMAC de las vistas previas está atado a Odoo.** `src/lib/odoo/preview-token.ts` lo deriva de `ODOO_WRITE_API_KEY`, que en Production solo existe por ventanas. Las vistas previas de DYMMSA necesitan su propio secreto y un firmador fuera de `src/lib/odoo/`.
4. **No hay referencias estables para líneas y piezas.**
   - `update` de cotizaciones es replace-all: ids nuevos en cada guardado y sin versión.
   - `get_order` no expone el id ni el número de línea de los ítems, y `get_cut_plan` no expone el id de pieza.
   - Para editar «la línea 4» hace falta `linea` + `version` (concurrencia optimista).
5. **Lógica inline que hay que extraer a stores antes de cablear:**
   - Cotizaciones: `quotations-store` / `quotation-edit`, y mover al server el lookup, el prellenado y la validación.
   - Órdenes: `orders-store`, `purchase-decisions-store`, `parseCutPieces`.
   - Catálogos: stores de inventario, productos y catálogo.
   - Varias: `settings-store`, `tasks-store`, `deleteSupplier`, `deleteTimeEntry`, `updateProfileAsAdmin`, store de justificantes y la validación de facturas (hoy duplicada en ruta y tool).
6. **Siete escrituras de hoy NO son adminOnly:** `save_supplier`, `save_material_presentation`, `create_payable`, `update_payable`, `mark_payable_paid`, `create_task` y `update_task`. Si «toda escritura es de admin», un member pierde, por ejemplo, «ya pagué la de Perfiles».
7. **Borrados:** la mayoría de los DELETE responden `{ ok: true }` aunque el id no exista (suppliers, brands, payables, inventory, products, catálogo). Hace falta una política de qué se borra por chat.
8. **Red anti-drift de escritura:** `tests/mcp/write-coverage.test.ts` debe clasificar los POST que solo leen (`quotes/lookup`, `urrea-catalog/lookup`) y los refrescos de caché, no solo los métodos.
9. **Nombres:** `save_quotation` junto a `odoo_save_quotation` arriesga confundir la cotización de la app con la de Odoo. Es otro argumento a favor de separar los conectores.
10. **Decisiones previas que este plan reabre:**
    - ADR-015, núcleo solo lectura (2026-08-20);
    - ADR-033, el MCP no confirma ni cierra nómina;
    - ADR-037, ajustes fuera;
    - ADR-034, no renombrar tools (`set_inventory_location` → `save_inventory_item`);
    - ADR-015, tareas sin editar título ni descripción.

    Se mantiene, salvo que se diga lo contrario, que la tarifa por hora no viaja por el MCP (2026-10-05).

## Bugs encontrados (independientes del MCP)

Están verificados en el código. Los primeros de la lista (stock y aprobación) conviene arreglarlos antes de abrir su módulo al MCP.

| Severidad | Módulo | Bug |
|---|---|---|
| Alta | Órdenes | create-order y orden manual: un `model_code` repetido en varias líneas se aparta contra el mismo stock; gana el último write y se aparta más de lo que hay |
| Alta | Órdenes | `/cancel` y `DELETE` de orden restauran stock y luego ignoran el error del update/delete; un reintento duplica el stock |
| Alta | Órdenes | `/cancel` restaura stock de órdenes `delivered`, y `DELETE` de ítem en una `delivered` regresa stock ya entregado |
| Alta | Órdenes | confirm-reception busca el ítem solo por `id`, sin `order_id`: puede tocar líneas de otra orden |
| Alta | Aprobación | Si DYMMSA edita mientras el cliente tiene la página abierta, «Enviar» deja la cotización `approved` con 0 líneas aprobadas y «Guardar avance» borra las aprobaciones (ids viejos) |
| Alta | Catálogo URREA | El import en modo replace borra todo y hace un solo insert: si falla, el catálogo queda vacío |
| Media | Órdenes | `POST /items` descuenta stock antes del insert y no lo devuelve si falla; `PATCH /items` responde éxito aunque falle |
| Media | Cotizaciones | `update` no es transaccional (0 ítems entre el delete y el insert) y no revisa el error del UPDATE del encabezado |
| Media | Cotizaciones | La validación de líneas solo corre en el cliente: hay 16 líneas sin cantidad en 4 cotizaciones convertidas. `quotation_items` no tiene CHECK de `delivery_time` ni de `item_type` |
| Media | Cotizaciones | `approved_at` se borra al rechazar y se re-sella al re-aprobar, al contrario de lo que dice CLAUDE.md (el test fija el comportamiento actual) |
| Media | Productos ETM | La regla ADR-013 (no guardar la oficial como curada) solo la aplica `ProductForm`; el import upsert pisa con vacíos y pone URREA sin model_code |
| Media | Finanzas | `PATCH` acepta `paid_at` sin status sobre una pendiente o cancelada; el trigger de bitácora no audita monto ni moneda, ni guarda `currency` en sus snapshots |
| Media | Equipo | Un admin puede cambiar `is_owner` por PostgREST; la guarda «al menos un administrador» solo vive en la ruta |
| Media | Nómina | Cambiar la jornada del empleado o el área del perfil recalcula los totales de cortes **cerrados** |
| Baja | Varios | DELETEs que responden ok sin existir; `DELETE /time-entries/[id]` con id malformado da 500; `std` decimal da 500; productos aceptan precio negativo |
| Baja | MCP | `resolveSupplier`/`resolvePerson` no priorizan el nombre exacto («Perfiles» choca con «Perfiles MX»); `get_month_closing` no usa `withinBudget()`; `search_inventory` no lee la vista con marca |
| Docs | — | API-Routes.md: falta `PATCH /api/orders/[id]`; `/cancel`, `lookup` y `prefill` desfasados. CLAUDE.md lista 2 keys de ajustes y son 3 (`cut_margin_mm`) |

**Pendiente de datos:** `clear_catalog_copied_dymmsa_description` no está aplicada en la nube; quedan 424 copias de la descripción oficial guardadas como curada. Es una de las migraciones pendientes de #149, que se aplica tras el deploy.

## Preguntas para la Fase 1

Las decisiones de arquitectura (ADR-041):

1. **¿Uno o dos conectores?** Ver «Números»: con un solo conector no cabe sin subir topes, y el `tools/list` ya está al 99%.
2. **¿Stock atómico en la BD (RPC) antes de abrir Órdenes e Inventario?**
3. ~~¿«Solo admin» es regla de producto o de seguridad?~~ **Resuelto el 2026-10-22: por ahora solo el admin se conecta al MCP**, así que las restricciones de «solo admin» no condicionan el diseño. El mecanismo de roles (#133) se queda como está, sin trabajo extra.
4. ~~¿Las 7 escrituras que hoy usan los members pasan a adminOnly?~~ Resuelto con la anterior.
5. **¿Secreto propio para las vistas previas de DYMMSA?** Por ejemplo, una variable `MCP_PREVIEW_SECRET`.
6. **¿Qué se puede borrar por chat?** La propuesta: proveedor, marca, medida, factura no pagada y checada sí; cotización, orden, producto, inventario y catálogo no.
7. **¿Qué escrituras dejan rastro en `audit_events`?** Por ejemplo, ajustes de stock y borrados.

Las de cada módulo están en la sección «Preguntas abiertas» de su ficha. Las que más pesan:
- **Cotizaciones:** ¿auto-learn en ediciones del chat? ¿Cambiar el precio de una línea aprobada la regresa a pendiente? ¿El chat puede dar el link de aprobación?
- **Inventario:** «conté 12», ¿escribe 12 o 12 − lo apartado por órdenes abiertas? ¿Delta o absoluto?
- **Nómina:** ¿se revierte ADR-033 para confirmar y cerrar cortes?
- **Equipo:** ¿cambiar rol por chat? La recomendación es que no.

## Siguiente paso

**Fase 1:** contestar las preguntas de arriba y escribir ADR-041. Con eso se fija el orden de las olas.

Propuesta de orden según lo que salió del mapa:

0. **Prerrequisitos.** Arreglar los bugs de stock y de aprobación, el secreto HMAC propio, la red `write-coverage` y la extracción de stores.
1. **Riesgo bajo.** Catálogos (productos, catálogo URREA, marcas, materiales, ajustes), Finanzas (`save_payable`), Tareas, Horas y Perfil.
2. **Cotizaciones.** Es el caso de Diego. Necesita el arreglo de `/approve`, el store de edición y `version` por cotización.
3. **Inventario (cantidades) y Órdenes.** Necesitan stock atómico.
4. **Nómina** (confirmar y cerrar) **y Equipo.**
