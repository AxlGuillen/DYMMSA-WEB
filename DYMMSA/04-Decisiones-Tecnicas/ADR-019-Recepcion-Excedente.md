# ADR-019 — Recepción con excedente: solo el excedente entra a inventario

**Fecha:** 2026-07-16
**Estado:** Implementado
**Issue:** #19

## Contexto

Al confirmar recepción de URREA puede llegar más producto del pedido (llegaron
10, la orden pedía 2). El CHECK `check_received_not_exceed_ordered` lo
bloqueaba por completo, y el modelo de inventario tenía **doble conteo**:

1. La recepción sumaba **todo** lo recibido a `store_inventory` (no solo el
   excedente) — y nada lo descontaba al entregar al cliente.
2. Cancelar una orden ya recibida volvía a sumar `in_stock + received` → lo
   recibido se contaba dos veces.
3. Re-confirmar recepción (corregir números) re-sumaba el absoluto.

## Decisión

**Modelo "solo excedente"**: lo pedido es del cliente y nunca pisa el
inventario; solo el excedente es stock de tienda.

```
excedente            = max(0, recibido − pedido)      → receptionExcess()
porción del cliente  = min(recibido, pedido)          → receivedForCustomer()
```

### Reglas

1. **Recepción** (`POST /api/orders/[id]/confirm-reception`): el inventario se
   ajusta por **DELTA de excedente** (`excedente nuevo − excedente persistido`,
   leído ANTES de escribir). Consecuencias:
   - Recibir ≤ lo pedido → **cero movimiento** de inventario (lo del cliente
     no es stock).
   - Re-confirmar con los mismos números → delta 0 → **idempotente**.
   - Corregir a la baja → delta negativo → resta; si el stock ya se movió y
     quedaría negativo, **clamp en 0 + warning** (respuesta `warnings[]`,
     la UI los toastea). Corrección sin fila de inventario → warning, sin write.
2. **Cobro/entrega**: el excedente NUNCA se factura ni se entrega —
   `calculateDeliveredTotal`, el total de línea de la UI y el Excel de entrega
   usan `receivedForCustomer()`. La aprobación ya fijó qué compra el cliente.
3. **Cancelar/eliminar orden** (`computeRestoration`): restaura
   `in_stock + min(recibido, pedido)` — la mercancía del cliente que ya llegó
   se queda en tienda; el excedente **no se re-suma** (ya entró en la
   recepción). Fin del doble conteo. Cancelar (`/cancel`) restaura siempre
   que procede; desde 2026-10-17 eliminar restaura **solo** si la orden sigue
   en tienda (`ordered`/`received`, `deleteRestoresStock()`): una cancelada
   ya lo devolvió y una entregada/completada ya salió con el cliente
   ([[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]).
4. **UI anti-dedazo**: sin tope en el input (el punto es permitir excedente),
   pero "Confirmar Recepción" abre un **resumen** (pedido/recibido/efecto en
   inventario por ítem, filas ámbar con excedente, ⚠️ cuando recibido > 2×
   pedido) y la mutación solo corre tras confirmar. Hint `+N a tienda` en la
   fila.
5. **BD**: migración `allow_received_to_exceed_ordered` elimina el CHECK;
   `quantity_received >= 0` se conserva como backstop. El case correspondiente
   en `explainPgError` se eliminó (muerto).

## Datos legacy (aceptado, no se corrige)

Las recepciones confirmadas ANTES de este cambio sumaron el recibido completo
al inventario. Esas órdenes viejas, si se cancelan hoy, restaurarán
`in_stock + min(recibido, pedido)` — que para ellas equivale a `in_stock +
recibido` (el CHECK viejo garantizaba `recibido ≤ pedido`), es decir, siguen
duplicando lo recibido. Decisión explícita del usuario: no tocar órdenes
existentes; el modelo corregido aplica hacia adelante.

## Limitaciones conocidas

- **Carrera read-modify-write** en `store_inventory`: el loop es secuencial
  dentro de un request, pero dos requests simultáneos pueden pisarse (igual
  que `restoreOrderInventory`). Un RPC `quantity = quantity + delta` lo
  arreglaría — fuera de alcance con un solo usuario operando.
  **Resuelto el 2026-10-23 (#157):** la recepción entera es una transacción
  (`receive_order_items()`): bloquea la orden, escribe lo recibido y aplica el
  delta del excedente con bloqueo de fila, o no escribe nada. Crear, cancelar,
  eliminar y quitar líneas usan `reserve_inventory()`/`release_inventory()` y
  sus variantes transaccionales (ver [[02-Arquitectura/Base-de-Datos]]).
- **`not_supplied` con `recibido > 0`**: la facturación lo ignora (regla
  existente) pero el excedente SÍ entra a inventario (el cálculo es
  independiente del status — piezas físicas son piezas físicas). El Excel de
  entrega ignora el status para lo recibido (divergencia preexistente con
  `calculateDeliveredTotal`; datos contradictorios que no deberían ocurrir).
- **Si algún día las cantidades de `order_items` se vuelven editables
  post-recepción**, el modelo de delta debe revisarse (el excedente persistido
  se calcula de `quantity_to_order` actual).

## Piezas

Helpers `receivedForCustomer()`/`receptionExcess()` en `business-rules.ts` ·
route `confirm-reception` (delta + warnings, `ConfirmReceptionResult`) ·
`computeRestoration` topada · Excel de entrega topado · UI con resumen de
confirmación. ~26 tests nuevos (598 total).

## Adenda 2026-10-15 — Surtido automático y resumen legible (#146)

- **Al capturar**, recibido ≥ pedido pasa la línea a **Surtido** (`statusAfterReceived()` en `business-rules.ts`). Si después se baja por debajo de lo pedido, regresa al estado que tenía, **solo si el cambio fue automático**: un Surtido elegido a mano no se toca. Una recepción parcial no cambia el estado. Las líneas sin pedido a URREA no se editan. Decisión del 2026-10-15.
- El cambio vive en la captura (la tabla), no en la ruta: el usuario lo ve y lo puede corregir antes de confirmar. A la API solo viajan `id`, `quantity_received` y `urrea_status`.
- El resumen de "Confirmar recepción" muestra **código URREA** y **descripción** en vez del ETM, porque quien recibe la mercancía reconoce eso. Una línea sin código URREA (captura manual) conserva el ETM como identificador.
- **Review del PR #147:** un estado elegido a mano en la captura es **pegajoso** (`manual`): la cantidad ya no lo cambia, ni para subir ni para bajar. `autoFrom` y `manual` viven solo en la captura: en una recepción posterior la base sale de lo guardado, así que un Surtido de la recepción anterior se trata como del usuario y bajar la cantidad ya no lo regresa. Es a propósito, no un bug.
