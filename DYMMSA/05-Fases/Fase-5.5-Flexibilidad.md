# Fase 5.5: Flexibilidad en Cotizaciones y Órdenes ✅

> **Módulos afectados:** [[03-Modulos/Cotizador]], [[03-Modulos/Ordenes]]  
> **Decisión técnica:** [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]]  
> **Decisión de negocio:** [[01-Negocio/Decisiones-de-Negocio#Por qué cotizaciones aprobadas son editables]]

**Estado:** Completada

## Contexto

El flujo informal de DYMMSA requería poder editar cotizaciones ya aprobadas y manipular ítems de órdenes en curso.  
Ver [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]] para el razonamiento completo.

## Cotizaciones aprobadas editables

- `PATCH /api/quotations/[id]/update` acepta `status = 'approved'`.
- Ítems existentes preservan `is_approved` original al re-insertar.
- Ítems nuevos agregados por DYMMSA → `is_approved = true`.
- `QuotationDetail`: `canEdit = isDraft || isApproved`.
- Botón "Agregar" y editar/eliminar por fila disponibles en aprobadas.
- "Enviar a aprobación" solo en `draft`.

## Ítems de orden editables

- `POST /api/orders/[id]/items` — agregar con stock check + deducción.
- `PATCH /api/orders/[id]/items/[itemId]` — editar `unit_price` + recalcula `total_amount`.
- `DELETE /api/orders/[id]/items/[itemId]` — eliminar + restaura `quantity_in_stock`.
- Disponible solo cuando orden no está `completed` ni `cancelled`.

## Hooks nuevos

- `useAddOrderItem`
- `useEditOrderItem`
- `useRemoveOrderItem`
