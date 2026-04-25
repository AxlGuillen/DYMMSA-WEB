# Fase 2: Catálogo de Productos ETM ✅

> **Módulo:** [[03-Modulos/Catalogo-ETM]] · **Tabla:** [[02-Arquitectura/Base-de-Datos#etm_products|etm_products]]

**Estado:** Completada

## Qué se hizo

- Tabla `etm_products` en Supabase (564 filas actuales).
- CRUD completo: `ProductsTable`, `ProductForm`.
- Importación masiva desde Excel: `ExcelImporter` + `POST /api/products/import`.
- Hook `useProducts.ts`.
- Ordenamiento por columnas en la tabla.
- Página `/dashboard/db`.
