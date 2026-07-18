# Módulo: Inventario

> **Tabla:** [[02-Arquitectura/Base-de-Datos#store_inventory|store_inventory]]  
> **Consumido por:** [[03-Modulos/Ordenes#Crear orden desde cotización|Órdenes (stock check y deducción)]]  
> **Por qué se deduce al crear:** [[01-Negocio/Decisiones-de-Negocio#Por qué deducir inventario al crear la orden]]

## Propósito

Gestionar el stock físico de la tienda DYMMSA. Es la fuente de verdad para el stock check al crear órdenes.

## Tabla: `store_inventory` (195 filas actuales)

Ver esquema en [[02-Arquitectura/Base-de-Datos#store_inventory]].

Clave: `model_code` (UNIQUE) + `quantity` (integer, >= 0) + `location` (text, opcional — gaveta).

### Ubicación (`location`)
Texto libre para identificar dónde se guarda físicamente el producto en la tienda (gaveta/código
de estante), y así recolectarlo o verificar existencia más rápido.

- **Metadato duradero, no transaccional:** el conteo es efímero, la ubicación no. **Nunca se borra
  automáticamente**; solo se **oculta en el frontend cuando `quantity=0`** (fila por fila). Así, al
  cancelar una orden (que restaura stock) o reabastecer, la gaveta sigue ahí sin recapturar.
- Se **fotografía** (snapshot) en `order_items.location` al crear la orden → la orden muestra la
  columna "Ubicación" solo en ítems con `quantity_in_stock > 0` (lo que se recolecta de la tienda).

## Funcionalidades

### CRUD manual
- `InventoryTable` — listado con sort por cantidad, resaltado de filas de stock bajo, fechas relativas.
  Columna **Ubicación** visible solo cuando hay stock.
- `InventoryForm` — crear/editar entrada de inventario por model_code, con input de **Ubicación**.

### Importación desde Excel
- Ruta: `POST /api/inventory/import`
- Componente: `InventoryImporter`
- Formato especial: `skiprows=13` (el Excel de URREA tiene 13 filas de header antes de los datos).
- Columnas: `MODEL_CODE` + `QUANTITY` + opcional **`ubicacion`** (alias `ubicación`/`location`/`gaveta`,
  case-insensitive).
- Upsert por model_code. **Regla:** en upsert, si el archivo no trae `ubicacion`, **no se pisa** la
  existente (una carga de solo cantidades no borra las gavetas).

## Movimientos automáticos de inventario

| Evento | Operación | Quién lo ejecuta |
|--------|-----------|-----------------|
| Crear orden desde cotización | RESTA `quantity_in_stock` | `POST /api/quotations/[id]/create-order` |
| Agregar ítem a orden existente | RESTA stock disponible | `POST /api/orders/[id]/items` |
| Eliminar ítem de orden | RESTAURA `quantity_in_stock` | `DELETE /api/orders/[id]/items/[itemId]` |
| Confirmar recepción de URREA | SUMA solo el **excedente** (`max(0, recibido − pedido)`), por **delta** — re-confirmar es idempotente, corregir a la baja resta (clamp en 0) | `POST /api/orders/[id]/confirm-reception` |
| Cancelar orden | RESTAURA `in_stock + min(recibido, pedido)` — el excedente NO se re-suma (ya entró en la recepción, ADR-019) | `POST /api/orders/[id]/cancel` |

## Archivos relevantes

- `src/app/dashboard/inventory/page.tsx`
- `src/components/inventory/InventoryTable.tsx`
- `src/components/inventory/InventoryForm.tsx`
- `src/components/inventory/InventoryImporter.tsx`
- `src/hooks/useInventory.ts`
- `src/app/api/inventory/import/route.ts`
