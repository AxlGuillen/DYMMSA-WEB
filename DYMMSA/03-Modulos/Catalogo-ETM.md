# Módulo: Catálogo ETM

> **Tabla:** [[02-Arquitectura/Base-de-Datos#etm_products|etm_products]]  
> **Alimentado por:** [[03-Modulos/Cotizador#Guardar cotización (POST /api/quotations/save)|Auto-learn del Cotizador]]  
> **ADRs:** [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]] (productos sin ETM)

## Propósito

Mantener la base de datos de conversión ETM → model_code URREA con descripciones bilingües. Es el corazón del auto-aprendizaje del sistema.

## Tabla: `etm_products` (564 filas actuales)

Ver esquema completo en [[02-Arquitectura/Base-de-Datos#etm_products]].

## Funcionalidades

### CRUD manual
- `ProductsTable` — listado con paginación, búsqueda, sort por columnas.
- `ProductForm` — formulario de creación/edición de producto individual.

### Importación masiva desde Excel
- Ruta: `POST /api/products/import`
- Componente: `ExcelImporter`
- Formato Excel esperado: columnas `ETM, DESCRIPTION, DESCRIPTION_ES, MODEL_CODE, PRICE, BRAND`
- Upsert por ETM: si ya existe, actualiza; si no, inserta.

### Auto-learn (automático al guardar cotización)
- Ruta: parte de `POST /api/quotations/save`
- Lógica en `processAutoLearn()` dentro de `src/app/api/quotations/save/route.ts`
- **INSERT** si ETM no existe en BD.
- **UPDATE** si ETM existe y algún campo (description, description_es, model_code, brand, price) cambió — solo campos no vacíos.
- **SKIP** si nada cambió o el ítem es un separador.
- No asigna `brand = 'URREA'` a productos sin `model_code`.

### Código DYMMSA-{n}
- Productos que llegan sin ETM en el Excel del cliente reciben un código temporal `DYMMSA-TEMP-{n}` durante el parseo.
- El usuario puede solicitar un código permanente via `GET /api/products/next-dymmsa-code`.
- Estos ítems se resaltan en gris en la tabla del cotizador con leyenda explicativa.

## Archivos relevantes

- `src/app/dashboard/db/page.tsx`
- `src/components/db/ProductsTable.tsx`
- `src/components/db/ProductForm.tsx`
- `src/components/db/ExcelImporter.tsx`
- `src/hooks/useProducts.ts`
- `src/app/api/products/import/route.ts`
- `src/app/api/products/next-dymmsa-code/route.ts`
- `src/app/api/quotations/save/route.ts` (función `processAutoLearn`)
