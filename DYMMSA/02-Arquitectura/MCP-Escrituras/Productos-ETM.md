# MCP escrituras — Productos ETM (BD ETM)

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]] · [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]]

## Resumen

`etm_products` es el catálogo propio ETM → producto (`etm UNIQUE`, `model_code NOT NULL`, `brand DEFAULT 'URREA'`, `price numeric(10,2)` sin CHECK, `is_sold` tri-estado, `dymmsa_description` curada y las cinco `cut_*` nominales). Alimenta al cotizador: al cargar un Excel, el cotizador hereda de aquí descripción, `model_code`, marca, `is_sold`, la curada y el precio cuando el Excel no trae uno (`src/app/dashboard/quoter/page.tsx`). Las cotizaciones guardan snapshot, así que una edición solo afecta cotizaciones **futuras**. Escriben estas rutas (CRUD + import) y, aparte, el auto-learn al guardar cotizaciones. El MCP hoy solo lee (`search_products`). Riesgo general **bajo-medio**: lo delicado es no copiar la descripción oficial (ADR-013) y no desligar cruces al cambiar `etm`/`model_code`/marca.

Foto de la nube (consulta de solo lectura, 2026-10-22): 1,611 productos; 740 sin marca; 5 con marca sin normalizar; 6 con `model_code` sin normalizar; 3 con medidas `cut_*`; **428 con curada y match de catálogo, 424 idénticas a la oficial**.

## Rutas que escriben

### `POST /api/products` — `src/app/api/products/route.ts`
- **Auth / rol:** `requireAuth`. RLS de `etm_products`: policies separadas INSERT/UPDATE/DELETE/SELECT para `authenticated` con `true` (sin `is_admin()`).
- **Entrada:** body `Partial<EtmProductInsert>`, validación inline con el helper local `text()` (trim; no-string → `''`). `etm` obligatorio (400). `description`, `description_es`, `model_code`, `brand` → texto con trim (vacío = `''`; **sin** mayúsculas y sin default URREA: una marca ausente se guarda `''`). `dymmsa_description` → `text() || null`. `price`: número finito o 0 (acepta negativos). `is_sold`: boolean o `null`.
- **Qué hace:** `insert` + `.select().single()` → 201.
- **Reglas y efectos secundarios:** `23505` → 400 "Ya existe un producto con el ETM X"; otro error → 500 genérico. **No** aplica la regla ADR-013 (curada vacía si hay match de catálogo): acepta guardar la oficial como curada. No escribe `created_by` (el import sí). Las `cut_*` no se aceptan.
- **Dónde vive la lógica:** inline (con `text()` duplicado en `[id]/route.ts`). Hay que extraerla.
- **Quién la usa en la UI:** `useCreateProduct` → `src/components/db/ProductForm.tsx` (alta). La guarda ADR-013 vive **solo** en este formulario: con `useCatalogDescription` muestra la oficial deshabilitada y reenvía la curada que ya había.

### `PATCH /api/products/[id]` — `src/app/api/products/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** `id` del path + body `EtmProductUpdate`. Solo se toca lo que viene: `etm` (vacío → 400), `description`, `description_es`, `model_code`, `brand` (texto con trim), `dymmsa_description` (`''` → null), `price` (número finito o 400 "El precio debe ser un número"; negativos pasan), `is_sold` **tri-estado**: ausente = no se toca, `null` explícito **sí** se persiste, otro tipo → 400. Sin cambios → 400.
- **Qué hace:** `update({ ...updates, updated_at })` por `id`. `PGRST116` → 404, `23505` → 400.
- **Reglas y efectos secundarios:** sin guarda ADR-013 (igual que POST). Renombrar `etm` cambia la llave con la que el auto-learn y el cotizador buscan (`.in('etm', …)`): la siguiente cotización con el ETM viejo crea otro producto. Cambiar `model_code`/`brand` cambia el cruce con el catálogo (`catalogKey`) y la marca que la vista `store_inventory_with_brand` le pone al inventario. Sin bitácora.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useUpdateProduct` → `ProductForm` (edición) y `useSetProductSold` → `src/components/db/ProductsTable.tsx` (selector de `is_sold` por fila).

### `DELETE /api/products/[id]` — `src/app/api/products/[id]/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** `id`.
- **Qué hace:** `delete().eq('id', id)` → `{ ok: true }` aunque no exista.
- **Reglas y efectos secundarios:** no hay FK hacia `etm_products` (las cotizaciones guardan snapshot), así que nada se rompe… pero se pierden la curada, `is_sold` y las `cut_*`; el siguiente auto-learn lo vuelve a crear solo con lo que traiga la cotización.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useDeleteProduct` → `ProductsTable` (diálogo de confirmación).

### `POST /api/products/import` — `src/app/api/products/import/route.ts`
- **Auth / rol:** `requireAuth`; misma RLS.
- **Entrada:** multipart `file` + `mode`. La UI (`src/components/db/ExcelImporter.tsx`) manda `upsert` ("Actualizar y agregar") o `insert` ("Solo agregar nuevos"); la ruta trata todo lo que no sea `upsert` como insert. Columnas obligatorias `ETM` y `MODEL_CODE` (nombres exactos, revisados en la primera fila); opcionales `DESCRIPTION`, `DESCRIPTION_ES`, `PRICE`, `BRAND`.
- **Qué hace:** por fila: arma el producto (`brand` default `'URREA'`, `created_by` = usuario) y en upsert hace `select` por `etm` → `update` o `insert`; en insert, `insert` y los duplicados cuentan como `errors`.
- **Reglas y efectos secundarios:** el upsert **pisa con vacío**: si faltan celdas, `description`/`description_es`/`model_code` quedan `''`, `price` 0 y `brand` `'URREA'` (lo contrario de la regla del auto-learn "solo campos no vacíos"). Pone `brand='URREA'` aunque no haya `MODEL_CODE` (ADR-002 dice que no). Reescribe `created_by` en cada update. No toca `is_sold`, `dymmsa_description` ni `cut_*`. Sin reporte por fila.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useImportProducts` → `ExcelImporter`.

### Otros escritores de `etm_products` (fuera de este grupo)
- **Auto-learn** (`processAutoLearn()` en `src/lib/auto-learn.ts`), llamado por `POST /api/quotations/save` y `PATCH /api/quotations/[id]/update`: inserta o mezcla solo campos no vacíos; `brand='URREA'` solo con `model_code`; `is_sold` solo explícito; curada vía `learnableDymmsaDescription()` (nunca la oficial).
- **`POST /api/orders/auto-learn`** (`useAutoLearn` en `NewOrderForm`): inserta productos nuevos de órdenes manuales con `brand: 'URREA'` fijo (exige `model_code`).
- Las `cut_*` **no las escribe ninguna ruta**: solo las leen `GET /api/orders/[id]/cut-plan` y `GET /api/quotations/[id]/cut-candidates` (las 3 que existen se cargaron por fuera de la app).

## Cobertura MCP actual

- **`search_products`** (lectura, `searchProducts()` en `src/lib/mcp/tools/products.ts`): `query` (ETM, `model_code`, descripción; obligatorio) + paginación. Devuelve precio, marca, `is_sold` y la Descripción DYMMSA **ya resuelta** con su fuente (`resolveDymmsaDescription` + `fetchCatalogDescriptionMap`).
- **No puede:** dar de alta, editar (precio, `is_sold`, curada, marca), borrar ni importar. `GET /api/products/next-dymmsa-code` está excluida de la cobertura de lectura ("consecutivo interno del alta de productos").

## Casos de uso desde el chat

1. "El ETM 1180234 no lo vendemos, márcalo." → `PATCH is_sold=false` (afecta totales y validación de cotizaciones futuras).
2. "Vuelve a dejar el 1180234 como sin definir." → `PATCH is_sold=null` explícito (tri-estado).
3. "Cámbiale el precio al 1180234 a $245.50." → `PATCH price` (solo pre-llena cuando el Excel no trae precio).
4. "Ponle descripción DYMMSA 'Punta de cobre 30 mm' al DYMMSA-41." → `PATCH dymmsa_description`; debe rechazarse si el producto resuelve al catálogo URREA.
5. "Da de alta un ETM nuevo para la boquilla de 1/2, código interno." → `POST` con `etm` = siguiente `DYMMSA-N` (ADR-002).
6. "El 1180234 en realidad es SURTEK, no URREA." → `PATCH brand` (cambia cruce de catálogo y marca del inventario).
7. "El modelo del 1180234 es 6954A, no 6954." → `PATCH model_code` (mismo efecto).
8. "El DYMMSA-12 es tubo de 30 mm de diámetro." → medidas `cut_*` (hoy sin ruta).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Cambiar `is_sold` (incluido `null`) | bajo | Reversible; solo pesa en cotizaciones futuras (snapshot) |
| Cambiar precio | bajo | Solo pre-llena cuando el Excel no trae precio; snapshot en lo guardado |
| Cambiar descripción / descripción ES | bajo | Solo cotizaciones futuras |
| Cambiar curada (`dymmsa_description`) | bajo | Con la guarda ADR-013 del lado del servidor; sin ella, riesgo de copiar la oficial |
| Alta de producto | bajo | Un ETM repetido da 23505; un typo crea un producto basura que el auto-learn no corrige |
| Cambiar `model_code` / marca | medio | Cambia el cruce con el catálogo (descripción oficial) y la marca del inventario |
| Renombrar `etm` | medio | Desliga el producto de su ETM: la siguiente cotización crea otro |
| Medidas `cut_*` | bajo | Solo pre-llenan la lista de corte; hoy sin ruta |
| Eliminar | medio | Pierde curada, `is_sold` y `cut_*` sin rastro |
| Import por archivo | alto | Upsert pisa con vacíos, reescribe `created_by`, 1,611 filas |

## Propuesta de tools

### `save_product` — nueva (+1 tool)
- **Entidad:** `etm_products`. Crea o edita (ADR-034).
- **Parámetros:** `etm` (obligatorio; match exacto sin distinguir mayúsculas con `requireSingleMatch`; con `crear: true` y `etm: "nuevo"` toma el siguiente `DYMMSA-N`), `crear` (alta explícita: sin él un ETM desconocido es error, no un producto nuevo), `nuevo_etm`, `descripcion`, `descripcion_es`, `descripcion_dymmsa` (`''` la borra), `codigo_modelo`, `marca`, `precio` (≥ 0), `se_vende` (`true | false | null`; ausente = no se toca), opcional `corte` `{ tipo: tubo|placa, diametro_mm, espesor_mm, ancho_mm, largo_mm }` si se decide (Pregunta 1), `confirmar`.
- **Confirmación:** alta, precio, `is_sold`, descripciones y `corte` → **directo**, devolviendo el antes → después. `nuevo_etm`, `codigo_modelo` o `marca` → **confirmar** (resumen: qué cruce cambia, descripción oficial antes/después).
- **`adminOnly`:** sí (la RLS de `etm_products` está abierta a `authenticated`; la barrera para un member es el handler por rol).
- **Store / refactor necesario:** `src/lib/products-store.ts` con `parseProductInput()` (el `text()` duplicado y el tri-estado de `is_sold`), `createProduct()`, `updateProduct()`, `nextDymmsaCode()` (sale de `next-dymmsa-code/route.ts`; dos altas simultáneas pueden tomar el mismo número → reintentar ante 23505) y **`assertCuratedAllowed()`**: la guarda ADR-013 del lado del servidor con `fetchCatalogDescriptionMapOrNull()` + `resolveDymmsaDescription()` y `catalogKey(model_code, brand)` — rechaza la curada si el producto resuelve al catálogo y, con el catálogo ilegible, si trae código (misma regla que `learnableDymmsaDescription()`). Las rutas `POST`/`PATCH` la adoptan: hoy la regla solo la cumple `ProductForm`. Si entra `corte`, validar con el CHECK de la BD (`cut_kind in (tube, plate)`, medidas > 0) y los mm de `cut-plan.ts`.
- **Fusión:** ninguna natural. Juntar con `save_catalog_item` en una "save_catalog" con `catalogo: etm|urrea` ahorraría 1 tool pero rompe "una por entidad" y mezcla dos jerarquías de descripción; no se recomienda.

**Total del módulo:** **+1 tool** en el bloque app.

## Fuera a propósito

- **`DELETE /api/products/[id]`**: sin rastro, y lo útil (curada, `is_sold`, `cut_*`) no vuelve con el auto-learn. Para "ya no lo vendemos" está `se_vende: false`. Precedente: el MCP no borra.
- **`POST /api/products/import`**: archivo de catálogo completo; el upsert pisa con vacíos. Por chat no aporta sobre `save_product` y el riesgo es alto.
- **`GET /api/products/next-dymmsa-code`**: lectura interna; queda dentro de `save_product` (`etm: "nuevo"`).

## Preguntas abiertas

1. ¿Las medidas `cut_*` se vuelven editables (por `save_product` y por la app)? Hoy ninguna ruta las escribe.
2. ¿La guarda ADR-013 se mueve a la ruta (recomendado) para que app y MCP compartan la misma regla?
3. ¿`save_product` normaliza `marca` a trim+upper? Las rutas no lo hacen (5 filas sin normalizar; `catalogKey` y la vista lo toleran).
4. ¿Precio negativo debe ser 400? `etm_products.price` no tiene CHECK y la ruta lo acepta.
5. ¿Alta con `etm: "nuevo"` (siguiente `DYMMSA-N`) desde el chat, o el ETM siempre lo dicta el usuario?
6. ¿Se permite renombrar `etm` desde el chat?
7. Limpieza ADR-013: 424 de 428 curadas con match de catálogo son idénticas a la oficial en la nube y `clear_catalog_copied_dymmsa_description` no aparece en `supabase_migrations.schema_migrations`. ¿Falta aplicarla?
