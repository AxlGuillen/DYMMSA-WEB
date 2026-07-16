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

## Planificar compra (mayoreo vs menudeo)

**Vista:** `/dashboard/orders/[id]/planner` (`PurchasePlanner`) · ADR: [[04-Decisiones-Tecnicas/ADR-018-Mayoreo-vs-Menudeo]]

Clasifica lo que hay que pedir (`quantity_to_order > 0`) consolidando duplicados
por `catalogKey(model_code, brand)`:

| Bucket | Criterio | Tratamiento |
|--------|----------|-------------|
| URREA | En `urrea_catalog` con precio | Math STD + recomendación |
| Sin precio | En catálogo, todas las líneas con precio 0 | Solo regla de % |
| Compra local | No cruza con el catálogo | Lista local, sin math |

Por grupo: `floor(N/STD)` paquetes + resto; la recomendación decide el **resto**
(dinero parado > $100 → menudeo; % parado ≥ 80% → revisar; si no → redondear).
El usuario elige Mayoreo/Mixto/Menudeo por grupo y **guarda** (replace-all,
`PUT /api/orders/[id]/purchase-decisions`). Decisiones con `needed_qty` o STD
distintos a los actuales se marcan **desactualizadas** (⟳). Umbrales editables
en un popover (tabla `app_settings`).

## Generar Excel URREA

**Ruta generada desde:** `OrderDetail` (componente)
**Librería:** SheetJS + JSZip (`src/lib/excel/generator.ts`, template .xlsm con macros)

Se genera desde las **decisiones de mayoreo guardadas** del planificador:
- Filas: decisiones con `packages_wholesale > 0`
- Piezas = `packages_wholesale × std_snapshot` (múltiplos exactos de STD)
- Criterio de "pedible a URREA" = **pertenencia al catálogo** (cualquier línea:
  URREA/SURTEK/FOY...), ya **no** `brand='URREA'`

Sin decisiones guardadas → el botón redirige al planificador. Con decisiones
desactualizadas → AlertDialog de aviso. Máximo 1012 filas (fórmulas del
template). La contraparte es **Exportar compra local** (restos a menudeo +
productos sin catálogo) desde el planificador.

## Edición de ítems de orden

Disponible mientras la orden no esté `completed` ni `cancelled`.

| Operación | Ruta | Efecto en inventario |
|-----------|------|---------------------|
| Agregar ítem | `POST /api/orders/[id]/items` | Deduce stock disponible |
| Editar precio | `PATCH /api/orders/[id]/items/[itemId]` | Recalcula `total_amount` |
| Eliminar ítem | `DELETE /api/orders/[id]/items/[itemId]` | Restaura `quantity_in_stock` |

## Confirmar recepción

**Ruta:** `POST /api/orders/[id]/confirm-reception` · ADR: [[04-Decisiones-Tecnicas/ADR-019-Recepcion-Excedente]]

- Input: `{ items: [{ id, quantity_received, urrea_status }] }` (`quantity_received`
  entero ≥ 0; **puede superar lo pedido** — el CHECK se eliminó).
- Inventario: entra **solo el excedente** (`max(0, recibido − pedido)`), ajustado
  por **delta** contra lo persistido → re-confirmar es idempotente, corregir a la
  baja resta (clamp en 0 con warning). Recibir ≤ lo pedido no mueve inventario.
- El excedente **no se factura**: el total recalculado usa `min(recibido, pedido)`.
- Respuesta: `{ success, inventory_updated, warnings[] }` — la UI toastea los warnings.
- En la UI, el botón abre un **resumen anti-dedazo** (pedido/recibido/efecto en
  inventario, ⚠️ si recibido > 2× pedido) antes de ejecutar.
- El status de la orden se cambia aparte (dropdown → `received`).

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
| `PurchasePlanner` | `src/components/orders/PurchasePlanner.tsx` | Planificador mayoreo/menudeo (ADR-018) |
| `OrderStatusBadge` | `src/components/orders/OrderStatusBadge.tsx` | Badge con punto de color por estado |

## Hooks

- `useOrders.ts`: `useOrders()`, `useOrder(id)`, `useAddOrderItem()`, `useEditOrderItem()`, `useRemoveOrderItem()`, `useConfirmReception()`, `useCancelOrder()`
- `usePurchasePlan.ts`: `usePurchasePlan(orderId)` (key anidada bajo `['orders', id]` → se invalida con las mutaciones de ítems), `useSavePurchaseDecisions(orderId)`
- `useSettings.ts`: `useUpdateSettings()` (umbrales del planificador; invalida `['orders']` para re-puntuar planes)

## Archivos relevantes

- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/orders/[id]/page.tsx`
- `src/components/orders/OrderDetail.tsx`
- `src/lib/excel/generator.ts`
- `src/app/api/orders/` (todas las rutas)
- `src/hooks/useOrders.ts`
