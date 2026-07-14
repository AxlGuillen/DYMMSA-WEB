# ADR-013 — Descripción DYMMSA con jerarquía de catálogo

**Fecha:** 2026-07-08 · **Actualizado:** 2026-07-14 (cruce por código **y marca**)
**Estado:** Aceptado

## Contexto

Las descripciones que manda el cliente en su Excel (`description`/`description_es`)
son pobres o incorrectas a veces — y **no dependen de DYMMSA** (son las de la
empresa del cliente, en inglés y español). Se necesita una descripción propia:
para productos URREA, la **oficial del catálogo** (`urrea_catalog`) sirve de
respaldo de lo que se cotiza con ese código y evidencia discrepancias; para
otras marcas, DYMMSA la redacta a mano.

## Decisión

Una "Descripción DYMMSA" **resuelta en código** con jerarquía fija, nunca
copiada entre tablas vivas:

```
1. Catálogo oficial (match (code, brand) ↔ (model_code, brand), normalizados) → gana SIEMPRE
2. Curada DYMMSA (etm_products.dymmsa_description)                            → sin catálogo
3. null → celda vacía en el cotizador para que la llenen
```

Resolver: `resolveDymmsaDescription(item, catalogMap)` en `business-rules.ts`,
devuelve `{ value, source }` (`source: 'catalog' | 'dymmsa' | null` para que la
UI etiquete el origen y deshabilite la edición cuando gana el catálogo).

### Reglas

1. **`etm_products.dymmsa_description` se mantiene VACÍA para productos con
   match de catálogo.** La oficial no se copia nunca: si está mal, se corrige
   reimportando el catálogo (no se puede "tapar" — decisión explícita para no
   trabajar doble y conservar el rol de respaldo/verificación).
2. **`quotation_items.dymmsa_description` es snapshot del valor RESUELTO** al
   guardar (`save`/`update`, server-side con `fetchCatalogDescriptionMap`).
   Congelado como el resto del ítem: una cotización es un documento comercial;
   reimportar el catálogo NO reescribe cotizaciones guardadas (feature, no bug).
3. **Auto-learn persiste solo la curada CRUDA** que manda la UI — nunca el
   valor resuelto. Garantía estructural: la resolución ocurre después, solo en
   el payload de inserción de `quotation_items`. Reglas de merge estándar
   (no vacío + distinto → update; vacío nunca pisa).
4. **La llave de cruce es `(código, marca)`, no solo el código** — `catalogKey()`
   (2026-07-14). `urrea_catalog` tiene identidad `UNIQUE(code, brand)` porque el
   mismo código puede existir en varias marcas (URREA maneja varias líneas), así
   que cruzar solo por código podía traer la descripción de **otra marca**.
   El match es **estricto**: un producto marcado `URREA` cuyo código solo existe
   bajo `SURTEK` ya NO hereda esa descripción (cae a la curada). Eso destapa el
   dato malo en vez de esconderlo — se corrige poniéndole la marca correcta al
   producto en el catálogo ETM.
   - Ambas partes se normalizan (trim + mayúsculas): `normalizeCatalogCode` y
     `normalizeCatalogBrand` (marca vacía → `DEFAULT_BRAND` = `'URREA'`).
   - Aplica en TODOS los caminos de escritura de `urrea_catalog` (import, POST,
     PATCH) y al armar lookups. Sin esto el match falla en silencio.
   - **Los mapas de catálogo van indexados por `catalogKey`** (`MARCA|CODIGO`),
     no por código: `fetchCatalogDescriptionMap`, `catalogDescriptions` del store
     Zustand, y las respuestas de `/api/urrea-catalog/lookup` y `/api/quotes/lookup`.
     La *query* sigue siendo por código (trae todas las marcas de esos códigos) —
     así el llamador no necesita mandar marcas y el resolver elige la de su ítem.
5. Separadores → siempre `null` (como en todas las reglas).
6. Fila de catálogo **sin** descripción cede el turno a la curada (no aporta
   nada oficial).

### Dos tipos de duplicación (por qué snapshot sí, sync no)

- **Duplicación por sincronización** (rechazada): copiar la oficial a
  `etm_products` exige jobs de sync, produce drift al reimportar y pisa
  ediciones manuales.
- **Duplicación por snapshot** (adoptada): copia intencional, inmutable, jamás
  sincronizada — mismo patrón que `location` en `order_items` e `is_sold` en
  `quotation_items`.

## Flujo de datos

- **Import Excel (cotizador):** `POST /quotes/lookup` acepta `modelCodes` y
  devuelve `catalogDescriptions` (incluye códigos de filas aún sin registro en
  `etm_products`) → se guarda en el draft store (`catalogDescriptions`,
  persistido con el borrador). La columna del editor resuelve contra ese mapa.
- **Edición manual:** `POST /urrea-catalog/lookup` (`{ codes[] }` →
  `{ descriptions }`); `useCatalogDescription(code)` con debounce 400ms en
  `ProductModal`/`ProductForm` — campo deshabilitado mostrando la oficial
  cuando hay match.
- **Vistas guardadas:** `QuotationDetail` y `/approve/[token]` leen el snapshot
  de `quotation_items` — cero queries extra.

## Alternativas descartadas

- **Columna copiada + sync al importar catálogos** (propuesta original): ver
  "duplicación por sincronización".
- **Reusar `description_es` como curada:** no es de DYMMSA — es la descripción
  en español del cliente.
- **Curada como override sobre el catálogo:** invertiría la jerarquía; se
  descartó para conservar el rol de respaldo (si duele en la práctica, es una
  línea en el resolver).

## Módulo

- Migración `add_dymmsa_description` — columna en `etm_products` y
  `quotation_items` (+ normalización defensiva de `urrea_catalog.code`, no-op:
  catálogo vacío al momento).
- Migración `add_brand_to_urrea_catalog` (2026-07-14) — `brand` + identidad
  `UNIQUE(code, brand)`; habilita el cruce por marca.
- `src/lib/business-rules.ts` — `normalizeCatalogCode`, `normalizeCatalogBrand`,
  `catalogKey`, `resolveDymmsaDescription`.
- `src/lib/urrea-catalog.ts` — `fetchCatalogDescriptionMap` (batch por código,
  mapa indexado por `catalogKey`; degrada a mapa vacío ante error).
- `src/stores/quotationStore.ts` — `catalogDescriptions` indexado por `catalogKey`
  (persist `version: 1` + `migrate` que descarta el mapa v0, indexado por código).
- Rutas: `quotes/lookup` (extendida), `urrea-catalog/lookup` (nueva),
  `quotations/save` + `[id]/update` (snapshot resuelto), `urrea-catalog`
  import/POST/PATCH (normalización).
- UI: `QuotationEditor` (columna + badge URREA), `ProductModal`, `ProductForm`,
  `ProductsTable`, `QuotationDetail`, `ApprovalClient`.
- Tests: `business-rules` (resolver/normalizador), `quotations` (snapshot),
  `auto-learn` (curada cruda), `urrea-catalog` (normalización + lookup),
  `quotes-lookup` (nuevo), `QuotationEditor` (columna resuelta).

## Pendiente

- El catálogo URREA sigue **vacío en producción**; al primer import todo queda
  normalizado desde el origen.
- Excel de orden URREA sigue usando `description_es` (fuera de alcance v1).
- Catálogos de otras marcas: generalizar a una tabla `catalogs` con columna
  `brand` y extender el resolver — sin migrar datos copiados.
