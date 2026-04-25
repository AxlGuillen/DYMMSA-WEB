# Fase 4: Inventario Tienda ✅

> **Módulo:** [[03-Modulos/Inventario]] · **Tabla:** [[02-Arquitectura/Base-de-Datos#store_inventory|store_inventory]]

**Estado:** Completada

## Qué se hizo

- Tabla `store_inventory` en Supabase (195 filas actuales).
- CRUD: `InventoryTable`, `InventoryForm`.
- Importación desde Excel URREA: `InventoryImporter` + `POST /api/inventory/import`.
  - Formato especial: `skiprows=13` (Excel de URREA tiene 13 filas de header).
- Hook `useInventory.ts`.
- Sort por cantidad, resaltado de filas, fechas relativas.
- Página `/dashboard/inventory`.
