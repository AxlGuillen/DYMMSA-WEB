# Módulo: Órdenes

> **Pipeline:** [[03-Modulos/Cotizador|Cotizador]] → [[03-Modulos/Aprobacion-por-Token|Aprobación]] → Órdenes  
> **Tablas:** [[02-Arquitectura/Base-de-Datos#orders|orders]], [[02-Arquitectura/Base-de-Datos#order_items|order_items]]  
> **Inventario:** [[03-Modulos/Inventario]] · **Separadores:** [[04-Decisiones-Tecnicas/ADR-001-Separadores]] · **sort_order:** [[04-Decisiones-Tecnicas/ADR-003-sort_order]]  
> **Estados:** [[00-Inicio/Glosario#Estados de orden (orders.status)]]

## Propósito

Gestionar el ciclo de vida completo de una orden de venta: desde la generación hasta la entrega y cobro.

## Estados de la orden

```
ordered ──→ received ──→ delivered ──→ completed
   │                                       
   └──→ cancelled (en cualquier estado no terminal)
```

> Migración `20260409055423` renombró los estados a estos nombres genéricos.  
> Ver [[00-Inicio/Glosario#Estados de orden]] para descripción de cada estado.

## Crear orden desde cotización

**Ruta:** `POST /api/quotations/[id]/create-order`

1. Verifica que la cotización existe, pertenece al usuario y está en estado `approved`.
2. Filtra ítems: solo `is_approved = true` + preserva separadores en su posición.
3. Por cada ítem de producto con `model_code`:
   - Consulta `store_inventory` por `model_code`.
   - `quantity_in_stock = min(quantity_approved, stock_disponible)`.
   - `quantity_to_order = quantity_approved - quantity_in_stock`.
   - Registra la deducción de inventario para aplicar al final.
4. Crea `orders` (status: `ordered`, `quotation_id` → FK).
5. Inserta `order_items` con `sort_order` preservado.
6. Aplica deducciones al `store_inventory`.
7. Actualiza `quotations.status` → `converted_to_order`.
8. Rollback: si falla inserción de ítems → elimina la orden.

## Generar Excel URREA

**Ruta generada desde:** `OrderDetail` (componente)  
**Librería:** ExcelJS (`src/lib/excel/generator.ts`)

Criterios de inclusión:
- `item_type = 'product'`
- `brand = 'URREA'` (case insensitive)
- `quantity_to_order > 0`

Columnas del Excel: `model_code` | `quantity_to_order`

Productos de otras marcas se excluyen con notificación al usuario.

## Edición de ítems de orden

Disponible mientras la orden no esté `completed` ni `cancelled`.

| Operación | Ruta | Efecto en inventario |
|-----------|------|---------------------|
| Agregar ítem | `POST /api/orders/[id]/items` | Deduce stock disponible |
| Editar precio | `PATCH /api/orders/[id]/items/[itemId]` | Recalcula `total_amount` |
| Eliminar ítem | `DELETE /api/orders/[id]/items/[itemId]` | Restaura `quantity_in_stock` |

## Confirmar recepción

**Ruta:** `POST /api/orders/[id]/confirm-reception`

- Input: `{ items: [{ id, quantity_received, urrea_status }] }`
- SUMA `quantity_received` a `store_inventory` por `model_code`.
- Actualiza `urrea_status` de cada ítem.
- Cambia status orden → `received`.

## Cancelar orden

**Ruta:** `POST /api/orders/[id]/cancel`

- Solo cancela si la orden no está ya `completed` o `cancelled`.
- Restaura `quantity_in_stock` de cada ítem al inventario.
- Status → `cancelled`.

## Componentes

| Componente | Ruta | Rol |
|-----------|------|-----|
| `OrdersTable` | `src/components/orders/OrdersTable.tsx` | Lista con filtros, stats cards, fechas relativas |
| `OrderDetail` | `src/components/orders/OrderDetail.tsx` | Vista completa: header, tabla ítems, acciones |
| `OrderStatusBadge` | `src/components/orders/OrderStatusBadge.tsx` | Badge con punto de color por estado |

## Hooks

- `useOrders.ts`: `useOrders()`, `useOrder(id)`, `useAddOrderItem()`, `useEditOrderItem()`, `useRemoveOrderItem()`, `useConfirmReception()`, `useCancelOrder()`

## Archivos relevantes

- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/orders/[id]/page.tsx`
- `src/components/orders/OrderDetail.tsx`
- `src/lib/excel/generator.ts`
- `src/app/api/orders/` (todas las rutas)
- `src/hooks/useOrders.ts`
