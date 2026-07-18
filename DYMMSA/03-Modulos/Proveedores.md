# Módulo: Proveedores (menudeo)

> **Tablas:** `suppliers`, `brands`, `supplier_brands` (ver [[02-Arquitectura/Base-de-Datos]])
> **Issue:** #21 · **Relación futura:** [[04-Decisiones-Tecnicas/ADR-018-Mayoreo-vs-Menudeo|planificador de compra]] (compra local)

## Propósito

Registrar los proveedores locales de **menudeo** (contacto + marcas que maneja cada uno).
Cuando el planificador de compra manda parte del pedido a menudeo, este módulo dice a quién
comprárselo. **Standalone por ahora** — la identificación automática de proveedor para la
lista de compra local será una issue de conexión aparte.

## Modelo

| Tabla | Rol |
|---|---|
| `suppliers` | Contacto: `name` (UNIQUE), `phone`, `whatsapp`, `email`, `address`, `notes` |
| `brands` | Catálogo **global** de marcas (submódulo). `name` UNIQUE **normalizado trim+upper** |
| `supplier_brands` | M2M. `supplier_id` CASCADE; `brand_id` **sin cascade** |

### Reglas

- **Marcas normalizadas** (`normalizeBrandTag()` en `business-rules.ts`: trim+upper SIN el
  default 'URREA' de `normalizeCatalogBrand`). Mismo criterio que las marcas de
  `etm_products`/`urrea_catalog` → en el futuro cruzan **por valor** con los productos
  (ej. "¿qué proveedores manejan la marca de este ítem de menudeo?").
- **Seed inicial**: la migración sembró `brands` con las ~42 marcas únicas ya existentes en
  `etm_products` + `urrea_catalog`.
- **Eliminar una marca en uso se BLOQUEA** (FK sin cascade + pre-check con mensaje de cuántos
  proveedores la tienen). Primero desasignar. Eliminar un proveedor sí desliga sus marcas
  (CASCADE) sin tocar el catálogo de marcas.
- **Rollback**: si al crear un proveedor fallan los links de marcas, se elimina el proveedor
  (regla general del proyecto — sin registros padre a medias).
- **PATCH de marcas por DIFF**: al editar, se insertan solo las nuevas y se borran solo las
  removidas — nunca hay ventana sin links.

## UI

- **`/dashboard/proveedores`** (sidebar: DYMMSA → Proveedores, icono Truck): búsqueda
  (nombre/teléfonos/correo), filtro por marca con conteos, `ColumnPicker` (issue #18,
  tableId `suppliers`), paginación y orden por nombre/actualización.
- **WhatsApp como link `wa.me`**: click abre el chat (números de 10 dígitos se prefijan con 52).
- **`SupplierForm`**: diálogo crear/editar con picker de marcas (checkbox-dropdown que no se
  cierra al togglear) + **crear marca al vuelo** (se crea normalizada y queda seleccionada).
- **`BrandsManager`** (botón "Marcas"): crear / renombrar inline / eliminar — el botón de
  eliminar se deshabilita con hint mientras la marca tenga proveedores.

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/suppliers` | Lista paginada con marcas embebidas (aplanadas), search, sort, filtro `brandId` |
| `POST` | `/api/suppliers` | Crear (+ links de marcas, con rollback) |
| `PATCH` | `/api/suppliers/[id]` | Updates sparse + `brandIds` (replace por diff) |
| `DELETE` | `/api/suppliers/[id]` | Eliminar (links CASCADE) |
| `GET` | `/api/brands` | Marcas con conteo de proveedores |
| `POST` | `/api/brands` | Crear (normalizada; duplicada → 400) |
| `PATCH` | `/api/brands/[id]` | Renombrar (normalizado) |
| `DELETE` | `/api/brands/[id]` | Bloqueado si está en uso (400 con conteo) |

## Archivos

- `src/app/dashboard/proveedores/page.tsx`
- `src/components/suppliers/` — SuppliersTable, SupplierForm, BrandsManager
- `src/hooks/useSuppliers.ts` — hooks de proveedores y marcas (`SUPPLIERS_KEY`, `BRANDS_KEY`)
- `src/app/api/suppliers/` + `src/app/api/brands/`
- Tests: `tests/api/suppliers.test.ts`, `tests/api/brands.test.ts`
