# Módulo: Catálogo URREA

> **Sidebar:** sección **URREA → Catálogo** (`/dashboard/urrea/catalog`)
> **Tabla:** [[02-Arquitectura/Base-de-Datos#urrea_catalog|urrea_catalog]] (aislada)
> **Decisión:** [[06-Changelog/2026-06]] · Creado 2026-06-16

## Propósito

Registrar el **catálogo de URREA** dentro de la app: el código URREA (equivalente al
`model_code` que asociamos a un ETM), la descripción de URREA (más completa que la del ETM),
el **STD** (unidades por paquete; p. ej. tornillos vendidos de a 6 → std = 6) y el **precio
de catálogo** (informativo).

## Estado: aislado (sin relaciones)

La tabla `urrea_catalog` es **independiente**: no tiene FK ni la consume ningún flujo de
cotización/orden/ETM. La BD es compartida entre stg y prod, pero al ser aislada **no afecta
producción**; el módulo (UI) vive en `stg` hasta que se decida desplegarlo. Las relaciones
(auto-completar `model_code`, traer descripción/precio, sugerir STD, etc.) son fase posterior.

## Funcionalidad

- **Tabla** con columnas Código · Descripción · STD · Precio · Última actualización · Acciones.
  Orden por columnas (código, descripción, precio, std). Precio respeta el Modo Discreto
  (`useCurrency`). Búsqueda por código o descripción. Paginación (20/pág).
- **CRUD manual** (`CatalogForm`): alta/edición/borrado de productos individuales.
- **Import Excel** (`CatalogImporter`): columnas `codigo, descripcion, std, precio`
  (case-insensitive; acepta inglés). Dos modos:
  - **Actualizar o agregar** (`upsert` por `code`, en lote).
  - **Reemplazar todo** (borra el catálogo actual e inserta el archivo).

## Componentes y código

| Pieza | Ruta |
|-------|------|
| Página | `src/app/dashboard/urrea/catalog/page.tsx` |
| Tabla | `src/components/urrea-catalog/CatalogTable.tsx` |
| Formulario | `src/components/urrea-catalog/CatalogForm.tsx` |
| Importador | `src/components/urrea-catalog/CatalogImporter.tsx` |
| Hook | `src/hooks/useUrreaCatalog.ts` |
| Ruta import | `src/app/api/urrea-catalog/import/route.ts` |
| Tipos | `UrreaCatalogItem` en `src/types/database.ts` |

## Tests

`tests/api/urrea-catalog.test.ts` (+6): validación de archivo/columnas, upsert onConflict `code`,
replace (delete+insert), parseo de `std` (default 1) y `precio` (null), encabezados en español.
