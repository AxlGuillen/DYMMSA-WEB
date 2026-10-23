# MCP escrituras — Finanzas

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-028-Bitacora-Generica]] · [[04-Decisiones-Tecnicas/ADR-030-MCP-Cobertura-y-Escrituras-Payables]] · [[04-Decisiones-Tecnicas/ADR-037-MCP-Escrituras-Proveedores-Facturas-Nomina-Materiales]]

## Resumen

Facturas por pagar (#84/#100/#109/#134; moneda MXN/USD desde 2026-10-20): un registro **simbólico** de gastos, porque la facturación oficial vive en Odoo. Tres métodos escriben sobre `payables`, y un trigger DEFINER (`audit_events`, ADR-028) deja la bitácora. Hay además dos `POST` que solo purgan la caché de Odoo.

El MCP ya registra facturas (`create_payable`), las corrige o cancela (`update_payable`) y las paga (`mark_payable_paid`). Faltan borrar y reactivar una cancelada.

El riesgo va de bajo a medio: no mueve dinero ni inventario, pero `paid_at` es el dato de la planeación fiscal y el borrado es duro.

## Rutas que escriben

### `POST /api/payables` — `src/app/api/payables/route.ts`
- **Auth / rol:** `requireAuth`, member incluido. Finanzas es visible para todos en el sidebar; solo Nómina es de admin. RLS `"Authenticated users can manage payables"`: `FOR ALL TO authenticated USING (true)`.
- **Entrada:** validación **inline en la ruta**.
  - `supplier_id`: string obligatorio.
  - `concept`: trim, no vacío.
  - `amount`: number finito > 0.
  - `currency`: default `MXN`; `isPayableCurrency` (MXN | USD) o 400.
  - `invoice_date` y `due_date`: `isRealDate`, que revisa forma y existencia (`2026-02-30` → 400).
  - `notes`: trim → `null`.
  - **El `status` del body se ignora:** siempre nace `pending` con `paid_at: null`.
  - No valida `due_date >= invoice_date`.
  - El vencimiento **no** se calcula en la API: la UI lo pre-llena con `dueDateFrom(invoice_date, payment_terms_days)` y lo manda.
- **Qué hace:**
  1. select del proveedor (`.single()`); si no existe → 404 "El proveedor no existe", antes del insert y en vez del 23503;
  2. insert con `.select('*, supplier:suppliers(id, name, payment_terms_days)')`;
  3. responde 201.
- **Reglas y efectos secundarios:**
  - El trigger `payables_audit` → `audit_payable()` (SECURITY DEFINER, `search_path=''`) inserta un evento `created` con `{ concept, amount, supplier_id, status }`. El actor sale de `auth.uid()` y `actor_name` es un snapshot del `display_name`.
  - El snapshot **no** guarda `currency` ni las fechas.
  - CHECKs de la tabla: `amount > 0`, `currency`, `status` y `concept` no vacío.
  - Un error de insert responde 500 genérico, sin `explainPgError`.
- **Dónde vive la lógica:** inline en la ruta. La tool `createPayable` (`src/lib/mcp/tools/payables.ts`) **repite las mismas validaciones a mano**, y además resuelve el proveedor por nombre y calcula el vencimiento por plazo. Hay que extraer `parsePayableInsert()` a `src/lib/payables.ts` y `createPayable(db, input)` a un `src/lib/payables-store.ts` nuevo, con `suppliers-store.ts` como precedente.
- **Quién la usa en la UI:** `useCreatePayable` → `PayableForm` (`/dashboard/finance/payables`).

### `PATCH /api/payables/[id]` — `src/app/api/payables/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** sparse, por `parsePayableUpdate(body, todayInMexico())` (`src/lib/payables.ts`):
  - `concept` no vacío; `amount` > 0; `currency` MXN | USD; `invoice_date` / `due_date` con `isRealDate`; `supplier_id` string no vacío; `notes` trim → `null`;
  - `status` → `resolvePaymentUpdate(status, paid_at, today)`:
    - `paid` sin `paid_at` → **hoy**, con `todayInMexico()` (zona `America/Mexico_City`; el server corre en UTC);
    - cualquier otro estado → `paid_at = null`;
  - `paid_at` solo, sin `status`: corrige la fecha **sin revisar el estado**. Con eso, un PATCH a una pendiente puede dejarle `paid_at` puesto aunque el estado no sea `paid`.
- **Qué hace:**
  1. si viene `supplier_id`, select de existencia (inline) → 404;
  2. update con `.select(…).single()`; PGRST116 → 404 "La factura no existe".
- **Reglas y efectos secundarios:**
  - **No hay guardas de transición:** cualquier estado puede pasar a cualquier otro.
    - De pagada a cancelada se limpia `paid_at`.
    - De cancelada a pendiente se reactiva.
    - Un `status: 'paid'` suelto sobre una pagada **re-sella hoy**. Por eso la UI manda `status`/`paid_at` solo si cambiaron (#100).
  - El trigger solo audita cambios de `status` (`status_changed`) o de `paid_at` (`paid_at_changed`), con `{ from, to }`.
  - **No audita** concepto, monto, moneda, fechas, proveedor ni notas: el propio trigger lo dice ("not audited (yet)").
  - "Pagada por" en `GET /api/payables` (solo admin) sale del último `status_changed` hacia `paid`.
  - `moddatetime` en `updated_at`.
- **Dónde vive la lógica:** mixta. Las reglas están en `payables.ts` (`parsePayableUpdate`, `resolvePaymentUpdate`), ya compartidas con `update_payable` y `mark_payable_paid`. El chequeo de proveedor y el update están inline.
- **Quién la usa en la UI:** `useUpdatePayable`, en dos lugares:
  - `PayableForm`: el popup de editar, con Estado y "Pagada el" (#100). Permite cualquier transición, incluida reactivar una cancelada.
  - `PayablesTable`: el botón ✓ "Marcar como pagada (hoy)" en las pendientes y ↺ "Regresar a pendiente" en las pagadas, ambos sin diálogo. Las canceladas no tienen botón.

### `DELETE /api/payables/[id]` — `src/app/api/payables/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** solo el `id`.
- **Qué hace:** `delete().eq('id', id)`. Es un **borrado duro**.
- **Reglas y efectos secundarios:**
  - El trigger inserta `deleted` con el snapshot `{ concept, amount, supplier_id, status, paid_at }`, sin `currency`, fechas ni notas. Solo el admin lo lee.
  - Se puede borrar en cualquier estado, también una pagada.
  - No verifica que exista: un id inexistente → `{ ok: true }`.
  - Nada referencia a `payables`, así que no hay FK que lo bloquee.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useDeletePayable` → `PayablesTable`, con AlertDialog "Esta acción no se puede deshacer. La factura desaparecerá del overview.".

### `POST /api/finance/income/refresh` — `src/app/api/finance/income/refresh/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** query `month` (YYYY-MM; default, el mes actual de México) → 400 si es inválido.
- **Qué hace:**
  - Sin Odoo configurado: `incomeUnavailable(month, today, 'not_configured')`.
  - Con Odoo: `revalidateTag('finance-income', { expire: 0 })` y luego una lectura **cruda** `loadIncomeFresh(month)` dentro de `withinBudget()` (45 s) → `buildIncomeOverview`.
  - Un `OdooError` responde 200 con `odoo_error`. `maxDuration = 60`.
- **Reglas y efectos secundarios:** no escribe datos. Purga el Data Cache (900 s, `INCOME_REVALIDATE_SECONDS`) que comparten el overview, Clientes y `get_month_closing`. Cuesta lecturas a Odoo, que va por una cola serializada con rate limit.
- **Dónde vive la lógica:** mixta. La purga está en la ruta; la lectura, en `src/lib/odoo/income-cache.ts` + `src/lib/income.ts`.
- **Quién la usa en la UI:** `useRefreshIncome` → `FinanceOverview` (botón de actualizar).

### `POST /api/clients/refresh` — `src/app/api/clients/refresh/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** ninguna.
- **Qué hace:** `revalidateTag('odoo-customers', { expire: 0 })` y `revalidateTag('finance-income', { expire: 0 })`, porque comparten las facturas abiertas. Responde `{ ok: true }` y las pantallas releen.
- **Reglas y efectos secundarios:** no escribe datos.
- **Dónde vive la lógica:** en la ruta (dos llamadas).
- **Quién la usa en la UI:** `useRefreshCustomers` → `CustomersList`, `CustomerDetail`.

## Cobertura MCP actual

- **Lecturas:**
  - `list_payables`: estado, incluido `overdue`; mes de vencimiento; proveedor; concepto; `limit`. Trae `suma_mostrada` por moneda.
  - `get_payable`: el detalle. El `historial` solo llega a un admin (ADR-028).
  - `get_payables_overview`: MXN, con las otras monedas aparte y sin convertir.
  - `get_month_closing`: egresos, más ingresos de Odoo vía `cachedMonthCollections` / `cachedOpenCustomerMoves`. **Lee la caché**, hasta 15 min vieja, y sin `withinBudget`.
- **`create_payable`** (escritura, **no** `adminOnly`):
  - Parámetros: `proveedor` (nombre parcial → `resolveSupplier`), `concepto`, `monto > 0`, `moneda` (MXN | USD, default MXN), `fecha_factura`, `vencimiento?` (default: `dueDateFrom` con el plazo del proveedor), `notas?`.
  - Nace `pending`. Su validación es una copia de la ruta.
- **`update_payable`** (escritura, **no** `adminOnly`):
  - Parámetros: `factura` (UUID, o concepto/proveedor → `resolvePayable`, que prefiere las pendientes al cancelar), `concepto`, `monto`, `moneda`, `fecha_factura`, `vencimiento`, `proveedor` (reasignar por nombre), `notas` y `cancelar: true`.
  - Pasa por `parsePayableUpdate`.
  - Guardas: una ya cancelada → error; una pagada no se cancela directo, primero se regresa a pendiente.
  - Devuelve `cambios` (antes/ahora) y avisa si cambió la fecha de factura sin cambiar el vencimiento.
  - **No** impide cambiar monto, moneda o proveedor de una pagada o una cancelada.
- **`mark_payable_paid`** (escritura, **no** `adminOnly`):
  - Parámetros: `factura`, `pagada` (default `true`; `false` = regresar a pendiente) y `fecha_pago` (default hoy, con `todayInMexico()`).
  - Usa `resolvePaymentUpdate`.
  - Guardas:
    - cancelada → "reactívala desde la app";
    - ya pendiente → aviso;
    - pagada sin `fecha_pago` → error, para no re-sellar hoy;
    - pagada con `fecha_pago` → corrige la fecha (evento `paid_at_changed`).
- Ninguna tool escribe en `audit_events`: el trigger atribuye cada escritura al usuario del token. Como un member recibe las tres, sus descripciones y respuestas no mencionan la bitácora (ADR-028).
- **No puede hoy:**
  - borrar una factura;
  - reactivar una cancelada;
  - pasar una pagada a cancelada en un solo paso (a propósito);
  - registrar una factura ya pagada en una sola llamada;
  - elegir el proveedor por UUID;
  - leer los ingresos frescos de Odoo.

## Casos de uso desde el chat

1. "Registra una factura de Tornillos MX por $2,500 con fecha de hoy" → `POST`; el vencimiento sale del plazo del proveedor (ya existe).
2. "Registra la de Perfiles por 300 dólares" → `POST` con `currency: 'USD'` (ya existe).
3. "Ya pagué la de Perfiles, fue ayer" → `PATCH` `status: 'paid'` + `paid_at` (ya existe).
4. "La de Perfiles era por $3,200, no $2,300" → `PATCH` `amount` (ya existe; sin rastro en la bitácora).
5. "Esa factura es de Perfiles MX, no de Perfiles" → `PATCH` `supplier_id` (ya existe, por nombre).
6. "Cancela la factura duplicada de Tornillos" → `PATCH` `status: 'cancelled'` (ya existe, solo pendientes).
7. "Reactiva la de Tornillos que cancelé por error" → `PATCH` de cancelada a `pending`. Hoy solo en la app.
8. "Borra la factura que registré dos veces" → `DELETE`. Hoy solo en la app.
9. "Registra la de Tornillos por $800, ya la pagué hoy" → `POST` + `PATCH`: hoy son dos tools.
10. "Actualiza el cierre con lo último de Odoo" → `POST /api/finance/income/refresh`. El MCP lee la caché.

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Registrar factura (MXN o USD) | bajo | Nace pendiente; se corrige o cancela; nunca se convierte la moneda |
| Marcar pagada con fecha real | bajo | Reversible; auditada con actor |
| Corregir la fecha de pago de una pagada | bajo | Evento `paid_at_changed` con from/to |
| Regresar una pagada a pendiente | bajo | Limpia `paid_at`, pero la bitácora conserva el `from`; la UI lo hace en un clic |
| Corregir concepto, notas, fechas, monto, moneda o proveedor de una **pendiente** | bajo | Todavía no es un gasto pagado; reversible |
| Corregir monto, moneda, proveedor o fechas de una **pagada** | medio | Cambia una cifra ya pagada (planeación fiscal) y el trigger **no** lo audita |
| Cancelar una pendiente | bajo | Reversible (reactivar) y auditada |
| Reactivar una cancelada | bajo | Reversible y auditada |
| Cancelar una pagada | medio | Pierde `paid_at`; hoy son dos pasos a propósito (ADR-037) |
| Borrar factura | medio | Duro e irreversible; la bitácora guarda un snapshot parcial; la alternativa suave es cancelar |
| Refrescar ingresos / clientes | bajo | Solo purga caché; cuesta lecturas a Odoo (rate limit) |

## Propuesta de tools

### Opción A (recomendada): `save_payable`, que fusiona `create_payable` + `update_payable` + `mark_payable_paid`

Entidad: factura por pagar. Es la regla 1 de ADR-034 ("una tool por entidad"), de la que ADR-037 dejó a `update_payable` como excepción explícita solo para no renombrar escrituras en uso.

- **Parámetros:**
  - `factura?`: UUID, o concepto/proveedor; ausente = alta;
  - `proveedor?`: en un alta es obligatorio; en una edición, reasigna. Acepta UUID o nombre, con `resolveSupplier` arreglado (ver [[02-Arquitectura/MCP-Escrituras/Proveedores-y-marcas]]);
  - `concepto?`, `monto?` (> 0), `moneda?` (`MXN | USD`), `fecha_factura?`;
  - `vencimiento?`: en un alta, default = fecha + plazo del proveedor;
  - `notas?`: `""` las borra;
  - `estado?`: `pendiente | pagada | cancelada`;
  - `fecha_pago?`: YYYY-MM-DD, junto con `pagada`; sobre una pagada, corrige la fecha;
  - `quitar?: true`;
  - `confirmar?: true`.
- **Reglas** (en `payables-store.ts`, compartidas con las rutas donde aplican):
  - Resolución con `resolvePayable`, prefiriendo un estado según la acción:
    - `pagada` → pendientes;
    - `cancelada` → pendientes;
    - `pendiente` → pagadas y canceladas;
    - `quitar` → sin preferencia, y se recomienda el UUID que da `list_payables`.
  - Un alta nace `pending` (regla del POST). Si se permite `estado: 'pagada'` en el alta (pregunta 4), se hacen **dos escrituras**, insert `pending` y luego update a `paid`, para que el trigger registre el `status_changed` del que sale "Pagada por". No son atómicas.
  - `pagada` sobre una pagada sin `fecha_pago` → error, para no re-sellar hoy (#100).
  - `cancelada` sobre una pagada → error: primero se regresa a pendiente (ADR-037).
  - `pendiente` sobre una cancelada → **reactivar**. Hoy solo se puede en la app.
  - `quitar` sobre una pagada → rechazado (pregunta 3); sobre una pendiente o cancelada, solo con `confirmar`.
- **Patrón de confirmación:**
  - directo para alta, pago, cancelación, reactivación y correcciones de una pendiente;
  - **`confirmar: true`** para `quitar` y para cambios de monto, moneda, proveedor o fechas sobre una **pagada**. Sin él, la tool devuelve el resumen (la factura, su estado, qué cambia o qué se borra) y no escribe.
- **`adminOnly`:** sí, por la decisión de #155. Ver la pregunta 1: hoy las tres tools las recibe un member, y Finanzas es una pantalla de todos.
  - Si queda `adminOnly`, la respuesta ya puede decir "queda en el historial".
  - Si la recibe un member, sigue sin mencionar la bitácora (ADR-028).
- **Refactor** previo, en `src/lib/payables-store.ts`:
  - `parsePayableInsert()`: la validación del POST, hoy inline y copiada en la tool;
  - `createPayable(db, input)`: chequeo de proveedor + insert;
  - `updatePayable(db, id, updates)`: chequeo de proveedor + update + 404;
  - `deletePayable(db, id)`: con 404, porque hoy responde ok aunque no exista;
  - las guardas de transición de las tools, en un helper puro (`assertPayableTransition(current, next)`) dentro de `payables.ts`.

  `POST /api/payables` y `PATCH`/`DELETE /api/payables/[id]` pasan a llamar al store.
- **Costo:** 1 tool en lugar de 3 → **libera 2 lugares** del presupuesto de la app (36/36). Hoy el registro de las tres en `server.ts` ocupa unos 3,900 caracteres de código; se estima que `save_payable` quede entre 1,800 y 2,000 (descripción de ~900 más 13 parámetros). Hay que medirlo con `tests/mcp/manifest.test.ts`.
- **Lo que rompe:** desaparecen tres nombres, así que hay que reconectar el conector (precedente: ADR-037). Las instrucciones del servidor y el manifiesto (la sección Asistente de la doc in-app y `/oauth/consent`) se regeneran solos desde la lista nueva.

### Opción B (sin renombrar)

Las tres tools se quedan. `update_payable` gana `reactivar: true` (o `estado`) y `quitar: true` + `confirmar`; `mark_payable_paid` no cambia.
- Ventaja: 0 tools nuevas y sin reconectar.
- Desventaja: no libera presupuesto, y la excepción de ADR-037 sigue viva.

### Rutas de refresco

- `POST /api/finance/income/refresh` → **fuera**. Si hace falta "con lo último de Odoo", `get_month_closing` puede ganar `fresco?: true`: lee `loadIncomeFresh(month)` **sin purgar** (lectura pura, sin efecto en la caché, dentro de `withinBudget`). Costo: 0 tools.
- `POST /api/clients/refresh` → **fuera**. Ninguna tool usa la caché de Clientes: `odoo_overdue_invoices` y `odoo_customer_profile` leen Odoo en vivo.

**Total del módulo:**
- Opción A: 1 tool nueva (`save_payable`) que reemplaza 3, neto **−2**.
- Opción B: 0 tools nuevas.

## Fuera a propósito

- `POST /api/finance/income/refresh` y `POST /api/clients/refresh`: purgan una caché del servidor, no escriben datos de negocio. El MCP solo depende de esa caché en `get_month_closing`, y ahí basta un `fresco` de lectura.
- Escribir en `audit_events`: solo lo hace el trigger DEFINER (ADR-028); `authenticated` no tiene INSERT.
- Convertir monedas: nunca. Cada factura conserva la suya y los totales se separan por moneda.
- Cancelar una pagada en un solo paso: se queda en dos pasos a propósito, para que nadie pierda `paid_at` sin darse cuenta.

## Preguntas abiertas

1. ¿La escritura de facturas pasa a `adminOnly`? Hoy un member registra, corrige y paga facturas por el MCP, igual que en la app. Con `adminOnly`, "ya pagué la de Perfiles" deja de funcionar para él. Además, como la RLS de `payables` es `USING (true)`, `adminOnly` sería solo una barrera del MCP.
2. ¿Opción A (fusionar en `save_payable`, libera 2 lugares y obliga a reconectar) u opción B (extender `update_payable`)?
3. Borrar por el MCP: ¿sí? ¿Y también una pagada? Propuesta: solo pendientes y canceladas, con `confirmar`.
4. ¿Registrar una factura ya pagada en una sola llamada? Implica dos escrituras no atómicas para conservar el evento "Pagada por".
5. Corregir monto o moneda de una pagada: ¿se permite con `confirmar` o se bloquea? ¿Se amplía el trigger `audit_payable` para auditar monto, moneda, fechas y proveedor? Eso es un cambio de esquema; hoy dice "not audited (yet)", y sus snapshots `created`/`deleted` tampoco guardan `currency`.
6. ¿La ruta `PATCH` adopta las guardas de transición de la tool? Hoy permite pasar de pagada a cancelada en un paso, y un `paid_at` suelto sobre una pendiente.
7. ¿Se agrega `fresco: true` a `get_month_closing`, o basta la caché de 15 min?
8. ¿Se valida `due_date >= invoice_date` en el store? Hoy ninguna capa lo revisa.
