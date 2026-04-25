# Fase 5: Cotizador, Aprobación y Sistema de Órdenes ✅

> **Módulos implementados:** [[03-Modulos/Cotizador]] · [[03-Modulos/Aprobacion-por-Token]] · [[03-Modulos/Ordenes]] · [[03-Modulos/Inventario]]  
> **BD:** [[02-Arquitectura/Base-de-Datos#quotations|quotations]], [[02-Arquitectura/Base-de-Datos#quotation_items|quotation_items]], [[02-Arquitectura/Base-de-Datos#orders|orders]], [[02-Arquitectura/Base-de-Datos#order_items|order_items]]

**Estado:** Completada

## 5A: Cotizador (tabla editable)

- `extractProductRowsFromExcel()`: parseo multi-hoja con detección de columnas opcionales.
- `QuotationEditor`: tabla editable con todas las columnas.
- `ProductModal`: modal por producto (modos create/edit).
- Zustand store (`quotationStore.ts`) + persist en localStorage (`dymmsa-quotation-draft`).
- Agregar filas manualmente y separadores.
- `POST /api/quotations/save`: crea `quotations` + `quotation_items` + auto-learn.

## 5B: Aprobación por link

- `POST /api/quotations/[id]/send-for-approval`: genera `approval_token` UUID.
- Página pública `/approve/[token]` (server + client component).
- Aprobación parcial por ítem: ✅/❌/? independiente + "Aprobar todo".
- `POST /api/approve/[token]`: actualiza `is_approved` + status cotización.
- Banner informativo si ya fue procesada.

## 5C: Orden desde cotización

- Dashboard cotizaciones (`/dashboard/quotations`) con filtros y búsqueda.
- `QuotationDetail`: stats, edición draft, envío aprobación, creación orden.
- `POST /api/quotations/[id]/create-order`: stock check + deducción inventario + orden completa.
- Excel URREA descargable desde `OrderDetail` (brand=URREA, quantity_to_order>0).
- `OrderDetail`: edición manual quantity_received + urrea_status por ítem.
- `POST /api/orders/[id]/confirm-reception`: suma quantity_received a inventario.
- Gestión de estados via dropdown (5 transiciones).
- `POST /api/orders/[id]/cancel`: restaura inventario.
