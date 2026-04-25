# Fase 3: Cotizador Básico ✅

> **Módulo:** [[03-Modulos/Cotizador]] · Cotizador completo implementado en [[05-Fases/Fase-5-Flujo-Completo#5A Cotizador (tabla editable)]]

**Estado:** Completada

## Qué se hizo

- `FileUploader`: drag & drop de Excel del cliente.
- `extractEtmCodesFromExcel()` en `src/lib/excel/parser.ts`.
- `GET /api/quotes/lookup`: lookup de ETMs en `etm_products`.
- Tabla editable básica pre-rellena.
- Generación de cotización descargable (preview básico).

> Nota: la tabla editable completa con Zustand, ProductModal y persistencia se implementó en Fase 5A.
