# MCP — Auditoría del conector DYMMSA-WEB

> Issue #155 · Auditoría contra la rúbrica R1–R12 · 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[04-Decisiones-Tecnicas/ADR-034-MCP-Reglas-de-Crecimiento]] · [[04-Decisiones-Tecnicas/ADR-037-MCP-Escrituras-Proveedores-Facturas-Nomina-Materiales]] · [[04-Decisiones-Tecnicas/ADR-040-Escrituras-Acotadas-en-Odoo]]
> Alcance: las 36 tools del bloque `app` (registro en `src/lib/mcp/server.ts`, implementación en `src/lib/mcp/tools/*.ts`). No cambia código. El bloque Odoo se audita aparte: a partir de ahora vive en su propio conector («Odoo DYMMSA», `/api/odoo/mcp`).

## Resumen

**Lo medido el 2026-10-22.** Se registró el servidor real con un stub que mide lo mismo que `tests/mcp/manifest.test.ts:42-49`: nombre, título, descripción, esquema JSON y `_meta`. Las anotaciones no entran en la cuenta.
- **36 tools**: 12,925 caracteres de descripción y 28,674 de `tools/list`.
- **24 lecturas**: 14,580 caracteres, unos 608 por tool.
- **12 escrituras**: 14,094 caracteres, unos 1,175 por tool. Sin `record_payroll_hours` el promedio baja a 971; esa tool sola mide 3,412.

**Veredictos sobre las 36:**

| Veredicto | Tools |
|---|---|
| Mantener | 7 |
| Ajustar | 21 |
| Renombrar | 2 |
| Fusionar | 6 |
| Retirar | 0 |

«Mantener» significa que la tool no necesita cambios propios más allá de las convenciones generales de la sección 4.

**Catálogo objetivo: 44 tools** (24 lecturas y 20 escrituras).
- **`tools/list`:** unos 43,800 caracteres, ±15 %. El promedio sube a unos 990 por tool porque entran las escrituras con esquemas grandes.
- **Descripciones:** unos 17,700 caracteres.
- **Instrucciones del conector:** unos 5,500 caracteres.
- **Topes que se proponen para el conector nuevo:** 45 tools, `listTotal` 46,000, `descriptionsTotal` 19,000 e instrucciones 6,000.

**Las cinco decisiones de composición:**
1. **Los borrados salen de los `save_x`** y van a una sola tool, `delete_record` (R1, R4 y R10). Así el usuario puede poner «Needs approval» solo en borrar y dejar «Always allow» en los `save_*`.
2. **Una sola confirmación en dos fases, con `clave` firmada,** para toda escritura de riesgo medio o alto, en lugar de `confirmar: true`. La primera llamada nunca escribe (R10).
3. **No se fusionan lecturas** (ni `list_*` dentro de `get_*`, ni los planes dentro de `get_order`), por R1 y R4. Lo que sí se hace es que los `get_*` acepten nombre o `ref` (R2). Separar los conectores libera el presupuesto que obligaba a esas fusiones.
4. **Las escrituras se fusionan por entidad:**
   - `save_payable` reemplaza 3 tools;
   - `save_task` reemplaza 2;
   - `save_inventory_item` reemplaza `set_inventory_location`;
   - `record_payroll_hours` se renombra a `save_payroll_hours` y gana la corrección de un día;
   - las líneas de una orden se editan dentro de `save_order`, y la recepción tiene su propia tool (`save_order_reception`);
   - `save_brand` no entra: lo cubre `save_supplier.crear_marcas`.
5. **Convenciones únicas:**
   - parámetros y enums en español;
   - una envoltura de respuesta estándar, con paginación `pagina`/`por_pagina`/`hay_mas`;
   - referencias cortas (`ref`, `linea`, `version`) y ningún UUID a la vista;
   - esquemas `.strict()` en las escrituras;
   - anotaciones completas;
   - `structuredContent`.

---

## 1. Hallazgos transversales

### H1 · Diez verbos para 36 tools (R4)
- **Lecturas:**
  - `get_` aparece 16 veces, `list_` 6, `search_` 3 y `preview_` 1.
  - `get_profiles` es un `get_` que devuelve una colección cuando no recibe `persona` (`server.ts:586`).
- **Escrituras:** 12 tools con 6 verbos distintos.
  - `save_` ×6;
  - `set_` (`set_inventory_location`), `mark_` (`mark_payable_paid`) y `record_` (`record_payroll_hours`);
  - `create_` ×2 y `update_` ×2 (facturas y tareas).
  - El mismo concepto (escribir una factura) se reparte en `create_payable`, `update_payable` y `mark_payable_paid`. ADR-037 dejó esa excepción viva solo para no renombrar.
- La mezcla es ruido: obliga al modelo a aprender un verbo por tool en vez de una regla.

### H2 · Dos idiomas en los parámetros y tres estilos en las respuestas (R5, R6)
- **Parámetros en inglés en 12 tools:**
  - `list_quotations` y `list_orders`: `status`, `search`, `page`, `pageSize`;
  - `get_quotation` y `get_order`: `id`;
  - `search_inventory`: `search` y `stockFilter`, en camelCase;
  - `set_inventory_location`: `model_code`, `location`;
  - `search_products` y `search_urrea_catalog`: `query`;
  - `list_tasks`, `get_task`, `create_task` y `update_task`: `state`, `priority`, `number`, `task_number`, `title`, `comment`, `state_reason`.
  - El bloque compartido `pagination` también está en inglés (`server.ts:73-76`).
  - Las otras 24 usan español.
  - El mismo concepto cambia de nombre entre tools vecinas:
    - `get_task.number` contra `update_task.task_number` (`server.ts:680` contra `:710`);
    - `get_order.id` contra `get_cut_plan.orden` (`:207` contra `:219`).
- **Tres estilos de llave en las respuestas:**
  - inglés snake_case: `quotations.ts`, `orders.ts`, `inventory.ts`, `products.ts`, `urrea.ts`;
  - inglés camelCase en tareas: `closedReason`, `createdAt`, `commentsCount` (`src/lib/github.ts:97-112`);
  - español snake_case en todas las demás.
  - Una misma respuesta llega a mezclarlos: `setInventoryLocation` devuelve `model_code`, `quantity`, `ubicacion` y `nota` (`inventory.ts:101-106`).
- **Los tokens de entrada y de salida no coinciden:** `list_payables` pide `estado: pending|overdue|paid|cancelled` (`server.ts:362`), pero cada factura sale con la etiqueta «Pendiente» o «Pagada» (`payables.ts:43`). El modelo lee un token y debe mandar otro.

### H3 · Enums declarados como `z.string()` y valores inválidos que se ignoran en silencio (R5, R7)
- **`z.string()` donde va un enum:** `server.ts:164`, `:192`, `:264`, `:362`, `:666`, `:667`, `:695`, `:712-714`. La lista de valores permitidos vive en la prosa de la descripción, así que el esquema no la impone.
- **Fallbacks silenciosos:**
  - un `status` inválido devuelve **todas** las cotizaciones u órdenes, sin filtrar (`quotations.ts:32`, `orders.ts:47`);
  - un `stockFilter` inválido cae a `all` (`inventory.ts:25-27`);
  - un `state` inválido cae a `open` (`tasks.ts:26`);
  - una prioridad inválida se ignora al listar (`tasks.ts:36`) y al crear (`tasks.ts:73`).
- El modelo recibe un resultado y cree que filtró.

### H4 · Cinco formas de paginar y truncados sin aviso (R6)

| Forma | Tools | Problema |
|---|---|---|
| `page`/`pageSize` → `count`, `page`, `pageSize`, `totalPages` | `list_quotations`, `list_orders`, `search_inventory`, `search_products` | En inglés |
| `limit` sin `offset` | `list_suppliers`, `list_payables` (`payables.ts:89-96`) | No hay forma de llegar más allá de 100 |
| `page` fijo de 30, sin total ni `hay_mas` | `list_tasks` (`tasks.ts:29-43`) | El modelo no sabe si hay más |
| Tope fijo de 20, sin aviso | `search_urrea_catalog`, parcial (`urrea.ts:32`) | Truncado silencioso |
| `limit` ≤ 50 | `list_time_imports` | — |

**Truncados silenciosos:**
- `get_business_summary` cuenta trayendo tablas completas: `select('status')` y `select('quantity')` (`quotations.ts:116`, `inventory.ts:51`, `summary.ts:15`). PostgREST corta en 1,000 filas por default, y nadie lo avisaría.
- Las tareas abiertas topan en 100 (`summary.ts:33-41`).
- Los comentarios de `get_task` topan en 100 (`tasks.ts:53`).

**Buenos ejemplos que se toman como estándar:**
- `truncado` y `nota` de `get_payables_overview` y `get_month_closing` (`payables.ts:265,282`, `finance.ts:86,103-104`);
- la `nota` de `list_suppliers` cuando el barrido de marcas se corta (`suppliers.ts:59-63`).

### H5 · Envolturas y valores de `accion` inconsistentes (R6)
- **Colecciones:** cada tool envuelve distinto.
  - `{ quotations|orders|items|products, count, page, pageSize, totalPages }`;
  - `{ total, mostrados, nota, proveedores }`;
  - `{ hoy, total_coincidencias, mostradas, suma_mostrada, facturas }`;
  - `{ tasks, page, state }`;
  - `{ match, items, message? }`;
  - `{ nota, cargas }`;
  - `{ total, perfiles, nota }`.
- **Escrituras:**
  - `accion` toma valores sin regla: `creado`, `actualizado`, `registrada`, `ya_existia`, `corregida`, `registrada a mano` (con espacio), `quitado`, `marcado`.
  - `create_task` devuelve la tarea cruda en camelCase.
  - Solo `update_payable` devuelve `cambios` (antes/ahora) (`payables.ts:207-211`).

### H6 · UUIDs expuestos, entradas que solo aceptan UUID y documentos sin referencia de línea (R2, R6)
- **UUIDs en las respuestas:**

  | Archivo | Campos |
  |---|---|
  | `quotations.ts` | `id` (`:45`), `orden.id` (`:107`) |
  | `orders.ts` | `id` y `quotation_id` (`:60,65`), `quotation_id` (`:115`) |
  | `suppliers.ts` | `id` (`:15`) |
  | `payables.ts` | `id` (`:34`) |
  | `purchase.ts` | `orden.id` (`:85`) |
  | `cutting.ts` | `orden.id` (`:64`) y, el peor, `no_caben[].pieza`, que es el UUID de la pieza con nombre de número (`:27-28`) |
  | `payroll.ts` | el `employee_id` de respaldo en `omitidos` (`:151,173`) |

- **Entradas que solo aceptan UUID:** `get_quotation` (`server.ts:179`; la propia descripción dice «Obtén el id con list_quotations», `:178`) y `get_order` (`:207`), aunque `resolveOrder()` ya existe (`orders.ts:12-29`).
- **Documentos sin referencia de línea:** las líneas de cotización y orden no traen `linea` ni versión (`quotations.ts:77-96`, `orders.ts:90-108`), y las piezas de corte no traen número. Para editar «la línea 4» no hay de dónde agarrarse (hallazgo 4 de la matriz).

### H7 · Anotaciones incompletas en las 12 escrituras (R8)
- **Lecturas:** `{ readOnlyHint: true, openWorldHint: false }` (`server.ts:64`). Es correcto; `destructiveHint` e `idempotentHint` solo significan algo cuando `readOnlyHint` es false.
- **Escrituras:** las 12 dicen solo `{ readOnlyHint: false, openWorldHint: false }` (`server.ts:239, 283, 350, 409, 430, 453, 557, 576, 635, 654, 698, 718`). Por los defaults de la spec, las 12 se anuncian **destructivas y no idempotentes**.
  - **Debería ser `destructiveHint: false`:** las que solo agregan, `save_material_presentation` (upsert por llave) y `create_task`.
  - **Debería ser `idempotentHint: true`:**
    - `save_material_presentation`, `set_inventory_location` y `save_excused_day`;
    - `save_supplier` y `save_payroll_employee` (el nombre es UNIQUE);
    - `save_time_entries` (el import es idempotente por diseño, ADR-035);
    - `mark_payable_paid` (repetir sin fecha da error y no re-sella).
- Las anotaciones no entran en la medición de `manifest.test.ts:49`. Completarlas cuesta unos 60 caracteres por tool en el cable y nada en el presupuesto del test.

### H8 · Descripciones que guían flujos, empujan otras tools o repiten reglas (R9, R11)
- **Empujes a llamar algo sin que el usuario lo pida:**
  - «Úsala primero» en `get_business_summary` (`server.ts:150`, repetido en las instrucciones, `:110`);
  - «Obtén el id con list_quotations» (`:178`);
  - «dalo de alta con save_supplier» (`:419`);
  - «antes carga el reporte con save_time_entries» (`:614`);
  - el paso 5 de `SHEET_GUIDE`, que manda a `save_payroll_employee` (`:100`).
- **Respuestas que también empujan:**
  - `saveMaterialPresentation`, hacia `get_cut_plan` (`cutting.ts:148`);
  - `NO_ACCESS` y la nota del alta de empleado (`payroll.ts:24,235`);
  - `siguiente_paso` de `preview_time_report` (`hours.ts:321`). Este se tolera: es el gemelo de lectura de su escritura.
- **Reglas repetidas:**
  - «ESCRIBE… confirma antes» aparece en 10 descripciones y repite la regla general de las instrucciones (`server.ts:131`).
  - Seis descripciones explican quién ve qué según el rol (`:475-477, :492, :505, :586-588, :600`). Con solo el admin conectado es ruido.
  - Entre las dos cosas son unos 1,300 caracteres.
- **Lo que sí está bien:** distinguirse de las vecinas. Por ejemplo, «Pagarla… es mark_payable_paid» en `update_payable` (`:440`). Eso pide R9.

### H9 · Sin `outputSchema` ni `structuredContent` (R6)
- `run()` solo devuelve `content: [{ type: 'text', text: JSON.stringify(data) }]` (`server.ts:48-61`). Las vistas MCP Apps leen `_meta`, no `structuredContent`.
- Ojo con el presupuesto (R11): `outputSchema` **sí viaja en `tools/list`**. Publicarlo en las 44 tools sumaría entre 9,000 y 18,000 caracteres.
- **Propuesta:** devolver siempre `structuredContent` (no cuesta en `tools/list`) además del texto JSON, y publicar `outputSchema` solo donde una vista o un encadenamiento lo pida. Si se adopta, el test tiene que empezar a medirlo.

### H10 · Errores (R7)
- **Validación de zod:** el SDK la convierte en un resultado `isError` con un texto en inglés del tipo `MCP error -32602: Input validation error: Invalid arguments for tool …: [json de zod]` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:141,178`). No está en español y no trae un ejemplo válido.
- **Campos desconocidos:** el *raw shape* se envuelve en un `z.object` que los **descarta en silencio**. Caso real: `set_inventory_location` con `{ model_code: '6954', cantidad: 12 }` descarta `cantidad`; como `location` viene ausente, **borra la gaveta** y responde éxito (`server.ts:277,280`, `inventory.ts:73`).
- **Mensajes con el texto crudo de PostgREST:** `Error al obtener…: ${error.message}` aparece en casi todos los archivos (p. ej. `quotations.ts:40`).
- **«No encontrada» sin pista:** «Cotización no encontrada» y «Orden no encontrada» no dicen cómo seguir (`quotations.ts:72`, `orders.ts:18,84`).
- **Error que llega tarde:** `set_inventory_location` actualiza 2 filas y **después** avisa del choque por mayúsculas (`inventory.ts:92-98`).
- **Buenos ejemplos:** `payroll.ts:134`, `hours.ts:342` (lista las checadas del día), `suppliers.ts:108` (lista el catálogo de marcas) y `requireSingleMatch` (`shared.ts:41-49`). A este último le falta decir cómo precisar (con `ref`).

### H11 · Cinco buscadores por nombre, cada uno con su regla (R5)

| Buscador | Regla hoy |
|---|---|
| `resolveOrder` | UUID o `ilike` |
| `resolveSupplier` | Sin UUID y sin preferir el nombre exacto: «Perfiles» contra «Perfiles MX» no tiene salida (`suppliers.ts:71-81`) |
| `resolvePerson` | Sin preferir el nombre exacto (`profiles.ts:13-37`) |
| `resolveEmployee` | El nombre exacto gana (`payroll.ts:87-94`) |
| `resolvePayable` | UUID o concepto/proveedor, con preferencia por estado |
| `save_time_entries` | Toma la **primera** checada con esa entrada, sin avisar (`hours.ts:339`) |

Falta un solo `resolveByName()`: UUID o `ref`, luego el nombre exacto (sin acentos), luego parcial, siempre con `requireSingleMatch`.

### H12 · La confirmación descansa en el modelo (R10)
- Las 12 escrituras de hoy son «directo».
- La única vista previa firmada vive en Odoo (`odoo_preview_quotation`). `preview_time_report` no firma, y `save_time_entries` no la exige.
- La garantía real es una línea de las instrucciones: «di exactamente qué vas a hacer y espera la confirmación» (`server.ts:131`). Con «Always allow» en el conector, nada impide escribir sin mostrar antes.
- claude.ai no soporta elicitation (pendiente de verificar), así que la confirmación tiene que vivir en el servidor (dos fases) y en el permiso por tool.

### H13 · Presupuesto (R11)
- Las 12 escrituras ocupan el 49 % de `tools/list`. `record_payroll_hours` sola es el 12 % (2,443 de descripción, `SHEET_GUIDE` incluida).
- Al separar los conectores, el de DYMMSA-WEB deja de compartir tope con Odoo (19 tools, 18,019 caracteres). Por eso ya no hacen falta las fusiones de lectura que el mapa proponía solo para caber en 36.

---

## 2. Las 36 tools actuales

Los números entre paréntesis son caracteres de `tools/list` medidos. Las anotaciones incompletas (H7) aplican a las 12 escrituras y no se repiten en cada fila.

| Tool (car.) | Qué hace | Reglas que incumple | Veredicto | Detalle |
|---|---|---|---|---|
| `get_business_summary` (383) | Conteos por estado de cotizaciones y órdenes, salud del inventario, catálogos y tareas abiertas | R9, R6 | ajustar (descripción, respuesta) | Quitar «Úsala primero» (`server.ts:150`; el mapa de las instrucciones ya la nombra). Contar con `count: 'exact', head: true` por estado en vez de traer tablas completas (tope de 1,000, `quotations.ts:116`, `inventory.ts:51`). Poner `truncado` en tareas (`summary.ts:33-41`). Llaves en español. |
| `list_quotations` (934) | Lista cotizaciones con estado, búsqueda y página | R5, R6, R7, R9 | ajustar (params, respuesta) | `estado` como enum en español (`server.ts:164`); un valor inválido es error, no «todas» (`quotations.ts:32`). `ref` en vez de `id` (`:45`). El total sellado puede estar desfasado y hoy solo se advierte (`server.ts:162`): devolver `total` en vivo, o renombrarlo `total_sellado` con su bandera `desfasado`. Paginación estándar. |
| `get_quotation` (448) | Una cotización con líneas, totales y orden ligada | R2, R5, R6 | ajustar (params, respuesta) | Hoy solo acepta UUID y empuja a `list_quotations` (`server.ts:178-179`). `cotizacion` debe aceptar nombre, cliente o `ref` (`requireSingleMatch`). Devolver por línea `linea`, `version`, `separator_color`, y `description` y `description_es` por separado (hoy se funden, `quotations.ts:85`). `orden` como `{ nombre, estado, ref }` (`:107`). Quitar las `notes` muertas (`:94,103`). `detalle: resumen\|completo`. |
| `list_orders` (817) | Lista órdenes con estado, búsqueda y página | R5, R6, R7 | ajustar (params, respuesta) | Lo mismo que `list_quotations`: enum (`server.ts:192`), sin fallback silencioso (`orders.ts:47`) y sin `id`/`quotation_id` (`:60,65`); en su lugar, `cotizacion: { nombre }`. Total en vivo o marcado como sellado (`server.ts:190`). |
| `get_order` (387) | Una orden con líneas, cantidades, `urrea_status` y ubicación | R2, R6 | ajustar (params, respuesta) | Hoy solo acepta UUID (`server.ts:207`); usar `resolveOrder`. Ítems con `linea` (`orders.ts:90-108`). `cotizacion` en vez de `quotation_id` (`:115`). Distinguir `total_aprobado` de `total_entrega` (`:119` usa el aprobado aunque la recepción ya fijó otro). |
| `get_cut_plan` (651) | Lista de corte de una orden: necesidad neta y barras u hojas por presentación | R6 | ajustar (respuesta) | `no_caben[].pieza` es un UUID (`cutting.ts:27-28`): cambiarlo por `pieza` 1-based, estable para `save_cut_plan`. `orden` sin `id` (`:64`). |
| `save_material_presentation` (887) | Registra una barra de tubo o una hoja de placa del proveedor (mm) | R8, R9 | ajustar (anotaciones, descripción) | Anotaciones `destructiveHint: false`, `idempotentHint: true` (upsert por llave, `cutting.ts:139-141`). Quitar «ESCRIBE» y la nota que empuja `get_cut_plan` (`:148`). Se queda la conversión de pulgadas y metros: es formato de entrada. Borrar una medida va por `delete_record`. |
| `get_purchase_plan` (629) | Mayoreo contra menudeo por grupo de una orden, con recomendación y decisión | — (solo convenciones) | mantener | Quitar `orden.id` (`purchase.ts:85`). Pregunta abierta del mapa: el texto «Copiar para Excel» de lo guardado. |
| `search_inventory` (743) | Stock de la tienda por código, con su gaveta | R5, R6, R7 | ajustar (params, respuesta) | `existencias` como enum en vez de `stockFilter` camelCase con fallback silencioso (`server.ts:264`, `inventory.ts:25-27`). Leer la vista `store_inventory_with_brand` (hoy lee la tabla, `inventory.ts:19`): marca y filtro por marca. Devolver lo **apartado** en órdenes abiertas cuando se busca un código exacto, que es el contexto de cualquier ajuste. |
| `set_inventory_location` (784) | Asigna o borra la gaveta de un código ya inventariado | R4, R5, R7, R8 | fusionar en `save_inventory_item` | El verbo `set_` es ruido (R4). Si `location` falta, **borra** la gaveta (`server.ts:277,280`, `inventory.ts:73`), y con los campos desconocidos descartados (H10) una llamada mal armada la borra en silencio. Avisa del choque por mayúsculas después de escribir (`:92-98`). Lo reemplaza `save_inventory_item`, donde borrar la gaveta exige `ubicacion: ""` explícito. |
| `search_products` (698) | Busca en la BD ETM por ETM, código o descripción, con la descripción DYMMSA resuelta | — (solo convenciones) | mantener | `query` pasa a `buscar` y las llaves de salida a español. Opcional: `se_vende` como filtro. |
| `search_urrea_catalog` (443) | Catálogo URREA por código exacto (todas las marcas) o parcial | R5, R6 | ajustar (params, respuesta) | Sin `marca` no se puede leer la fila exacta que tocaría `save_urrea_catalog_item`. La parcial topa en 20 sin `hay_mas` (`urrea.ts:32`). `message` y `match` en inglés (`:38`). Paginación estándar. |
| `list_suppliers` (664) | Proveedores con contacto, plazo y marcas | — (solo convenciones) | mantener | `ref` en vez de `id` (`suppliers.ts:15`); `pagina` en vez de `limit`. «¿Qué marcas tengo?» queda a medias (las marcas sin proveedor no salen); ver pregunta 6. |
| `save_supplier` (1,120) | Alta o edición de proveedor; agrega o quita marcas por nombre | R5, R8, R9 | ajustar (params, descripción) | `resolveSupplier` sin UUID ni preferencia por el nombre exacto (`suppliers.ts:71-81`). Nuevo `crear_marcas: true`, que reemplaza a `save_brand`. Quitar «ESCRIBE: confirma» (`server.ts:336`). Respuesta sin `id`. Anotaciones `idempotentHint: true`. |
| `list_payables` (875) | Facturas de gastos con filtros de estado, mes, proveedor y concepto | R5, R6 | ajustar (params, respuesta) | `estado` con tokens en español iguales a los de la salida (`server.ts:362` contra `payables.ts:43`). Sin `offset`: más allá de 100 no se llega (`payables.ts:89-96`); pasa a `pagina`. `ref` en vez de `id` (`:34`). |
| `get_payable` (487) | Una factura de gasto con su historial (admin) | — (solo convenciones) | mantener | `ref` en vez de `id`. |
| `get_payables_overview` (504) | «¿Qué debo esta semana o este mes?»: pendiente por semana, vencido, por vencer y próximas | R3 | ajustar (descripción) | Se solapa con `get_month_closing` en «pagado / pendiente / vencido del mes». La descripción debe decir cuándo usar cada una: esta para el calendario de pagos, la otra para el cierre con ingresos. |
| `mark_payable_paid` (948) | Marca pagada con fecha real o regresa a pendiente | R4, R1 (excepción ADR-037), R8 | fusionar → `save_payable` | Sus guardas pasan a `assertPayableTransition()`: no re-sellar hoy, cancelada no se paga. |
| `create_payable` (1,194) | Registra una factura de gasto pendiente | R4, R8, R9 | fusionar → `save_payable` | Empuja `save_supplier` (`server.ts:419`). Su validación copia la de la ruta (`payables.ts:335-348`) y debe ir a `parsePayableInsert()`. |
| `update_payable` (1,122) | Corrige o cancela una factura de gasto | R4, R8 | fusionar → `save_payable` | `cambios` antes/ahora pasa a ser el estándar de todas las escrituras. Bloquea cancelar una pagada (se queda). |
| `get_month_closing` (529) | Cierre del mes: egresos de la app más ingresos de Odoo | R6 | ajustar (params, respuesta) | Sin `withinBudget()` (`finance.ts:37-46`): una lectura lenta de Odoo no degrada a tiempo. Agregar `fresco?: true` (lectura sin purgar la caché) y `datos_de` (hora de la caché). |
| `get_week_hours` (853) | Horas de una semana por día, con jornada y justificantes | R9, R11 | ajustar (descripción, respuesta) | Quitar el texto de rol (`server.ts:475-477`). Numerar las checadas del día (`n`) para que una corrección o un borrado no dependan de «la primera con esa entrada» (`hours.ts:339`). |
| `get_hours_trend` (618) | Total por semana de las últimas N semanas de una persona | R2 | ajustar (params) | «¿Quién no completa su jornada?» hoy exige una llamada por persona (lo dice su descripción, `server.ts:490`). Agregar `equipo: true`: una tabla persona × promedio y cumplimiento. **No** se fusiona con `get_week_hours`: tienen otra forma de salida (R1). |
| `list_time_imports` (443) | Bitácora de cargas del checador | — | mantener | Quitar el texto de rol (`:505`). |
| `preview_time_report` (866) | Revisa sin guardar el reporte del checador (vista MCP Apps) | R10 | ajustar (respuesta) | Que firme una `clave` sobre las filas canónicas y que `save_time_entries` la exija con `filas`. Es el patrón de Odoo; hoy la vista previa es opcional y el modelo puede saltarla. |
| `save_time_entries` (1,100) | Carga el reporte como filas, o crea o corrige una checada | R1 (tensión), R5, R8, R9 | ajustar (params, anotaciones) | Dos modos con entradas muy distintas (rejilla de hasta 1,000 × 20 contra un objeto). Se mantiene unida porque los modos son excluyentes y la entidad es una (ADR-034); si crece, partirla. `entrada_actual` debe ir por `requireSingleMatch` (o por `n`). `clave` de la vista previa con `filas`. `idempotentHint: true`. Quitar «ver get_week_hours» (`server.ts:541`). El borrado va por `delete_record`. |
| `save_excused_day` (667) | Marca, cambia o quita un feriado o una salida autorizada | R1, R4, R8 | ajustar (params, anotaciones) | `quitar: true` borra dentro de un `save_` (`server.ts:573`, `hours.ts:398-405`): pasa a `delete_record`. `idempotentHint: true`. La lógica inline se extrae a un store (ficha de Horas). |
| `get_profiles` (675) | Perfiles del equipo (nombre, rol, jornada, checador, NSS, foto) | R4, R6 | renombrar → `list_profiles` | Es una colección: un `get_` con 0..n resultados viola R4. Con `persona` filtra a una e incluye su NSS (la regla se queda). Agregar `area` (`profiles.ts:41`). |
| `get_payroll_period` (633) | El corte sábado a viernes: horas por empleado y día, totales y equivalente | R6, R9 | ajustar (respuesta) | Decir por empleado si está activo y a qué perfil está ligado. Quitar «SOLO administradores…» (`server.ts:600`). `detalle: resumen\|completo` (por día). |
| `record_payroll_hours` (3,412) | Carga horas de la hoja como borrador, o «Traer de Horas» | R4, R8, R9 | renombrar → `save_payroll_hours` | `record_` es ruido. Los pasos de flujo de `SHEET_GUIDE` y de la descripción («dalo de alta con save_payroll_employee», «antes carga el reporte con save_time_entries», `server.ts:100,614`) van a las instrucciones (rutina de los viernes); la guía para leer la hoja se queda. Gana `corregir` (un día confirmado, dos fases). `idempotentHint: true`. `omitidos` sin UUID (`payroll.ts:151,173`). |
| `save_payroll_employee` (1,043) | Alta, edición o baja (`activo=false`) de un empleado de nómina | — (solo convenciones) | mantener | Quitar «ESCRIBE: úsala solo cuando…» (`:645`). Agregar `avisos` cuando cambia la jornada de alguien con cortes cerrados (los recalcula al leer). |
| `list_tasks` (569) | Tareas (GitHub Issues) por estado y prioridad | R5, R6, R7 | ajustar (params, respuesta) | Enums en español en vez de `z.string` (`server.ts:666-667`) y sin fallbacks (`tasks.ts:26,36`). Página fija de 30 sin total (`:29-43`): paginación estándar con `hay_mas`. El listado trae la descripción completa de cada tarea: en el listado basta un extracto. Llaves camelCase (`github.ts:97-112`). |
| `get_task` (363) | Una tarea con descripción y comentarios | R5, R6 | ajustar (params) | `tarea` en vez de `number` (choca con `task_number`). Comentarios con tope de 100 sin aviso (`tasks.ts:53`). |
| `create_task` (723) | Crea una tarea | R4, R7, R8 | fusionar → `save_task` | Prioridad inválida ignorada en silencio (`tasks.ts:73`). Reporter fijo «Asistente (MCP)» (`:17`) aunque `ctx.email` existe. |
| `update_task` (1,094) | Comenta, prioriza, cierra o reabre | R4, R5, R8 | fusionar → `save_task` | Params en inglés y sin enum (`server.ts:710-714`). La mezcla de labels se duplica con la ruta: va a `tasks-store`. |
| `get_app_settings` (368) | Umbrales del planificador y margen de corte (guardados o por default) | — | mantener | Que su lista `KEYS` salga del futuro `settings-store` (`settings.ts:7`). |

---

## 3. Catálogo objetivo del conector DYMMSA-WEB

**Leyenda de anotaciones** (todas con `openWorldHint: false`: GitHub es el repo propio y Odoo se lee solo dentro de `get_month_closing`):

| Código | Significado |
|---|---|
| **L** | `readOnlyHint: true` |
| **E(d,i)** | `readOnlyHint: false`, `destructiveHint: d`, `idempotentHint: i` (1 = true, 0 = false) |

`idempotentHint: 1` cuando repetir la misma llamada no tiene efecto adicional: la llave natural impide duplicar, o los valores son absolutos.

**Confirmación:** *directo* (escribe en una llamada) o *dos fases*. La fase 1 no escribe y devuelve `resumen` y `clave`; la fase 2 manda los mismos datos más `clave`. Ver la sección 4.6.

### Panorama
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `get_business_summary` | leer / panorama | L | L | — | ídem | 380 | 4 |

### Cotizaciones
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_quotations` | listar / cotizaciones | L | L | — | ídem | 850 | 4 |
| `get_quotation` | leer / una cotización | L | L | — | ídem, más nombre y `linea`/`version`; opcional `link_aprobacion` | 650 | 1, 3, 4 |
| `save_quotation` | guardar / cotización (encabezado, líneas, estado) | E | E(1,0) | Crear o editar: dos fases. Estado `en_revision` desde `borrador`: directo. Otro estado: dos fases (avisa que el link muere). Editar en `en_revision`: **bloqueado** hasta arreglar el bug de ids viejos. | `POST /quotations/save`, `PATCH …/update`, `PATCH …/status`, `POST …/send-for-approval` | 3,200 | 1, 2, 3, 4 |

### Órdenes
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_orders` | listar / órdenes | L | L | — | ídem | 800 | 8 |
| `get_order` | leer / una orden | L | L | — | ídem, más `resolveOrder` y `linea` | 650 | 6 |
| `save_order` | guardar / orden y sus líneas | E | E(1,0) | Crear (desde cotización o manual): dos fases (alto). `estado`, incluido `cancelada`: dos fases (cancelar es alto). `odoo_id`: directo. `cambios` de línea: directo si solo cambia la entrega; dos fases si cambia precio, se agrega o se quita | `POST …/create-order`, `POST /orders/create`, `PATCH /orders/[id]`, `PATCH …/status`, `POST …/cancel`, `POST …/items`, `PATCH`/`DELETE …/items/[itemId]` | 2,400 | 5, 7, 8 |
| `save_order_reception` | guardar / recepción de URREA | E | E(1,1) (delta del excedente, ADR-019) | Dos fases siempre (alto): pedido, recibido, excedente a tienda, ⚠️ si recibido > 2× pedido, estado resultante | `POST …/confirm-reception` | 1,000 | 6 |

Prerrequisitos de las dos escrituras de órdenes (ficha de Órdenes): `orders-store`, stock atómico (RPC), arreglar el bug de `model_code` repetido y acotar la recepción a la orden.

### Compra y corte
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `get_purchase_plan` | leer / plan de compra de una orden | L | L | — | ídem | 630 | 9 |
| `save_purchase_decisions` | guardar / decisiones de mayoreo de una orden | E | E(1,1) | Dos fases; rechaza si queda algún «revisar» | `PUT …/purchase-decisions` | 1,000 | 9 |
| `get_cut_plan` | leer / lista de corte de una orden | L | L | — | ídem, más `pieza` | 650 | 10 |
| `save_cut_plan` | guardar / lista de corte de una orden | E | E(1,0) | `agregar`: directo. `quitar`/`reemplazar`: dos fases | `PUT …/cut-plan` | 1,400 | 10 |
| `save_material_presentation` | guardar / presentación del proveedor | E | E(0,1) | Directo | ídem (`POST /material-presentations`) | 800 | 10 |

### Inventario
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `search_inventory` | buscar / stock de la tienda | L | L | — | ídem, más la vista con marca y lo apartado | 850 | 11 |
| `save_inventory_item` | guardar / fila de inventario (alta, gaveta, cantidad) | E | E(1,0) (el `ajuste` por delta no es idempotente) | Solo gaveta: directo. Cualquier cantidad o un alta con cantidad > 0: dos fases (la clave se ata al antes, así que un commit repetido falla) | `set_inventory_location`, `POST /inventory`, `PATCH /inventory/[id]` | 1,300 | 11 |

### Catálogos
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `search_products` | buscar / productos ETM | L | L | — | ídem | 700 | 2, 12 |
| `save_product` | guardar / producto ETM | E | E(1,0) (`etm: "nuevo"` no es idempotente) | Directo; cambiar `etm`, código o marca: dos fases | `POST /products`, `PATCH /products/[id]` | 1,300 | 12 |
| `search_urrea_catalog` | buscar / catálogo URREA | L | L | — | ídem, más `marca` y paginación | 600 | 13 |
| `save_urrea_catalog_item` | guardar / fila del catálogo URREA | E | E(1,1) | Solo la descripción: directo. Alta, `std` o identidad: dos fases (cuántas decisiones quedan desactualizadas) | `POST /urrea-catalog`, `PATCH /urrea-catalog/[id]` | 1,000 | 13 |

`save_urrea_catalog_item` es el `save_catalog_item` del mapa, renombrado para emparejarlo con `search_urrea_catalog` y que no se confunda con el ETM, que también es «catálogo».

### Proveedores
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_suppliers` | listar / proveedores | L | L | — | ídem | 700 | 14 |
| `save_supplier` | guardar / proveedor | E | E(1,1) | Directo (el resumen muestra la marca nueva ya normalizada) | ídem, más `POST /brands` vía `crear_marcas` | 1,250 | 14 |

### Finanzas
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_payables` | listar / facturas por pagar | L | L | — | ídem | 950 | 16, 17 |
| `get_payable` | leer / una factura por pagar | L | L | — | ídem | 480 | 16 |
| `get_payables_overview` | leer / calendario de pagos del mes | L | L | — | ídem | 500 | 18 |
| `get_month_closing` | leer / cierre del mes | L | L | — | ídem, más `fresco` | 600 | 18 |
| `save_payable` | guardar / factura por pagar (alta, corrección, pago, cancelación, reactivación) | E | E(1,0) | Directo. Cambiar monto, moneda, proveedor o fechas de una **pagada**: dos fases | `create_payable`, `update_payable`, `mark_payable_paid`, `POST /payables`, `PATCH /payables/[id]` | 1,900 | 15, 16 |

### Horas
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `get_week_hours` | leer / semana de una persona | L | L | — | ídem | 750 | 20 |
| `get_hours_trend` | leer / tendencia de horas | L | L | — | ídem, más `equipo` | 650 | 21 |
| `list_time_imports` | listar / cargas del checador | L | L | — | ídem | 420 | 19 |
| `preview_time_report` | previsualizar / reporte del checador (vista) | L | L | Firma la `clave` | ídem | 900 | 19 |
| `save_time_entries` | guardar / checadas | E | E(1,1) | `filas`: con la `clave` de `preview_time_report`. `checada`: directo | ídem (`POST`/`PATCH /time-entries`, `POST …/import`) | 1,150 | 19 |
| `save_excused_day` | guardar / día justificado | E | E(1,1) | Directo | ídem sin `quitar` (`POST /excused-days`) | 600 | 20 |

### Equipo
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_profiles` | listar / perfiles | L | L | — | `get_profiles`, más `area` | 650 | 24 |
| `save_profile` | guardar / perfil (sin alta) | E | E(1,1) | Nombre o NSS propios: directo. Otra persona, checador, jornada o área: dos fases. `rol` fuera (pregunta abierta del mapa); la tarifa nunca | `PATCH /profile`, `PATCH /profiles/[id]` | 1,100 | 24 |

### Nómina
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `get_payroll_period` | leer / corte | L | L | — | ídem, más activo y perfil ligado | 600 | 22 |
| `save_payroll_hours` | guardar / horas de nómina por día | E | E(1,1) | `dias` (borrador) y `traer_de_horas`: directo. `corregir` (un día, queda manual y confirmado; 0 h y sin nota borra el día, como la celda vacía): dos fases | `record_payroll_hours`, `PUT /payroll/days`, `POST …/prefill` | 3,700 | 22, 23 |
| `save_payroll_period` | guardar / corte (`accion`: `confirmar_borradores`, `cerrar`, `reabrir`) | E | E(1,0) (re-cerrar re-sella; pasa a 1 si se arregla) | Dos fases siempre. En `confirmar_borradores` la clave se ata a la huella del conjunto de borradores (alto) | `PATCH /payroll/periods/[start]`, `POST …/confirm` | 1,100 | 22 |
| `save_payroll_employee` | guardar / empleado de nómina | E | E(1,1) | Directo | ídem | 1,000 | 22 |

`save_payroll_period` revierte ADR-033 §9 (que el MCP no confirma ni cierra) y requiere un ADR.

### Tareas
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `list_tasks` | listar / tareas | L | L | — | ídem | 650 | 25 |
| `get_task` | leer / una tarea | L | L | — | ídem | 380 | 25 |
| `save_task` | guardar / tarea (crear, comentar, priorizar, cerrar, reabrir) | E | E(1,0) | Directo. Título o descripción, si se reabre ADR-015: dos fases | `create_task`, `update_task`, `POST /tasks`, `PATCH /tasks/[n]`, `POST …/comments` | 1,100 | 25 |

### Configuración
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `get_app_settings` | leer / configuración | L | L | — | ídem | 360 | 9 |
| `save_app_settings` | guardar / configuración (whitelist de 3 keys, `restablecer`) | E | E(1,1) | Dos fases | `PATCH /settings` | 800 | 9 |

### Borrados (transversal)
| Tool | Verbo / objeto | L/E | Anotaciones | Confirmación | Sale de | Car. est. | Tareas |
|---|---|---|---|---|---|---|---|
| `delete_record` | borrar / un registro de: `proveedor`, `marca`, `medida`, `factura` (pendiente o cancelada), `checada`, `dia_justificado` | E | E(1,1) | Dos fases siempre. El resumen dice qué se pierde: una checada importada vuelve con el re-import, un proveedor con facturas se bloquea con el conteo, una marca en uso también | `DELETE /suppliers/[id]`, `/brands/[id]`, `/material-presentations/[id]`, `/payables/[id]`, `/time-entries/[id]`, `/excused-days/[id]`; `save_excused_day.quitar` | 1,300 | 17, 20 |

**Fuera a propósito:** los borrados de cotización, orden, inventario, producto y catálogo.

### Resolución de los conflictos del mapa
1. **`save_payable` (3 → 1):** se acepta. R1 se cumple: una entidad, un verbo, un set de anotaciones E(1,0) y una forma de salida (`cambios`). El `quitar` que proponía la ficha **no entra**: va a `delete_record`. Borrar no es «guardar» (R4), y dentro de `save_payable` el permiso «Always allow» del cliente cubriría también los borrados (R10).
2. **`save_inventory_item` reemplaza `set_inventory_location`:** se acepta. Se rompe la regla «no renombrar» de ADR-034, y el momento es ahora: el split obliga a reconectar de todos modos. Mezcla un valor absoluto (gaveta, `cantidad_contada`) con un delta (`ajuste`), así que se anuncia `idempotentHint: false`; la `clave` atada al «antes» evita aplicar dos veces el mismo commit.
3. **Fusiones de lectura (`list_quotations` → `get_quotation`; `list_orders`, `get_cut_plan` y `get_purchase_plan` → `get_order`; `get_hours_trend` → `get_week_hours`):** **se rechazan**.
   - Cada fusión cambia la forma de salida según los parámetros (R1).
   - Un `get_` que devuelve colecciones viola R4.
   - `get_cut_plan` y `get_purchase_plan` hacen pareja natural con `save_cut_plan` y `save_purchase_decisions` (R9: vecinas claras).
   - Sin el bloque Odoo, el presupuesto que las motivaba ya no aprieta. Mantenerlas cuesta 4 tools y unos 2,700 caracteres.
   - El problema que sí resolvían (cadenas `list` → `get` por UUID) se arregla haciendo que los `get_*` acepten nombre o `ref` (R2).
4. **`save_task` (2 → 1):** se acepta. Se pierde una sutileza: `create_task` sola sería E(0,0), solo agrega; fusionada, la tool es E(1,0). El precio es que el cliente pida aprobación también al crear, y es aceptable.
5. **`save_order_items` del mapa → las líneas van dentro de `save_order.cambios` (como en `save_quotation`) y `recibir` sale como `save_order_reception`:** la recepción tiene entradas (un lote de líneas) y confirmación (siempre alta) muy distintas de editar una línea (R1, criterio de partir). Además es idempotente por diseño, al contrario del resto. El total de tools nuevas del módulo sigue en 2.
6. **`save_brand`: no entra.** El caso que importa es «da de alta al proveedor con su marca nueva», y lo resuelve `save_supplier.crear_marcas` en una llamada (R2, R11). Renombrar marcas se queda en la app; borrarlas, en `delete_record`. Revierte ADR-037 («no crear marcas desde el MCP») como opción explícita: la marca nace solo con `crear_marcas: true`.
7. **Corregir un día de nómina:** va en `save_payroll_hours` (la entidad es el día), no en `save_payroll_period.corregir_dia` como proponía la ficha. Así una sola tool escribe `payroll_days` (R3) y la del corte queda solo con su ciclo de vida. Rompe la promesa «solo borradores» de `record_payroll_hours`: `dias` siguen siendo borradores y `corregir` es otro modo, con dos fases (pregunta 5).
8. **`save_quotation` con crear, editar y estado:** se mantiene una tool. La confirmación es uniforme con la `clave`, y una intención por llamada: mezclar `cambios` con `estado` es error, salvo lo que decida la pregunta 7.
9. **`save_cut_plan` no absorbe `save_material_presentation`:** son dos entidades (ADR-034) con anotaciones distintas: E(1,0) contra E(0,1).

### Total y tamaño
- **44 tools:** 24 lecturas (igual que hoy) y 20 escrituras (12 hoy, −6 por fusión, +14 nuevas).
- **`tools/list` estimado:** unos 43,800 caracteres, ±15 %.
  - Lecturas: unos 15,350 (640 por tool).
  - Escrituras: unos 28,400 (1,420 por tool). Las grandes: `save_payroll_hours` 3,700, `save_quotation` 3,200 y `save_order` 2,400, calibradas contra `odoo_save_quotation`, que hoy mide 2,419.
- **No incluye:**
  - las anotaciones completas: unos 2,600 caracteres en el cable, que el test no mide;
  - `outputSchema`: si se publica en todo, entre +9,000 y +18,000 (H9).
- **Ahorro ya contado:** unos 1,300 caracteres de texto repetido que se quitan (H8).
- **Descripciones:** unas 17,700 (lecturas unos 6,500; escrituras unos 11,200, incluida la excepción de la hoja del taller).
- **Instrucciones del conector:** unas 5,500 (mapa por módulo unos 2,500, con las convenciones de dos fases y de borrado; reglas de negocio sin las líneas de Odoo unos 1,900; flujos unos 600; regla de los dos mundos unos 500).
- **Comparación:** con los dos conectores prendidos, el cliente paga unos 43,800 + 18,000 de `tools/list`, contra los 46,588 de hoy. Con solo DYMMSA-WEB, unos 43,800.
- **Topes propuestos** (`TOOL_BUDGET` del conector): `tools` 45, `listTotal` 46,000, `descriptionsTotal` 19,000, `descriptionExceptions.save_payroll_hours` 2,800 e `instructions` 6,000.

---

## 4. Convenciones propuestas

### 4.1 Verbos (R4)
| Verbo | Significado | Ejemplos |
|---|---|---|
| `get_` | **Un** registro o informe, por `ref`, UUID o nombre; si es ambiguo, error con candidatos | `get_quotation`, `get_month_closing` |
| `list_` | Colección paginada con filtros | `list_orders`, `list_profiles` |
| `search_` | Colección por texto o código sobre un catálogo | `search_products`, `search_inventory` |
| `preview_` | Gemelo de **solo lectura** de un `save_`, cuando hay vista MCP Apps; firma la `clave` | `preview_time_report` |
| `save_` | Crea o edita **una entidad**; incluye sus transiciones de estado; **nunca borra la entidad** | `save_payable`, `save_order` |
| `delete_record` | El único borrado | — |

- Quedan prohibidos `set_`, `mark_`, `create_`, `update_` y `record_`.
- El nombre de la tool sigue en inglés snake_case, ≤ 40 caracteres, con el objeto en singular para `save_`/`get_` y en plural para `list_`/`search_`.
- Prefijo: ver la pregunta 1.

### 4.2 Parámetros (R5)
- **Formato:** español, snake_case, sin acentos.
- **Referencia a la entidad:** se nombra como la entidad (`cotizacion`, `orden`, `factura`, `proveedor`, `persona`, `empleado`, `tarea`, `etm`, `codigo`) y acepta UUID, `ref` o nombre, siempre por `resolveByName()` → `requireSingleMatch` (H11).
- **Enums:** con `z.enum` y tokens en español, los **mismos** que aparecen en la salida. Ejemplos:
  - cotización: `borrador | en_revision | aprobada | rechazada | convertida`;
  - orden: `pedida | recibida | entregada | completada | cancelada`;
  - factura: `pendiente | vencida | pagada | cancelada`.
  - Un valor inválido es error, nunca un fallback.
- **Valores con formato fijo:** fechas `YYYY-MM-DD` validadas con `isRealDate`; meses `YYYY-MM`; longitudes en mm; montos > 0 con `moneda` aparte.
- **Borrar un dato** solo con `""` explícito (o `null` donde ya se usa). Un parámetro **omitido nunca destruye** (H10).
- **Escrituras con `.strict()`:** un campo desconocido es error («`cantidad` no existe aquí; para cantidades usa `cantidad_contada` o `ajuste`»).
- **Requeridos:** solo lo indispensable. Los defaults se documentan en el campo, p. ej. `fecha_factura` = hoy con `aviso`.
- La descripción de cada campo cabe en unos 80 caracteres y lleva un ejemplo cuando el formato no es obvio.

### 4.3 Envoltura de respuesta (R6)
Las tres formas, que viajan como `structuredContent` y como el mismo JSON en texto:

```json
// Colección
{ "total": 37, "pagina": 1, "por_pagina": 20, "hay_mas": true, "cotizaciones": [ … ], "nota": "Hay 17 más: pide pagina=2." }

// Un registro o informe
{ "ref": "3f2a9c1b", "nombre": "…", …, "avisos": [], "nota": null }

// Escritura
{ "accion": "simulado | creado | actualizado | borrado | sin_cambios", "escrito": false,
  "factura": { … }, "cambios": { "monto": { "antes": 2300, "ahora": 3200 } },
  "avisos": ["Es una factura pagada: el monto se corrige sin bitácora."],
  "bloqueos": [], "clave": "…", "expira": "2026-10-22T18:30:00-06:00", "nota": "Nada guardado: muestra el resumen y espera el sí." }
```

- Los nombres ya van resueltos, nunca UUIDs: la descripción DYMMSA, los totales en vivo y la gaveta oculta sin stock.
- Todo tope interno se reporta con `truncado: true` y su `nota`.
- `outputSchema` solo donde lo pida una vista o un encadenamiento (H9).

### 4.4 Paginación (R6)
- `pagina` empieza en 1; `por_pagina` vale 20 por default y 100 como máximo. Aplica a toda colección, incluidas las tareas y el catálogo URREA.
- La respuesta trae `total`, `hay_mas` y, si hay más, la nota con la llamada siguiente.
- Las búsquedas dirigidas (`get_` por nombre) no paginan: o devuelven uno o fallan con hasta 5 candidatos.

### 4.5 Referencias
| Referencia | Qué es |
|---|---|
| `ref` | Los primeros 8 caracteres hex del UUID. Se muestra en listados y detalles y la aceptan todos los resolutores |
| `linea` | Posición 1-based sobre **todas** las filas del documento, secciones incluidas (= `sort_order + 1`). La misma regla para cotización y orden (el mapa proponía dos reglas distintas). Guarda opcional `etm`/`codigo`: si no coincide, error |
| `pieza` | 1-based en la lista de corte |
| `n` | La checada dentro de su día |
| `version` | Hash de los ids de las líneas más `updated_at`, en `get_quotation` y `get_order`. Va dentro de la `clave`, que sirve de concurrencia optimista |
| `detalle: resumen \| completo` | Solo en `get_quotation`, `get_order` y `get_payroll_period`. `resumen` trae lo necesario para editar; `completo` agrega las descripciones ES/EN, la fuente de la descripción DYMMSA, `is_sold`, el color de sección y las notas. Ningún modo expone UUIDs |

### 4.6 Confirmación en dos fases (R10)
- **Riesgo bajo: directo.** Medio y alto: **dos fases con `clave`**. El `confirmar: true` del mapa se reemplaza porque:
  - el modelo puede mandarlo en la primera llamada;
  - no ata lo confirmado a lo que se mostró;
  - no detecta cambios intermedios.
- **Fase 1:** la tool valida, calcula y responde `accion: "simulado"`, `escrito: false`, `resumen`/`cambios`, `avisos`, `bloqueos` y `clave` (HMAC con un secreto propio, `MCP_PREVIEW_SECRET`, fuera de `src/lib/odoo/`). La clave se ata a:
  - el usuario;
  - el nombre de la tool;
  - los argumentos canónicos sin `clave`;
  - la huella de lo afectado (`version`, stock leído, conjunto de borradores…);
  - una caducidad de 30 minutos.
- **Fase 2:** los mismos argumentos más `clave`. Si algo cambió, no escribe: «la cotización cambió desde el resumen; vuelve a pedirlo».
- **Instrucciones del servidor:** «muestra el resumen y espera el sí del usuario; nunca encadenes las dos fases sin su respuesta».
- **Límite conocido:** la clave prueba que se generó el resumen, no que el usuario lo vio. La barrera del cliente es el permiso por tool, y por eso los borrados van en su propia tool.
- **Las vistas MCP Apps** (`preview_time_report`, y una futura vista de cotización) firman la misma clave desde la lectura gemela.

### 4.7 Errores (R7)
- **Siempre** `isError: true` con un mensaje en español de tres partes: qué pasó, cómo corregirlo y un ejemplo válido. Ej.: «`estado` inválido: "pagado". Usa pendiente, vencida, pagada o cancelada. Ej.: { "estado": "pagada" }».
- **Errores de zod en español:** mapa de errores propio (`z.config`) o validación propia antes del SDK.
- **Nunca el texto crudo de PostgREST:** se mapea con un `explainPgError` del lado MCP.
- **Ambigüedad:** hasta 5 candidatos con su `ref` y «repite con `ref`».
- **No encontrado:** nombra la tool de búsqueda.
- **Error de escritura:** antes de escribir, nunca después (H10).

### 4.8 Anotaciones por tipo de tool (R8)
Siempre explícitas y completas, más `title`.

| Tipo | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| Lectura y `preview_` | true | — | — | false |
| `save_` que solo agrega o refresca | false | false | true | false |
| `save_` que edita, con llave natural o valores absolutos | false | true | true | false |
| `save_` que crea sin llave natural, o con deltas | false | true | false | false |
| `delete_record` | false | true | true | false |

Un test de manifiesto debe exigir las cuatro llaves en cada escritura.

### 4.9 Plantilla de descripción (R9)
Hasta unos 600 caracteres en lecturas y unos 900 en escrituras:

> «<Qué hace> en DYMMSA-WEB: <sobre qué>. Recibe <entradas clave; cómo se nombra la entidad>. Devuelve <salidas clave>. Úsala para «<frase real>»; para <caso vecino>, <otra tool>. [Escrituras:] Directo: <qué>. Dos fases: <qué>. Nunca: <límites>.»

- No van: «ESCRIBE», el texto de rol, las cadenas de llamadas, las reglas de negocio (viven en las instrucciones) ni los valores de enum (viven en el esquema).
- Ejemplo para `save_payable`:

> «Alta o cambio de una factura de GASTO de DYMMSA-WEB (no de Odoo). Sin `factura` da de alta (nace pendiente; vencimiento = fecha + plazo del proveedor). Con `factura` (concepto, proveedor o ref) la corrige, la paga con su fecha real, la regresa a pendiente, la cancela o reactiva. Devuelve la factura y `cambios`. Úsala para «ya pagué la de Perfiles» o «la de Tornillos era por 3,200». Dos fases: cifras de una pagada. Nunca convierte moneda; una pagada no se cancela directo; borrar es delete_record.»

### 4.10 Instrucciones del servidor (R9)
Lo que va en las instrucciones y no en las tools:
- el mapa por módulo;
- los flujos (cotización → orden → recepción → planificador, y la rutina de nómina de los viernes);
- la convención de dos fases y de borrado;
- la regla de los dos mundos;
- las reglas de negocio (`BUSINESS_RULES_MD` sin las líneas de Odoo).

El conector de Odoo repite en una línea la regla de los dos mundos y la distinción `save_quotation` / `odoo_save_quotation`.

---

## 5. Tareas de evaluación (R12)

**Notación:** «×2» significa fase 1 (resumen y clave), el sí del usuario y fase 2 con `clave`. Cada tool del catálogo aparece al menos una vez (ver la columna «Tareas» de la sección 3).

| # | Frase del usuario | Secuencia esperada |
|---|---|---|
| 1 | «A la cotización de Andritz cámbiale el precio de la línea 4 a 385 y ponle entrega 1 semana a todo» | `get_quotation(cotizacion:"Andritz")` → `save_quotation(cotizacion, cambios:[{linea:4, precio:385}, {lineas:"todas", entrega:"1_semana"}])` ×2 |
| 2 | «Hazme una cotización para GE Power con estos 6 productos» (Excel adjunto) | `save_quotation(nombre, cliente:"GE Power", lineas:[…])` fase 1 (prellenado del server; ETM no encontrados en `avisos`) → si falta uno, `search_products(buscar)` → fase 1 de nuevo → fase 2 |
| 3 | «El cliente me dijo por WhatsApp que aprueba todo menos la línea 5; márcala aprobada» | `get_quotation` → `save_quotation(cambios:[{lineas:"todas", aprobacion:"aprobada"}, {linea:5, aprobacion:"rechazada"}])` ×2 → `save_quotation(estado:"aprobada")` ×2 (o una sola, según la pregunta 7) |
| 4 | «¿Cómo vamos? ¿Qué cotizaciones esperan aprobación? Manda la de Truper a aprobación y pásame el link» | `get_business_summary` → `list_quotations(estado:"en_revision")` → `save_quotation(cotizacion:"Truper", estado:"en_revision")` directo → `get_quotation(link_aprobacion)` (si se aprueba exponer el link) |
| 5 | «Genera la orden de la cotización de Andritz» | `save_order(cotizacion:"Andritz")` ×2 (líneas, stock por línea con asignación corrida, por pedir, aviso de que la cotización pasa a convertida) |
| 6 | «Ya llegaron 10 del 6954 de la orden de GE, pedimos 8; del 4410 no van a surtir nada» | `get_order(orden:"GE")` → `save_order_reception(orden:"GE", lineas:[{codigo:"6954", recibido:10}, {codigo:"4410", recibido:0, estado:"no_surtido"}])` ×2 (+2 de excedente a tienda) |
| 7 | «Agrégale 3 rodillos ETM 12345 a $85 a la orden 12 y ponle entrega 1 semana a la línea 4» | `save_order(orden:"12", cambios:[{agregar:{etm:"12345", cantidad:3, precio:85}}, {linea:4, entrega:"1_semana"}])` ×2 (lo que sale de stock) |
| 8 | «¿Qué órdenes siguen abiertas? Cancela la de Truper, el cliente se echó para atrás» | `list_orders(estado:"pedida")` → `save_order(orden:"Truper", estado:"cancelada")` ×2 (restauración por código; irreversible) |
| 9 | «Sube el umbral de dinero parado a $150 y en la orden de GE acepta las recomendaciones; las de revisar, a mayoreo» | `get_app_settings` → `save_app_settings(umbral_dinero_parado_mxn:150)` ×2 → `get_purchase_plan(orden:"GE")` → `save_purchase_decisions(orden, aceptar_recomendaciones:true, decisiones:[…:"mayoreo"])` ×2 |
| 10 | «Agrega a la lista de corte de la orden 12 cuatro tubos de 1 pulgada de 300 mm; el proveedor vende barras de 6 m. ¿Cuántas salen?» | (confirma 25.4 mm en el chat) → `save_cut_plan(orden:"12", accion:"agregar", piezas:[{tipo:"tubo", diametro_mm:25.4, largo_mm:300, cantidad:4}])` directo → `save_material_presentation(tipo:"tubo", diametro_mm:25.4, largo_mm:6000)` directo → `get_cut_plan(orden:"12")` |
| 11 | «Conté el 6954: hay 12, y quedó en la gaveta B3» | `search_inventory(buscar:"6954")` (cantidad y apartado) → `save_inventory_item(productos:[{codigo:"6954", cantidad_contada:12, ubicacion:"B3"}], motivo:"conteo")` ×2 |
| 12 | «El ETM 1180234 no lo vendemos, y en realidad es SURTEK» | `search_products(buscar:"1180234")` → `save_product(etm:"1180234", se_vende:false, marca:"SURTEK")` ×2 (la marca cambia el cruce con el catálogo) |
| 13 | «El 6954 ahora viene en paquete de 12, no de 10» | `search_urrea_catalog(buscar:"6954")` → `save_urrea_catalog_item(codigo:"6954", marca:"URREA", std:12)` ×2 (N decisiones quedan desactualizadas) |
| 14 | «Da de alta a Ferretería López, 30 días de crédito, surte PRETUL» (PRETUL no existe) | `list_suppliers(buscar:"López")` (que no exista) → `save_supplier(nombre, dias_credito:30, agregar_marcas:["PRETUL"], crear_marcas:true)` directo |
| 15 | «Registra la de Tornillos MX por $800, ya la pagué hoy» | `save_payable(proveedor:"Tornillos", concepto, monto:800, estado:"pagada")` directo (insert pendiente + pago, para que la bitácora registre quién pagó) |
| 16 | «Ya pagué la de Perfiles, fue ayer; dame el detalle» | `save_payable(factura:"Perfiles", estado:"pagada", fecha_pago:<ayer>)` → error ambiguo con `ref` («Perfiles» / «Perfiles MX») → pregunta → `save_payable(factura:"<ref>", …)` → `get_payable(factura:"<ref>")` |
| 17 | «Borra la factura de Tornillos que registré dos veces» | `list_payables(proveedor:"Tornillos")` → `delete_record(tipo:"factura", referencia:"<ref>")` ×2 |
| 18 | «¿Qué debo esta semana y cómo cierra el mes con lo último de Odoo?» | `get_payables_overview()` → `get_month_closing(fresco:true)` |
| 19 | «Aquí está el reporte del checador de la semana, cárgalo» | `preview_time_report(filas)` (vista y clave) → `save_time_entries(filas, clave)` → (opcional) `list_time_imports` |
| 20 | «Borra la checada duplicada de Luis del martes a las 8:02; y el lunes fue feriado para todos» | `get_week_hours(persona:"Luis", fecha)` → `delete_record(tipo:"checada", persona:"Luis", fecha, entrada:"08:02")` ×2 (avisa que el re-import la restaura) → `save_excused_day(fecha:<lunes>, tipo:"feriado")` directo |
| 21 | «¿Quién no está completando su jornada este mes?» | `get_hours_trend(equipo:true, semanas:4)` (una llamada, no una por persona) |
| 22 | «Haz la nómina de esta semana: trae las horas, carga la hoja del taller (Juan es nuevo, medio tiempo), confirma y cierra» | `save_payroll_hours(traer_de_horas:true)` → `save_payroll_employee(nombre:"Juan", jornada:"media")` → (muestra la tabla de la hoja) → `save_payroll_hours(dias:[…])` → `get_payroll_period()` → `save_payroll_period(accion:"confirmar_borradores")` ×2 → `save_payroll_period(accion:"cerrar")` ×2 |
| 23 | «A Pedro el martes ponle 9.5, no 8» (día ya confirmado) | `save_payroll_hours(corregir:{empleado:"Pedro", fecha, horas:9.5})` ×2 (antes → después y efecto en su total) |
| 24 | «Diego pasa a medio tiempo y su NSS es 1234 56 7890 1» | `list_profiles(persona:"Diego")` → `save_profile(persona:"Diego", jornada:"media", nss:"12345678901")` ×2 (NSS enmascarado en la respuesta; aviso de que su jornada de nómina es otra) |
| 25 | «¿Qué tareas altas siguen abiertas? Comenta en la 45 que ya quedó y ciérrala» | `list_tasks(estado:"abierta", prioridad:"alta")` → `get_task(tarea:45)` → `save_task(tarea:45, comentario:"…", estado:"cerrada")` directo |

**Controles negativos** (no cuentan en las 25):
- **C1.** «Borra la cotización de prueba» → ninguna tool. Se responde que eso se hace en la app (`delete_record` no acepta `cotizacion`).
- **C2.** Con los dos conectores prendidos: «cambia esta cotización: la línea 2 a 120» (tras ver una de DYMMSA-WEB) → `save_quotation`, **nunca** `odoo_save_quotation`. Mide la pregunta 1.

---

## 6. Preguntas abiertas

1. ¿claude.ai le muestra al modelo los nombres de las tools sin el prefijo del conector? Si es así: ¿prefijo `dymmsa_` en todo el conector (unos 300 caracteres) o solo renombrar las que chocan con Odoo (`save_quotation`)?
2. ¿Se adopta la confirmación en dos fases con `clave` para todo riesgo medio o alto, en lugar de `confirmar: true`? Requiere `MCP_PREVIEW_SECRET` y un firmador fuera de `src/lib/odoo/`.
3. ¿`delete_record` como único borrado (recomendado), o `quitar` dentro de cada `save_x`, como propone el mapa?
4. ¿Se aceptan los renombres, aprovechando la reconexión que obliga el split? Son `record_payroll_hours` → `save_payroll_hours`, `get_profiles` → `list_profiles`, `set_inventory_location` → `save_inventory_item` y `save_catalog_item` → `save_urrea_catalog_item`.
5. ¿La corrección de un día confirmado va en `save_payroll_hours` (por entidad, recomendado) o en `save_payroll_period` (por pantalla, como el mapa)?
6. ¿`save_brand` queda fuera, con `crear_marcas` en `save_supplier` y el renombrado en la app? ¿Hace falta leer el catálogo de marcas con su conteo?
7. ¿`save_quotation` permite cambios de línea y estado en una sola llamada («aprueba todo menos la 5 y márcala aprobada»)?
8. ¿La orden manual (productos transcritos) entra en `save_order`?
9. ¿Se publica `outputSchema` (cuesta en `tools/list`) o basta `structuredContent`?
10. ¿Los tokens en español también para los estados que hoy salen en inglés (`draft`, `approved`…)? Obliga a reescribir `BUSINESS_RULES_MD`.
11. ¿`ref` de 8 caracteres como único identificador visible?
12. ¿Se aprueban los topes del conector nuevo: 45 tools, `listTotal` 46,000, descripciones 19,000, instrucciones 6,000?
13. ¿Se quita de las descripciones el texto de rol ahora que solo se conecta el admin, aunque el mecanismo de roles de la #133 se quede?
14. ¿`preview_time_report` firma y `save_time_entries` exige la clave con `filas`, o basta el cuadre contra los totales del reporte (ADR-035)?
