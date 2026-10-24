# MCP escrituras — Órdenes

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[02-Arquitectura/MCP-Escrituras/Ordenes-compra-y-corte]]
> ADRs: [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]] · [[04-Decisiones-Tecnicas/ADR-019-Recepcion-Excedente]] · [[04-Decisiones-Tecnicas/ADR-034-MCP-Reglas-de-Crecimiento]]

## Resumen

El ciclo de vida de la orden: nace de una cotización aprobada (o del Excel de filas verdes, "orden manual"), se le agregan, editan o quitan líneas, se captura la recepción de URREA, cambia de estado y termina cancelada o borrada. **Es el módulo que más mueve `store_inventory`**: descuenta al crear, mete el excedente al recibir y devuelve al cancelar, borrar o quitar una línea. Hoy el MCP solo lo **lee** (`list_orders`, `get_order`). Riesgo general **alto**: **ninguna de estas rutas es transaccional** (no hay RPC, todo son varios queries desde la ruta, con read-modify-write absoluto sobre `store_inventory`), casi toda la lógica vive inline en los route handlers y la RLS no protege nada (todas las tablas son `FOR ALL TO authenticated USING (true)`).

### Mapa de stock (lo que define si una tool es segura)

| Momento | Qué entra/sale de `store_inventory` | Cómo se escribe | ¿Revisa errores del write? |
|---|---|---|---|
| Crear desde cotización | − `quantity_in_stock` por línea (`allocateInventory`) | `update quantity = <leído> − inStock`, en `Promise.all` **al final**, después de insertar orden, ítems y marcar la cotización | No |
| Orden manual | igual | igual, lecturas en paralelo (`Promise.all`) | No |
| Agregar línea | − `quantity_in_stock` de la línea | `update` absoluto **antes** del insert del ítem | No (y no hay rollback) |
| Quitar línea | + `quantity_in_stock` (solo eso) | `update` absoluto; si no hay fila, no hace nada | No |
| Confirmar recepción | ± DELTA del excedente (`receptionExcess` nuevo − persistido) | `update` absoluto con clamp en 0 + warning, o `insert` si no hay fila y delta > 0 | Sí (400/500) |
| Cancelar | + `in_stock + min(recibido, pedido)` (`computeRestoration`) | `restoreOrderInventory`: update absoluto o insert | No |
| Borrar orden | igual que cancelar, **solo** si `deleteRestoresStock(status)` (`ordered`/`received`) | `restoreOrderInventory` | No |

Todo en `store_inventory` es **read-modify-write sin bloqueo** (limitación ya aceptada en ADR-019 "con un solo usuario operando"). El MCP agrega un segundo escritor simultáneo (chat + pantalla), así que la carrera deja de ser teórica.

### Transiciones de estado (`orders.status`)

- `PATCH /status`: **cualquiera a cualquiera** entre `ordered | received | delivered | completed` (no hay grafo). Rechaza `cancelled` como destino y cualquier cambio desde `cancelled`. Una `completed` **sí** puede regresar a `ordered` (la UI muestra el selector para completadas).
- `cancelled` solo se alcanza por `POST /cancel` (desde `ordered`, `received` o `delivered`; nunca desde `completed`). Es terminal.
- `DELETE` acepta cualquier estado.
- Editar líneas, recepción, decisiones de compra y corte: bloqueado en `completed | cancelled` (400).
- La recepción **no** cambia el estado de la orden; el estado es manual.
- El estado es una palanca sobre el stock: `deleteRestoresStock` decide por estado, así que mover `delivered → received` y luego borrar sí devuelve inventario.

## Rutas que escriben

### `POST /api/quotations/[id]/create-order` — `src/app/api/quotations/[id]/create-order/route.ts`
- **Auth / rol:** `requireAuth` (cualquier autenticado). RLS de `orders`, `order_items`, `store_inventory`, `quotations`: abiertas a `authenticated`.
- **Entrada:** solo el `id` de la cotización en la URL; sin body.
- **Qué hace:**
  1. Lee `quotations` con `quotation_items(*)` (límite 5000). 404 si no existe.
  2. 400 si `status !== 'approved'`.
  3. Ordena por `sort_order`; productos aprobados = `item_type` producto (o vacío) **y** `is_approved === true` **y** `is_sold !== false`. 400 si no hay ninguno.
  4. Recorre todos los ítems: los separadores pasan siempre (con `section_label` y `separator_color`); por cada producto aprobado con `model_code` lee `store_inventory` (quantity, location), aplica `allocateInventory(qty, stock)` y anota el descuento pendiente. Snapshot de `location`. `sort_order` se reasigna secuencial. Precio por default 0, cantidad por default 1; `description` = `description || description_es`.
  5. `insert orders` (`quotation_id`, `name`, `customer_name`, `status='ordered'`, `total_amount`, `created_by`).
  6. `insert order_items` en bloque.
  7. `update quotations set status='converted_to_order'`.
  8. `Promise.all` de `update store_inventory set quantity = <leído> − inStock`.
- **Reglas y efectos secundarios:**
  - Stock se descuenta al crear (regla crítica). Invariante `in_stock + to_order = approved` (CHECK `check_quantity_sum`).
  - Rollback ADR-010: si falla el insert de ítems **o** marcar la cotización convertida → `delete orders` (los ítems caen por CASCADE). Marcar convertida corre **antes** de tocar stock a propósito.
  - Índice único parcial `orders_quotation_id_unique`: un segundo clic concurrente choca en el insert de la orden → `explainPgError` → 400 sin tocar stock ni estado.
  - Fallos del update de inventario se ignoran (la orden queda creada con `in_stock` que no se descontó).
  - **Bug:** si la cotización trae el **mismo `model_code` en dos líneas** (pasa: el planificador consolida "duplicados entre secciones"), cada línea lee el stock original porque los descuentos se aplican al final; las dos se asignan contra el mismo stock y el último `update` gana. Ej.: stock 6, dos líneas de 5 → ambas `in_stock = 5` (10 apartados) y el inventario queda en 1.
- **Dónde vive la lógica:** inline en la ruta; solo `allocateInventory` (business-rules) y `explainPgError` son reutilizables. **Hay que extraer** a `src/lib/orders-store.ts` (`createOrderFromQuotation`) antes de cablear la tool, y corregir la asignación con stock corrido por `model_code`.
- **Quién la usa en la UI:** `useCreateOrderFromQuotation` (`src/hooks/useQuotations.ts`) → botón de `QuotationDetail`.

### `POST /api/orders/create` — `src/app/api/orders/create/route.ts` (orden manual)
- **Auth / rol:** `requireAuth`.
- **Entrada:** `CreateOrderInput` = `{ customer_name, products: ApprovedProduct[] }` (`etm, description, description_es, model_code, quantity, price, brand`). Validación inline: solo exige `customer_name` y `products` no vacío. **No valida** `price` (indefinido → `total_amount` NaN), ni `quantity` entero, ni ETM.
- **Qué hace:** lee `store_inventory` de cada producto **en paralelo**, `allocateInventory`, inserta `orders` (`quotation_id` NULL, sin `name`), inserta `order_items` (`delivery_time='immediate'` fijo, sin `location`), descuenta stock en `Promise.all`.
- **Reglas y efectos secundarios:** rollback del padre si falla el insert de ítems (`explainPgError(itemsError, orderItems)` → 400 con `offendingEtm`). Error del insert de la orden → 500 genérico (sin `explainPgError`). Mismo **bug de duplicados** que create-order (aquí las lecturas son literalmente simultáneas). Errores del descuento ignorados.
- **Dónde vive la lógica:** inline (salvo `allocateInventory`). Extraer junto con la anterior (`createManualOrder`), compartiendo el cálculo de asignación.
- **Quién la usa en la UI:** `useCreateOrder` → `NewOrderForm` (`/dashboard/orders/new`, botón "Nueva orden" de la lista, `data-tour="ol-new"`). El formulario sube el Excel aprobado (`detectApprovedProducts`: filas verdes) y llama primero a auto-learn y luego a esta ruta. API-Routes lo llama "flujo legacy".

### `PATCH /api/orders/[id]` — `src/app/api/orders/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** body con `odoo_id` (string o null). Única llave aceptada; sin ella → 400 "Sin cambios". No valida formato.
- **Qué hace:** verifica que la orden exista (404) y `update orders set odoo_id`.
- **Reglas y efectos secundarios:** ninguno; no lo bloquea el estado (se puede editar en completada o cancelada). Error → 500.
- **Dónde vive la lógica:** inline, trivial.
- **Quién la usa en la UI:** `useUpdateOrderOdooId` → campo "ID de Odoo" (lápiz) en el encabezado de `OrderDetail`. **No aparece en `API-Routes.md`.**

### `DELETE /api/orders/[id]` — `src/app/api/orders/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `id` en la URL.
- **Qué hace:** lee la orden (404); si `deleteRestoresStock(status)` (`ordered`/`received`) → `restoreOrderInventory`; luego `delete order_items` y `delete orders`.
- **Reglas y efectos secundarios:** cualquier estado. Una cancelada no se vuelve a restaurar (ya lo hizo `/cancel`); una entregada/completada no devuelve (ya salió con el cliente). `cut_plan_pieces` y `order_purchase_decisions` caen por CASCADE. La cotización ligada se queda en `converted_to_order`: borrar la orden es el requisito para reabrirla o borrarla (ADR-010). **Los errores de los dos `delete` se ignoran** → responde `success` aunque no haya borrado; un reintento restauraría el stock otra vez.
- **Dónde vive la lógica:** mixta — `deleteRestoresStock`, `restoreOrderInventory`, `computeRestoration` en `src/lib/inventory.ts` (reutilizables); el orden de pasos, inline.
- **Quién la usa en la UI:** `useDeleteOrder` → `OrderDetail` (diálogo con `deleteStockNote`) y `OrdersTable`.

### `PATCH /api/orders/[id]/status` — `src/app/api/orders/[id]/status/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `{ status }`. `cancelled` → 400 ("usa Cancelar orden"); fuera de `MANUAL_ORDER_STATUSES` → 400.
- **Qué hace:** lee la orden (404); si está `cancelled` → 400; `update status`.
- **Reglas y efectos secundarios:** sin grafo de transiciones; no toca stock directamente pero cambia lo que hará un `DELETE` posterior (ver arriba). `completed` bloquea ediciones y es reversible. Error → 500.
- **Dónde vive la lógica:** inline; la lista `MANUAL_ORDER_STATUSES` es local a la ruta (moverla a lib para compartirla con la tool).
- **Quién la usa en la UI:** `useUpdateOrderStatus` → selector "Estado" de `OrderDetail` (oculto en canceladas).

### `POST /api/orders/[id]/cancel` — `src/app/api/orders/[id]/cancel/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `id` en la URL; sin body.
- **Qué hace:** lee la orden (404); 400 si ya está `cancelled` o si está `completed`; `restoreOrderInventory`; `update status='cancelled'`.
- **Reglas y efectos secundarios:** restaura `in_stock + min(recibido, pedido)` (el excedente no, ya entró en la recepción — ADR-019). La cotización no cambia. **Restaura antes de cambiar el estado y no revisa el error del update**: si el update falla, el stock ya volvió y la orden sigue activa; cancelarla de nuevo lo duplica. **Permite cancelar una `delivered`** y restaura su stock, aunque `deleteRestoresStock` dice que una entregada "ya salió con el cliente" (inconsistencia; no hay test que lo cubra).
- **Dónde vive la lógica:** mixta (`restoreOrderInventory` en lib; guardas inline).
- **Quién la usa en la UI:** `useCancelOrder` → botón "Cancelar Orden" con `AlertDialog` (oculto en canceladas y completadas).

### `POST /api/orders/[id]/confirm-reception` — `src/app/api/orders/[id]/confirm-reception/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `ConfirmReceptionInput` = `{ items: [{ id, quantity_received, urrea_status }] }`. Valida inline: arreglo no vacío y `quantity_received` entero ≥ 0. `urrea_status` **no se valida** en la ruta (lo frena el CHECK `order_items_urrea_status_check`).
- **Qué hace:** lee la orden (404), 400 si `completed`/`cancelled`. Por cada ítem, **secuencial**: lee el ítem persistido, salta separadores, calcula `delta = receptionExcess(nuevo) − receptionExcess(persistido)`, `update order_items (quantity_received, urrea_status)`, y si `delta ≠ 0` y hay `model_code`: update con clamp en 0 (warning si quedaría negativo), insert si no hay fila y delta > 0, warning si no hay fila y delta < 0. Al final recalcula `total_amount = calculateDeliveredTotal(items)`.
- **Reglas y efectos secundarios:** ADR-019 completo: solo el excedente entra a tienda, por delta → re-confirmar es idempotente; corregir a la baja resta con clamp. El excedente nunca se factura (`receivedForCustomer`). Errores de `order_items`/`store_inventory` → `explainPgError` (400) o 500, **pero los ítems anteriores del lote ya quedaron escritos** (sin transacción). Lo que la UI pone y la ruta **no** exige:
  - **El ítem no se acota a la orden:** el `select`/`update` va por `id` sin `.eq('order_id', …)`; un id de otra orden (incluso completada o cancelada) se modifica desde la URL de una abierta.
  - **Líneas sin pedido a URREA** (`quantity_to_order = 0`): la UI no las deja capturar; la ruta las acepta y todo lo recibido sería "excedente" que entra a tienda.
  - **El resumen anti-dedazo** (pedido/recibido/excedente, ⚠️ si recibido > 2× pedido) vive en `OrderDetail` (`receptionSummary`), no en lib.
  - **`statusAfterReceived` (#146)** es solo de la captura (`autoFrom`, `manual` nunca viajan): la ruta guarda el `urrea_status` que le manden.
- **Dónde vive la lógica:** mixta — `receptionExcess`, `receivedForCustomer`, `calculateDeliveredTotal`, `statusAfterReceived` en `business-rules.ts`; el loop de delta, clamp y warnings, inline. Extraer `confirmReception()` a `orders-store.ts` y el resumen a una función pura (`receptionPreview()`) antes de la tool.
- **Quién la usa en la UI:** `useConfirmReception` → botón "Confirmar Recepción" de `OrderDetail` → diálogo de resumen → `executeConfirmReception`.

### `POST /api/orders/[id]/items` — `src/app/api/orders/[id]/items/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `{ etm, description, model_code, brand, unit_price, quantity_approved }`. Valida inline: `quantity_approved ≥ 1` (no exige entero) y `unit_price ≥ 0`.
- **Qué hace:** lee la orden (404; 400 si completada/cancelada); si hay `model_code` lee stock, `allocateInventory` y **descuenta antes de insertar**; calcula `sort_order = max + 1`; inserta el ítem (`urrea_status='pending'`, sin `item_type`, `delivery_time` ni `location` → defaults); recalcula `total_amount = calculateOrderTotal(items)`.
- **Reglas y efectos secundarios:** **sin rollback del stock**: si el insert falla (p. ej. `quantity_approved` 1.5 → error de tipo entero), el descuento ya se hizo. Error del insert → 500 genérico (sin `explainPgError`). No toma snapshot de `location` (create-order sí). Recalcular con `calculateOrderTotal` **pisa** el total de entrega que dejó la recepción (ver hallazgos).
- **Dónde vive la lógica:** inline salvo `allocateInventory`/`calculateOrderTotal`. Extraer (`addOrderItem`).
- **Quién la usa en la UI:** `useAddOrderItem` → diálogo "Agregar" de `OrderDetail`. Sin tests de comportamiento (solo `auth-guards`).

### `PATCH /api/orders/[id]/items/[itemId]` — `src/app/api/orders/[id]/items/[itemId]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `unit_price` (≥ 0, tipo no validado) y/o `delivery_time` (contra `VALID_DELIVERY_TIMES` local). Sin ninguno → 400.
- **Qué hace:** `getOrderAndItem` (404 orden/ítem, 400 si completada/cancelada; el ítem sí se acota a la orden); `update order_items`; si cambió el precio, `recalculateTotal` (`calculateOrderTotal`).
- **Reglas y efectos secundarios:** **no revisa el error del update** (responde éxito aunque falle). No impide editar el precio de un separador (inocuo). Mismo pisotón del total de entrega.
- **Dónde vive la lógica:** inline; `getOrderAndItem`/`recalculateTotal` son helpers locales de la ruta (moverlos a `orders-store.ts`). `VALID_DELIVERY_TIMES` duplica el enum de `DeliveryTime`.
- **Quién la usa en la UI:** `useEditOrderItem` (precio, edición en línea) y `useEditDeliveryTime` (select de tiempo de entrega) en `OrderDetail`.

### `DELETE /api/orders/[id]/items/[itemId]` — misma ruta
- **Auth / rol:** `requireAuth`.
- **Entrada:** ids en la URL.
- **Qué hace:** `getOrderAndItem`; si hay `model_code` y `quantity_in_stock > 0` y existe la fila de inventario → `update quantity + in_stock`; `delete` del ítem; `recalculateTotal`.
- **Reglas y efectos secundarios:** **devuelve solo `quantity_in_stock`**, a diferencia de `computeRestoration` (cancelar/borrar), que también devuelve `min(recibido, pedido)` — una línea ya recibida se quita y lo del cliente que llegó a tienda no vuelve al inventario. **No consulta el estado**: en una `delivered` devuelve stock que ya salió (borrar la orden entera no lo haría). Sin fila de inventario no recrea nada (cancelar sí la crea). Errores ignorados. Los separadores se pueden quitar.
- **Dónde vive la lógica:** inline. Extraer (`removeOrderItem`) y alinearla con `computeRestoration`/`deleteRestoresStock`.
- **Quién la usa en la UI:** `useRemoveOrderItem` → botón de quitar línea + diálogo en `OrderDetail`.

### `POST /api/orders/auto-learn` — `src/app/api/orders/auto-learn/route.ts`
- **Auth / rol:** `requireAuth`. RLS de `etm_products` abierta a `authenticated`.
- **Entrada:** `{ products: ApprovedProduct[] }`; 400 si no es arreglo.
- **Qué hace:** por producto, secuencial: si falta `etm`, `description`, `model_code` o `price` → `skipped`; si el ETM ya existe → `existing` (no actualiza nada); si no, `insert etm_products` con `brand='URREA'` fijo (ignora el `brand` del producto; hay test que lo exige), `description_es`, `price`, `created_by`.
- **Reglas y efectos secundarios:** solo altas, nunca edita. No toca `is_sold` ni `dymmsa_description` (no es el auto-learn de cotizaciones, `src/lib/auto-learn.ts`). Escribe el catálogo ETM, no la orden.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useAutoLearn` → `NewOrderForm`, antes de `POST /api/orders/create`. API-Routes lo marca "legacy".

## Cobertura MCP actual

- **`list_orders`** (lectura): `status`, `search` (nombre/cliente), paginación. Devuelve el `total_amount` sellado en la fila.
- **`get_order`** (lectura): **solo por UUID** (`id`); ítems en orden con cantidades, `urrea_status`, `delivery_time`, `location`, más `pending_urrea_items`. Sus ítems **no traen `id` ni número de línea**, y su `total` se recalcula con `calculateOrderTotal` (aprobado), no el de entrega que guarda la recepción.
- **`get_quotation`** trae la orden ligada (`orden`, vía `findOrderByQuotation`).
- `resolveOrder()` (`src/lib/mcp/tools/orders.ts`) ya busca por UUID o nombre/cliente parcial con `requireSingleMatch`; la usan `get_cut_plan`/`get_purchase_plan`, no `get_order`.
- `BUSINESS_RULES_MD` (`server.ts`) ya describe "stock se deduce al CREAR… cancelar/eliminar lo restaura".
- **Escrituras: ninguna.** Hoy desde el chat no se puede crear una orden, cambiar su estado, capturar recepción, cancelar, ni tocar líneas. CLAUDE.md conserva la decisión del 2026-08-20 ("núcleo transaccional… solo-lectura; se diseña con el usuario antes de implementar"), que la decisión del 2026-10-22 reabre.

## Casos de uso desde el chat

1. "Genera la orden de la cotización de Andritz." → `create-order` (cotización `approved`, stock, `converted_to_order`, índice único).
2. "Ya llegaron 10 del 6954 de la orden de GE, pedimos 8." → `confirm-reception` (+2 de excedente a tienda, línea a Surtido por `statusAfterReceived`).
3. "Del 4410 no nos van a surtir nada, márcalo como no surtido." → `confirm-reception` con `urrea_status='not_supplied'` y la misma cantidad (sale del total de entrega).
4. "Me equivoqué: del 6954 fueron 8, no 10." → `confirm-reception` (delta −2, clamp en 0 con warning si ya se vendió).
5. "Pásala a entregada." / "Ya está completada." → `PATCH /status` (y efecto en un borrado posterior).
6. "Cancela la orden de Truper, el cliente se echó para atrás." → `POST /cancel` (devuelve stock, terminal).
7. "Agrégale 3 rodillos ETM 12345 a $85 a la orden 12." → `POST /items` (descuenta stock si hay).
8. "Cámbiale el precio a la línea 4 a $120 y ponle entrega 1 semana." → `PATCH /items/[itemId]` (dos campos, recalcula total).
9. "Quita el desarmador de la orden de FieldCore." → `DELETE /items/[itemId]` (devuelve el stock apartado).
10. "La orden 12 en Odoo es la S00912." → `PATCH /api/orders/[id]` (`odoo_id`).
11. "Borra la orden de prueba." → `DELETE /api/orders/[id]` (ver Fuera a propósito).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Ligar `odoo_id` | bajo | Un texto en la fila; reversible; sin efectos. |
| Tiempo de entrega de una línea | bajo | Solo informativo; reversible. |
| Precio de una línea | medio | Cambia el `total_amount` de la orden (y pisa el total de entrega tras recepción). Reversible. |
| Cambiar estado (manual) | medio | Sin grafo; `completed` congela ediciones; cambia si un borrado devuelve stock. Reversible salvo `cancelled`. |
| Agregar línea | medio | Descuenta stock antes de insertar, sin rollback. Reversible quitándola (devuelve `in_stock`). |
| Quitar línea | medio | Devuelve stock con una regla distinta a cancelar (no devuelve lo recibido; no mira el estado). Destructivo para la línea. |
| Confirmar recepción | alto | Mueve inventario por el excedente; un dedazo mete stock fantasma (por eso la UI exige resumen); lote sin transacción; la ruta no acota ítems a la orden ni excluye líneas sin pedido. |
| Crear desde cotización | alto | Descuenta stock de muchas líneas de golpe, cambia la cotización a `converted_to_order` (reabrir exige borrar la orden), bug de duplicados, sin transacción. |
| Orden manual | alto | Igual que la anterior, con entrada libre (productos transcritos en el chat) y validación mínima. |
| Cancelar | alto | Irreversible (terminal); devuelve stock; restaura antes de cambiar el estado sin revisar el error; permite cancelar entregadas. |
| Borrar orden | alto | Borrado permanente de la orden, sus ítems, su corte y sus decisiones; puede devolver stock; errores ignorados. |
| Auto-learn | medio | Escribe el catálogo ETM con `brand='URREA'` fijo; no es de esta entidad. |

## Propuesta de tools

Prerrequisitos comunes (antes de cablear cualquier tool que mueva stock):
- **`src/lib/orders-store.ts`** con la lógica de las rutas, compartida ruta↔tool (precedente `payroll-store.ts`): `createOrderFromQuotation`, `createManualOrder`, `setOrderStatus` (+ `MANUAL_ORDER_STATUSES`), `setOrderOdooId`, `cancelOrder`, `addOrderItem`, `updateOrderItem`, `removeOrderItem` (+ `getOrderAndItem`, `recalculateTotal`), `confirmReception`. Errores como `OrderError` → 400 en la ruta / `ToolError` en el MCP.
- **Ajuste atómico de inventario:** RPC `adjust_store_inventory(model_code, delta)` (`quantity = greatest(0, quantity + delta)`, inserta si falta) para reemplazar los read-modify-write; ideal: create-order, cancelar y recepción como funciones plpgsql (INVOKER) transaccionales. Decisión del usuario (pregunta 1).
- **Corregir antes:** asignación con stock corrido por `model_code` (bug de duplicados); acotar la recepción a `order_id` y a líneas con `quantity_to_order > 0`; revisar errores en cancelar/borrar/editar.
- **Admin real en la tool:** la RLS de estas tablas no distingue rol, así que `adminOnly` en el manifiesto solo poda la lista; cada tool debe llamar `requireLiveAdmin(ctx)` (precedente: escrituras de Odoo, `src/lib/mcp/core/auth/live-admin.ts`).
- **Referencia de línea:** `get_order` debe exponer `id` y `linea` (contador 1-based de productos, sin separadores). Las tools aceptan `linea` o `codigo`/`etm` (`requireSingleMatch`; un código repetido en dos secciones = error que lista las líneas) y, si llegan ambos, verifican que coincidan.
- **Clave de vista previa genérica:** `src/lib/odoo/preview-token.ts` está atado a Odoo (`OdooError`, secreto derivado de `ODOO_WRITE_API_KEY`, `AdminProof` de `odoo/write-guard`). Para el patrón "alto" hay que extraer un `src/lib/mcp/preview-key.ts` con su propio secreto de servidor.
- `get_order` debería aceptar id **o nombre** (`resolveOrder`), como las tools de escritura.

### 1. `save_order` — entidad: orden (adminOnly)
- **Acciones (`accion` enum):**
  - `crear_desde_cotizacion` — `cotizacion` (id o nombre, `requireSingleMatch`). **Vista previa con clave:** sin `clave` devuelve, sin escribir, las líneas que pasarán, cuánto sale de stock por línea (con la asignación corrida), cuánto queda por pedir, total y el aviso de que la cotización pasa a `converted_to_order`; firma una clave sobre (cotización, `updated_at`, hash de ítems aprobados, snapshot de stock). Con `clave` crea; si algo cambió → "vuelve a pedir la vista previa".
  - `crear_manual` — `cliente` + `productos[{etm, codigo, descripcion, marca, cantidad, precio}]`. Vista previa con clave, como la anterior. No llama auto-learn (pregunta 4).
  - `estado` — `orden`, `estado` (`pedido|recibido|entregado|completado`). **Confirmar:** sin `confirmar` devuelve de→a y qué implica (completada congela ediciones; entregada/completada ya no devuelve stock al borrar).
  - `cancelar` — `orden`. **Confirmar** (reforzado): sin `confirmar` devuelve la restauración exacta por código (`computeRestoration`) y que es irreversible; con `confirmar: true` ejecuta. Si se quiere la clave HMAC también aquí, ver pregunta 3.
  - `odoo_id` — `orden`, `odoo_id` (string o null). **Directo.**
- **Store/refactor:** `orders-store.ts` (todas), RPC de inventario, clave genérica, fix de duplicados, `cancelOrder` que cambie el estado y devuelva el stock de forma atómica o, como mínimo, que primero cambie el estado.
- **Fusión:** no reemplaza ninguna tool existente.

### 2. `save_order_items` — entidad: líneas de una orden (adminOnly)
- **Acciones (`accion` enum):**
  - `agregar` — `orden`, `etm`, `codigo`, `descripcion`, `marca`, `cantidad` (entero ≥ 1), `precio` (≥ 0). **Confirmar:** el resumen dice cuánto sale de stock y cuánto queda por pedir.
  - `editar` — `orden`, `linea`/`codigo`, `precio?`, `entrega?` (enum `inmediata|2_3_dias|3_5_dias|1_semana|2_semanas|indefinida`). **Directo** si solo cambia la entrega; **confirmar** si cambia el precio (muestra total antes→después).
  - `quitar` — `orden`, `linea`/`codigo`. **Confirmar:** muestra qué vuelve a inventario.
  - `recibir` — `orden`, `lineas[{linea|codigo, recibido, estado?}]`. **Vista previa con clave:** sin `clave` devuelve el resumen de ADR-019 (pedido, recibido, excedente, efecto en inventario, ⚠️ si recibido > 2× pedido, estado resultante) y firma la clave; con `clave` escribe. Sin `estado`, aplica `statusAfterReceived(recibido, pedido, { status: guardado, autoFrom: null, manual: false })` (recibido ≥ pedido → Surtido; parcial no cambia); con `estado` explícito, ese gana (equivale a `manual`). Rechaza líneas sin pedido a URREA y de otra orden.
- **Store/refactor:** `addOrderItem`/`updateOrderItem`/`removeOrderItem`/`confirmReception` en `orders-store.ts`; `receptionPreview()` puro (hoy en `OrderDetail`); decidir la regla de stock de `quitar` (pregunta 5) y la del total (pregunta 6). Agregar tests de comportamiento de las rutas de ítems (hoy no hay) antes de extraer.
- **Alternativa:** separar `recibir` en `save_order_reception` (+1 tool) si mezclar una acción "alta" con vista previa y acciones "bajas" vuelve confusa la descripción (pregunta 2).

**Total: 2 tools nuevas** en este grupo (3 si la recepción va aparte). El bloque app está en 36 de 36 (`TOOL_BUDGET`), así que hay que subir el tope o liberar lugares. Candidatos a fusión **de lectura** (precedente #134: `get_order_by_quotation` → `get_quotation`):
- `list_orders` → `get_order` (sin `orden` lista; con `orden` detalle): libera 1.
- `get_purchase_plan` y `get_cut_plan` → `get_order` con `incluir: ['compra','corte']`: libera hasta 2 (ver [[02-Arquitectura/MCP-Escrituras/Ordenes-compra-y-corte]]).

Las dos tools nuevas llevan esquemas largos (líneas, recepción): cuidan los topes de 1,000 caracteres por descripción y de `tools/list` (54,000 en el cable desde #158; 47,000 con el stub al escribir esta ficha).

## Fuera a propósito

- **`DELETE /api/orders/[id]` (borrar orden):** borrado permanente (orden, ítems, corte, decisiones) que además puede devolver stock y desbloquea reabrir la cotización. Precedente del MCP: los borrados se quedan en la app (facturas, medidas, proveedores). Para el chat basta `cancelar`. Si se decide incluirlo, va con vista previa y clave (pregunta 7).
- **`POST /api/orders/auto-learn`:** no es de la entidad orden: da de alta ETMs en `etm_products` con `brand='URREA'` fijo, como paso previo del formulario de orden manual. Si el chat necesita dar de alta un ETM, es trabajo de la tool del catálogo ETM (ficha de Catálogos), no un efecto oculto de crear una orden.

## Preguntas abiertas

1. ¿Se mueven primero create-order, cancelar y recepción a funciones transaccionales en la BD (o al menos un RPC `adjust_store_inventory` con delta atómico) antes de abrirlas al MCP? Con el chat como segundo escritor, la carrera de ADR-019 deja de ser hipotética.
2. ¿La recepción va dentro de `save_order_items` (`accion: 'recibir'`) o en su propia `save_order_reception`?
3. ¿Cancelar lleva solo `confirmar: true` con el resumen de restauración, o vista previa con clave HMAC como las acciones de creación? (Es irreversible.)
4. Orden manual por chat: ¿se incluye? Si sí, ¿los ETM nuevos se dan de alta (auto-learn) o solo se crea la orden con lo que venga?
5. Quitar una línea ya recibida: ¿debe devolver `in_stock + min(recibido, pedido)` como cancelar, y no devolver nada si la orden está `delivered`/`completed`? Hoy solo devuelve `in_stock` y en cualquier estado abierto.
6. `orders.total_amount` cambia de significado según la última acción (aprobado tras editar líneas, de entrega tras recepción). ¿Cuál es el bueno? Define qué reporta la tool después de cada escritura.
7. ¿Borrar orden se queda en la app (propuesta) o entra al MCP con vista previa?
8. ¿Cancelar una orden `delivered` debe seguir permitido y devolver su stock?
9. ¿Se quiere bitácora (`audit_events`, ADR-028) para estado, cancelación y recepción hechos desde el chat? Hoy los movimientos de stock no dejan rastro.
10. ¿El cambio de estado debe tener un grafo (p. ej. no regresar de `completed`) al menos desde el MCP, o sigue libre como en la app?
