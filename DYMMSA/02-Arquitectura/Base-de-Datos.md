# Base de Datos

> Supabase · PostgreSQL 17.6 · Region: us-west-2 · Proyecto: DYMMSA (`wjlklwtvjewhtghlskbt`)  
> Todas las tablas tienen **RLS habilitado**.  
> Última verificación: 2026-04-25

---

## Diagrama de relaciones

```
auth.users
    │
    ├──(created_by)──→ etm_products
    ├──(created_by)──→ quotations ──(quotation_id)──→ orders
    │                       │                              │
    │                 quotation_items               order_items
    └──(created_by)──→ orders
    
store_inventory  (independiente, vinculada por model_code en lógica de negocio)
urrea_catalog    (independiente y aislada — sin relaciones aún, módulo URREA → Catálogo)
```

> Estados y enums explicados en: [[00-Inicio/Glosario]] · Módulos que usan estas tablas: [[03-Modulos/Catalogo-ETM]], [[03-Modulos/Inventario]], [[03-Modulos/Cotizador]], [[03-Modulos/Ordenes]]

---

## Tabla: `etm_products`

**Propósito:** Catálogo de productos ETM → URREA con descripciones bilingües.  
**Módulo:** [[03-Modulos/Catalogo-ETM]]  
**Filas actuales:** 564

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `etm` | text | No | — | UNIQUE | Código ETM genérico del cliente |
| `description` | text | Sí | — | | Descripción en inglés |
| `description_es` | text | Sí | — | | Descripción en español |
| `dymmsa_description` | text | Sí | — | | Descripción curada por DYMMSA. **Vacía si hay match en `urrea_catalog`** (la oficial gana jerarquía y se resuelve en lectura, nunca se copia). Ver [[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]] |
| `model_code` | text | No | — | | Código URREA (ej. `7420MT`) |
| `price` | numeric | Sí | — | | Precio en MXN |
| `brand` | text | Sí | `'URREA'` | | Marca del producto |
| `is_sold` | boolean | Sí | — | | Tri-estado ¿lo vendemos? `null`=sin definir, `true`=sí, `false`=no. Persistido por auto-learn |
| `created_at` | timestamptz | Sí | `now()` | | |
| `updated_at` | timestamptz | Sí | `now()` | | |
| `created_by` | uuid | Sí | — | FK → `auth.users.id` | |

---

## Tabla: `store_inventory`

**Propósito:** Stock físico de la tienda DYMMSA por model_code.  
**Módulo:** [[03-Modulos/Inventario]]  
**Filas actuales:** 195

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `model_code` | text | No | — | UNIQUE | Código URREA |
| `quantity` | integer | No | `0` | `>= 0` | Stock disponible |
| `location` | text | Sí | — | | Ubicación física (gaveta), texto libre. Se conserva aunque `quantity=0` |
| `updated_at` | timestamptz | Sí | `now()` | | |

---

## Tabla: `urrea_catalog`

**Propósito:** Catálogo de productos **multimarca** (código, marca, descripción, STD).  
**Módulo:** [[03-Modulos/Catalogo-URREA]]  
**Aislamiento:** tabla **independiente** — sin FK; cruce **por valor** con `model_code`. Creada el 2026-06-16 (`create_urrea_catalog`); marca agregada el 2026-07-14 (`add_brand_to_urrea_catalog`).

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | No depende del código |
| `code` | text | No | — | UNIQUE(code, brand) | Código (equiv. a `model_code`), normalizado trim+upper |
| `brand` | text | No | `'URREA'` | UNIQUE(code, brand) | Marca/línea, normalizada trim+upper (`URREA`/`SURTEK`/`FOY`...). El mismo código puede existir en varias marcas |
| `description` | text | Sí | — | | Descripción oficial (más completa) |
| `std` | integer | No | `1` | `> 0` | Unidades por paquete (p. ej. 6) |
| `created_at` | timestamptz | No | `now()` | | |
| `updated_at` | timestamptz | No | `now()` | | Trigger `moddatetime` |

Índices: `urrea_catalog_description_idx (description)`, `idx_urrea_catalog_brand (brand)`.
RPC: `urrea_catalog_brand_counts() → (brand, count)` (filtro del catálogo; `security invoker`).
RLS: `Authenticated users can manage urrea_catalog` (ALL, `authenticated`, `true`).

> ⚠️ La resolución de Descripción DYMMSA (`fetchCatalogDescriptionMap`) aún cruza **solo por `code`**; migrar a `(code, brand)` es la issue #27.

---

## Tabla: `quotations`

**Propósito:** Cabecera de cotización.  
**Módulos:** [[03-Modulos/Cotizador]], [[03-Modulos/Aprobacion-por-Token]]  
**Filas actuales:** 9

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `name` | text | No | `''` | | Nombre/título de la cotización |
| `customer_name` | text | No | — | | Nombre del cliente |
| `status` | text | No | `'draft'` | CHECK | Ver estados abajo |
| `approval_token` | uuid | Sí | `gen_random_uuid()` | UNIQUE | Token para link público |
| `approved_at` | timestamptz | Sí | — | | Fecha/hora de aprobación (cliente finaliza o staff marca `approved`) |
| `total_amount` | numeric | No | `0` | `>= 0` | Total en MXN |
| `notes` | text | Sí | — | | Notas internas |
| `original_file_url` | text | Sí | — | | URL del Excel original del cliente |
| `created_at` | timestamptz | Sí | `now()` | | |
| `updated_at` | timestamptz | Sí | `now()` | | |
| `created_by` | uuid | Sí | — | FK → `auth.users.id` | |

**CHECK status:** `draft | sent_for_approval | approved | rejected | converted_to_order`

---

## Tabla: `quotation_items`

**Propósito:** Productos individuales de una cotización.  
**Módulos:** [[03-Modulos/Cotizador]], [[03-Modulos/Aprobacion-por-Token]] · ADR: [[04-Decisiones-Tecnicas/ADR-001-Separadores]], [[04-Decisiones-Tecnicas/ADR-003-sort_order]]  
**Filas actuales:** 365

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `quotation_id` | uuid | No | — | FK → `quotations.id` | |
| `item_type` | text | No | `'product'` | | `product` o `separator` |
| `section_label` | text | Sí | — | | Etiqueta del separador |
| `sort_order` | integer | No | `0` | | Orden de visualización |
| `etm` | text | Sí | — | | Código ETM (null en separadores) |
| `description` | text | Sí | — | | |
| `description_es` | text | Sí | — | | |
| `dymmsa_description` | text | Sí | — | | Snapshot del valor **resuelto** al guardar: catálogo URREA ?? curada ?? null. Congelado (documento comercial). Ver [[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]] |
| `model_code` | text | Sí | — | | |
| `brand` | text | Sí | — | | |
| `unit_price` | numeric | Sí | — | `IS NULL OR >= 0` | |
| `quantity` | integer | Sí | — | `IS NULL OR > 0` | |
| `is_approved` | boolean | Sí | — | | null=pendiente, true=aprobado, false=rechazado |
| `is_sold` | boolean | Sí | — | | Snapshot de `etm_products.is_sold`. null=sin definir, true=lo vendemos, false=no lo vendemos |
| `notes` | text | Sí | — | | |
| `delivery_time` | text | Sí | `'immediate'` | | Ver valores en [[Glosario]] |
| `created_at` | timestamptz | Sí | `now()` | | |

---

## Tabla: `orders`

**Propósito:** Cabecera de orden de venta.  
**Módulo:** [[03-Modulos/Ordenes]] · Estados: [[00-Inicio/Glosario#Estados de orden (orders.status)]]  
**Filas actuales:** 8

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `name` | text | No | `''` | | Nombre/título de la orden |
| `customer_name` | text | No | — | | |
| `status` | text | No | `'pending_urrea_order'` | CHECK | Ver estados abajo |
| `total_amount` | numeric | No | — | `>= 0` | Total en MXN |
| `quotation_id` | uuid | Sí | — | FK → `quotations.id` | null si orden directa |
| `original_file_url` | text | Sí | — | | |
| `urrea_order_file_url` | text | Sí | — | | URL del Excel generado para URREA |
| `notes` | text | Sí | — | | |
| `created_at` | timestamptz | Sí | `now()` | | |
| `updated_at` | timestamptz | Sí | `now()` | | |
| `created_by` | uuid | Sí | — | FK → `auth.users.id` | |

**CHECK status (migración `20260409055423`):** `ordered | received | delivered | completed | cancelled`

---

## Tabla: `order_items`

**Propósito:** Productos individuales de una orden con desglose de cantidades.  
**Módulo:** [[03-Modulos/Ordenes]] · ADR: [[04-Decisiones-Tecnicas/ADR-001-Separadores]], [[04-Decisiones-Tecnicas/ADR-003-sort_order]]  
**Filas actuales:** 182

| Columna | Tipo | Nullable | Default | Constraint | Descripción |
|---------|------|----------|---------|-----------|-------------|
| `id` | uuid | No | `gen_random_uuid()` | PK | |
| `order_id` | uuid | No | — | FK → `orders.id` | |
| `item_type` | text | No | `'product'` | | `product` o `separator` |
| `section_label` | text | Sí | — | | Etiqueta del separador |
| `sort_order` | integer | No | `0` | | Orden preservado desde cotización |
| `etm` | text | Sí | — | | |
| `model_code` | text | No | — | | |
| `description` | text | Sí | — | | |
| `description_es` | text | Sí | — | | |
| `brand` | text | No | `''` | | |
| `quantity_approved` | integer | No | — | `> 0 OR item_type='separator'` | Total aprobado (0 en separadores) |
| `quantity_in_stock` | integer | No | `0` | `>= 0` | Apartado del inventario DYMMSA |
| `quantity_to_order` | integer | No | `0` | `>= 0` | A pedir a URREA |
| `quantity_received` | integer | No | `0` | `>= 0` | Recibido de URREA (input manual) |
| `urrea_status` | text | No | `'pending'` | CHECK | `pending \| supplied \| not_supplied` |
| `unit_price` | numeric | No | — | `>= 0` | |
| `location` | text | Sí | — | | Snapshot de `store_inventory.location` al crear la orden (gaveta) |
| `delivery_time` | text | Sí | `'immediate'` | CHECK | Ver valores en [[Glosario]] |
| `created_at` | timestamptz | Sí | `now()` | | |

**Constraint implícito:** `quantity_in_stock + quantity_to_order = quantity_approved`
**Constraint `quantity_approved`:** `> 0` para productos; `= 0` permitido en separadores (migración `allow_separators_in_order_items_quantity`, 2026-05-24).

---

## Historial de migraciones

| Versión | Nombre | Descripción |
|---------|--------|-------------|
| `20260306214536` | `add_delivery_time_to_order_items` | Campo delivery_time en order_items |
| `20260309004641` | `add_delivery_time_to_quotation_items` | Campo delivery_time en quotation_items |
| `20260319012014` | `add_sort_order_to_quotation_items` | Campo sort_order en quotation_items |
| `20260321010344` | `add_name_to_quotations` | Campo name en quotations |
| `20260321010959` | `add_name_to_orders` | Campo name en orders |
| `20260330002338` | `add_item_type_and_section_label` | item_type y section_label en ambas tablas de ítems |
| `20260401042130` | `add_sort_order_to_order_items` | Campo sort_order en order_items |
| `20260401050143` | `link_orders_to_quotations_and_fix_sort_order` | FK quotation_id en orders + fix sort_order |
| `20260409055423` | `rename_order_statuses_to_generic` | Renombra estados: `pending_urrea_order→ordered`, `received_from_urrea→received`, etc. |
| `add_is_sold_to_etm_and_quotation_items` | (2026-07-06) | Columna `is_sold boolean` (nullable, sin default) en `etm_products` y `quotation_items` — tri-estado "¿lo vendemos?" |
| `add_location_to_inventory_and_order_items` | (2026-07-07) | Columna `location text` (nullable) en `store_inventory` y `order_items` — ubicación física (gaveta) |
| `add_approved_at_to_quotations` | (2026-07-07) | Columna `approved_at timestamptz` (nullable) en `quotations` — fecha/hora de aprobación |
| `add_dymmsa_description` | (2026-07-08) | Columna `dymmsa_description text` (nullable) en `etm_products` (master curada) y `quotation_items` (snapshot resuelto) + normalización defensiva de `urrea_catalog.code` |
| `drop_price_from_urrea_catalog` | (2026-07-08) | Elimina la columna `price` de `urrea_catalog` — no se usa (la Descripción DYMMSA solo requiere `description` y `std`). Tabla vacía al momento |
| `add_brand_to_urrea_catalog` | (2026-07-14) | Columna `brand text NOT NULL DEFAULT 'URREA'` en `urrea_catalog`; `UNIQUE(code)` → `UNIQUE(code, brand)`; índice `idx_urrea_catalog_brand`. Backfill de filas existentes a `'URREA'` |
| `urrea_catalog_brand_counts_fn` | (2026-07-14) | RPC `urrea_catalog_brand_counts()` — conteo por marca para el filtro del catálogo (`security invoker`) |
