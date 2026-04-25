# ADR-001: Separadores en quotation_items y order_items

> **Implementado en:** [[03-Modulos/Cotizador]] (inserción), [[03-Modulos/Aprobacion-por-Token]] (renderizado), [[03-Modulos/Ordenes]] (copia al crear orden)  
> **Tablas afectadas:** [[02-Arquitectura/Base-de-Datos#quotation_items|quotation_items]], [[02-Arquitectura/Base-de-Datos#order_items|order_items]]  
> **Fase:** [[05-Fases/Fase-6-Mejoras]]

**Fecha:** 2026-03-30  
**Migración:** `20260330002338` — `add_item_type_and_section_label`  
**Estado:** Implementado ✅

---

## Contexto

Los clientes de DYMMSA organizan sus Excel de solicitud en secciones (ej. "Herramienta de corte", "EPP", "Ferretería"). Era necesario preservar esa organización visual en la cotización y la orden para que tanto DYMMSA como el cliente vieran los productos agrupados correctamente.

## Decisión

Agregar `item_type TEXT DEFAULT 'product'` y `section_label TEXT` a `quotation_items` y `order_items`.

- `item_type = 'product'` → ítem normal.
- `item_type = 'separator'` → fila divisora visual. Todos sus campos de producto son null.

## Reglas de exclusión de separadores

Los separadores son **exclusivamente visuales**. Se excluyen de:

| Contexto | Razón |
|----------|-------|
| `total_amount` | No tienen precio |
| Auto-learn (`etm_products`) | No tienen ETM ni model_code |
| Conteos de ítems | No son productos reales |
| Decisiones de aprobación (`is_approved`) | No representan un producto |
| Excel URREA output | No hay qué pedir |
| Excel de entrega | No hay qué entregar |

## Preservación al crear orden

Al ejecutar `create-order`, se itera `quotation_items` ordenados por `sort_order`. Los separadores se copian a `order_items` en su posición relativa (respetando los ítems aprobados que los rodean). Esto mantiene la organización visual en la orden.

## Alternativas consideradas

- **Grupos/secciones como entidad separada:** más normalizado pero mucho más complejo (tabla adicional, FK, UI más complicada). No justificado para el volumen de este sistema.
- **Solo metadata en el frontend:** sin persistencia. Se perdería la organización al recargar o al pasar a la orden.
