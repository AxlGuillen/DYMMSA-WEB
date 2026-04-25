# ADR-003: Campo sort_order para preservar orden de ítems

> **Implementado en:** [[03-Modulos/Cotizador]] (al guardar), [[03-Modulos/Ordenes]] (al crear orden y agregar ítems)  
> **Tablas afectadas:** [[02-Arquitectura/Base-de-Datos#quotation_items|quotation_items]], [[02-Arquitectura/Base-de-Datos#order_items|order_items]]  
> **Relacionado con:** [[04-Decisiones-Tecnicas/ADR-001-Separadores]] (separadores usan sort_order para mantener posición)

**Fecha:** 2026-04-01  
**Migraciones:** `20260319012014` (quotation_items), `20260401042130` + `20260401050143` (order_items)  
**Estado:** Implementado ✅

---

## Contexto

Los ítems de cotización y orden tienen un orden significativo: el usuario puede reordenarlos (drag & drop en `QuotationEditor`), y los separadores deben mantener su posición relativa a los productos. Sin un campo explícito, las consultas a Supabase no garantizan orden consistente.

## Decisión

Agregar `sort_order INTEGER DEFAULT 0` a `quotation_items` y `order_items`.

**Asignación:**
- Al guardar cotización: `sort_order = index` (posición en el array de `QuotationItemRow`).
- Al crear orden: `sort_order` se re-asigna secuencialmente iterando `quotation_items` ordenados por su propio `sort_order`.
- Al agregar ítem manualmente a orden existente: `sort_order = max(sort_order) + 1`.

**Consultas:** siempre se ordena por `sort_order ASC` en `OrderDetail` y `QuotationDetail`.

## Por qué no usar el orden de inserción (ROWID/created_at)

- `created_at` tiene resolución de milisegundos — inserciones en lote pueden tener el mismo timestamp.
- El orden de inserción de Supabase no está garantizado con inserciones en batch.
- El usuario puede reordenar ítems en la UI antes de guardar.

## Alternativas consideradas

- **Linked list (prev_id / next_id):** más eficiente para reordenamientos frecuentes pero mucho más complejo de implementar y mantener. No justificado para el volumen actual.
- **Float sort_order (LexoRank):** permite insertar entre ítems sin re-numeración. Overkill para este caso.
