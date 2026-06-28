# Glosario DYMMSA

> Índice completo: [[00-Inicio/README|README]] · Flujo donde se usan estos conceptos: [[01-Negocio/Flujo-Operacional]]

## Códigos de producto

| Término | Definición | Ver |
|---------|-----------|-----|
| **ETM** | Código genérico del cliente para identificar un producto. Es el identificador primario en el sistema. Ejemplo: `ETM-12345`. Único en `etm_products`. | [[03-Modulos/Catalogo-ETM]] |
| **model_code** | Código URREA del producto (ej. `7420MT`, `COP24P`). Se usa para cotizar a URREA y para vincular con `store_inventory`. | [[03-Modulos/Inventario]] |
| **DYMMSA-{n}** | Código temporal asignado a productos que llegan sin ETM en el Excel del cliente. Se genera secuencialmente via `GET /api/products/next-dymmsa-code`. | [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]] |
| **URREA** | Proveedor mayorista. Cuando `brand = 'URREA'` y `quantity_to_order > 0`, el ítem se incluye en el Excel de pedido a URREA. | [[03-Modulos/Ordenes#Generar Excel URREA]] |

---

## Estados de cotización (`quotations.status`)

| Estado | Descripción |
|--------|-------------|
| `draft` | En edición. DYMMSA puede modificar todos los campos. |
| `sent_for_approval` | Link enviado al cliente. Editable por DYMMSA (`canEdit` lo incluye, Fase 5.5). |
| `approved` | Al menos un ítem aprobado por el cliente. DYMMSA puede seguir editando (Fase 5.5). |
| `rejected` | Todos los ítems rechazados por el cliente. |
| `converted_to_order` | Orden generada desde esta cotización. **Reversible** eliminando la orden (ver abajo). |

> **Cambio manual de estado** (Fase 6, [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]):
> desde `QuotationDetail` un dropdown mueve la cotización libremente entre los 4 estados
> no terminales (`PATCH /api/quotations/[id]/status`). `converted_to_order` no es destino
> manual; para **reabrir** una convertida hay que **eliminar** su orden primero. Cada
> cambio de estado **regenera `approval_token`** (mata el link viejo). `is_approved` se
> preserva en todos los estados.

---

## Estados de orden (`orders.status`)

| Estado | Descripción |
|--------|-------------|
| `ordered` | Estado inicial. Orden creada, pendiente de enviar a URREA. |
| `received` | Productos recibidos de URREA. |
| `delivered` | Productos entregados al cliente. |
| `completed` | Orden completamente finalizada. Estado terminal. |
| `cancelled` | Orden cancelada. Restaura inventario deducido. Estado terminal. |

> ⚠️ Migración `20260409055423` renombró los estados viejos (`pending_urrea_order`, `received_from_urrea`, etc.) a estos nombres genéricos.

---

## Estados URREA por ítem (`order_items.urrea_status`)

| Estado | Descripción |
|--------|-------------|
| `pending` | Aún no surtido por URREA. |
| `supplied` | URREA surtió el producto. |
| `not_supplied` | URREA no pudo surtir. |

---

## Tiempos de entrega (`delivery_time`)

Aplica a `quotation_items.delivery_time` y `order_items.delivery_time`.

| Valor | Descripción |
|-------|-------------|
| `immediate` | Entrega inmediata (stock en tienda) |
| `2_3_days` | 2 a 3 días |
| `3_5_days` | 3 a 5 días |
| `1_week` | 1 semana |
| `2_weeks` | 2 semanas |
| `indefinite` | Sin fecha definida |

---

## Conceptos clave

| Término | Definición | Ver |
|---------|-----------|-----|
| **approval_token** | UUID v4 único por cotización. Se incluye en la URL pública de aprobación `/approve/[token]`. Accesible sin login. **Se regenera en cada cambio manual de estado** → el link compartido previamente queda muerto (404). | [[03-Modulos/Aprobacion-por-Token#Seguridad y acceso]] |
| **auto-learn** | Al guardar cotización: ETMs nuevos se insertan en `etm_products`, existentes se actualizan si los datos cambiaron. | [[03-Modulos/Catalogo-ETM#Auto-learn (automático al guardar cotización)]] |
| **separator** | Fila de tipo `item_type = 'separator'` que divide visualmente productos en secciones. No se incluye en totales, auto-learn, Excel URREA ni decisiones de aprobación. | [[04-Decisiones-Tecnicas/ADR-001-Separadores]] |
| **sort_order** | Entero que preserva el orden de ítems en `quotation_items` y `order_items`. Los separadores mantienen su posición relativa al crear la orden. | [[04-Decisiones-Tecnicas/ADR-003-sort_order]] |
| **stock check** | Al crear orden, se verifica `store_inventory` por `model_code`. Se aparta el stock disponible (`quantity_in_stock`) y se pide el resto a URREA (`quantity_to_order`). | [[03-Modulos/Ordenes#Crear orden desde cotización]] |
| **inventory deduction** | Al crear orden: se resta `quantity_in_stock` del inventario inmediatamente. Al cancelar: se restaura. Al confirmar recepción: se suma `quantity_received`. | [[03-Modulos/Inventario#Movimientos automáticos de inventario]] |
| **RLS** | Row Level Security de Supabase. Todas las tablas tienen RLS habilitado. Las tablas de datos requieren usuario autenticado; la aprobación por token usa `approval_token` como semáforo público. | [[02-Arquitectura/Base-de-Datos]] |
