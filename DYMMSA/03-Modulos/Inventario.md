# Módulo: Inventario

> **Tabla:** [[02-Arquitectura/Base-de-Datos#store_inventory|store_inventory]]  
> **Consumido por:** [[03-Modulos/Ordenes#Crear orden desde cotización|Órdenes (stock check y deducción)]]  
> **Por qué se deduce al crear:** [[01-Negocio/Decisiones-de-Negocio#Por qué deducir inventario al crear la orden]]

## Propósito

Gestionar el stock físico de la tienda DYMMSA. Es la fuente de verdad para el stock check al crear órdenes.

## Tabla: `store_inventory` (195 filas actuales)

Ver esquema en [[02-Arquitectura/Base-de-Datos#store_inventory]].

Clave: `model_code` (UNIQUE) + `quantity` (integer, >= 0).

## Funcionalidades

### CRUD manual
- `InventoryTable` — listado con sort por cantidad, resaltado de filas de stock bajo, fechas relativas.
- `InventoryForm` — crear/editar entrada de inventario por model_code.

### Importación desde Excel
- Ruta: `POST /api/inventory/import`
- Componente: `InventoryImporter`
- Formato especial: `skiprows=13` (el Excel de URREA tiene 13 filas de header antes de los datos).
- Columnas: `model_code` + `quantity`.
- Upsert por model_code.

## Movimientos automáticos de inventario

| Evento | Operación | Quién lo ejecuta |
|--------|-----------|-----------------|
| Crear orden desde cotización | RESTA `quantity_in_stock` | `POST /api/quotations/[id]/create-order` |
| Agregar ítem a orden existente | RESTA stock disponible | `POST /api/orders/[id]/items` |
| Eliminar ítem de orden | RESTAURA `quantity_in_stock` | `DELETE /api/orders/[id]/items/[itemId]` |
| Confirmar recepción de URREA | SUMA `quantity_received` | `POST /api/orders/[id]/confirm-reception` |
| Cancelar orden | RESTAURA `quantity_in_stock` de todos los ítems | `POST /api/orders/[id]/cancel` |

## Archivos relevantes

- `src/app/dashboard/inventory/page.tsx`
- `src/components/inventory/InventoryTable.tsx`
- `src/components/inventory/InventoryForm.tsx`
- `src/components/inventory/InventoryImporter.tsx`
- `src/hooks/useInventory.ts`
- `src/app/api/inventory/import/route.ts`
