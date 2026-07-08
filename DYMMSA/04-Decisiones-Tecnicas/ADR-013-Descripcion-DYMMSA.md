# ADR-013 — Descripción DYMMSA con jerarquía de catálogo

**Fecha:** 2026-07-08
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
1. Catálogo oficial (match urrea_catalog.code ↔ model_code, normalizado) → gana SIEMPRE
2. Curada DYMMSA (etm_products.dymmsa_description)                        → sin catálogo
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
4. **Normalización de la llave de cruce** (`normalizeCatalogCode` = trim +
   mayúsculas) en TODOS los caminos de escritura de `urrea_catalog.code`
   (import, POST, PATCH) y al armar lookups. Sin esto el match falla en
   silencio — es prerequisito, no opcional.
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
- `src/lib/business-rules.ts` — `normalizeCatalogCode`, `resolveDymmsaDescription`.
- `src/lib/urrea-catalog.ts` — `fetchCatalogDescriptionMap` (batch, degrada a
  mapa vacío ante error).
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
