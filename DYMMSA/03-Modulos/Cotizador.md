# Módulo: Cotizador

> **Pipeline:** Cotizador → [[03-Modulos/Aprobacion-por-Token|Aprobación]] → [[03-Modulos/Ordenes|Órdenes]]  
> **Tablas:** [[02-Arquitectura/Base-de-Datos#quotations|quotations]], [[02-Arquitectura/Base-de-Datos#quotation_items|quotation_items]], [[02-Arquitectura/Base-de-Datos#etm_products|etm_products]]  
> **Auto-learn:** [[03-Modulos/Catalogo-ETM#Auto-learn]] · **DYMMSA codes:** [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]] · **Separadores:** [[04-Decisiones-Tecnicas/ADR-001-Separadores]]

## Flujo completo

```
1. Usuario va a /dashboard/quoter
2. Sube Excel del cliente (FileUploader)
3. extractProductRowsFromExcel() parsea el archivo:
   - Busca columna "ETM" (case insensitive) en cada hoja
   - Extrae columnas opcionales: description, description_es, model_code, quantity, price, brand
   - Productos sin ETM → DYMMSA-TEMP-{n}
4. POST /api/quotes/lookup → contrasta ETMs con etm_products → completa datos faltantes
5. QuotationEditor muestra la tabla pre-rellena (las celdas son de solo lectura)
6. Usuario edita cada producto con el lápiz (ProductModal), agrega filas,
   inserta separadores (su nombre sí se escribe en la fila) y reordena
7. Pre-flight (getBlockingIssues) → POST /api/quotations/save → persiste en BD + auto-learn
8. Reset del Zustand store + limpieza de localStorage → abre el detalle de la cotización nueva
```

## Estado: Zustand + localStorage

**Store:** `src/stores/quotationStore.ts`  
**Clave localStorage:** `dymmsa-quotation-draft`

| Acción | Método |
|--------|--------|
| Setear nombre/cliente | `setName()`, `setCustomerName()` |
| Reemplazar todos los ítems | `setItems()` |
| Actualizar un ítem | `updateItem(id, updates)` |
| Agregar ítem al final | `addItem(item)` |
| Insertar separador | `addSeparatorAfter(afterId \| null)` |
| Eliminar ítem | `removeItem(id)` |
| Reordenar (drag & drop) | `reorderItems(activeId, overId)` |
| Reset total | `reset()` |

El store persiste automáticamente en localStorage via `persist` de Zustand. Se limpia con `reset()` al guardar exitosamente.

## Parseo de Excel (`src/lib/excel/parser.ts`)

**Función principal:** `extractProductRowsFromExcel(buffer: ArrayBuffer)`

- Multi-hoja: procesa todas las hojas del workbook.
- Columnas reconocidas (case insensitive): `etm, description, descripcion, desc, model_code, modelo, quantity, cantidad, qty, price, precio, brand, marca`.
- Solo ETM es obligatorio. Campos faltantes quedan como string vacío o null.
- ETMs con valor `"new"` (cualquier casing) → `DYMMSA-TEMP-{n}`.
- Permite el mismo ETM múltiples veces (diferentes secciones = filas independientes).

## Componentes principales

| Componente | Ruta | Rol |
|-----------|------|-----|
| `FileUploader` | `src/components/quoter/FileUploader.tsx` | Drag & drop de Excel, dispara parseo |
| `QuotationEditor` | `src/components/quoter/QuotationEditor.tsx` | Tabla editable principal, gestiona Zustand |
| `ProductModal` | `src/components/quoter/ProductModal.tsx` | Modal de edición por producto (modos: create / edit) |

## QuotationItemRow (tipo local, no en BD)

```typescript
interface QuotationItemRow {
  _id: string          // UUID local (React key), no persiste en BD
  item_type: 'product' | 'separator'
  section_label: string
  etm: string
  description: string
  description_es: string
  model_code: string
  brand: string
  unit_price: number | null
  quantity: number | null
  delivery_time: DeliveryTime
  _inDb: boolean       // true si ETM fue encontrado en etm_products
}
```

Colores de fila (con leyenda): **naranja** = sin descripción ni `model_code` ("Sin datos"), **gris** = sin `model_code`, **amarillo** = sin cantidad, **verde** = completo (código, cantidad y precio). Un "no lo vendemos" gana sobre todos. `_inDb` solo pinta la columna Origen (Catálogo / Nuevo).

## Guardar cotización (`POST /api/quotations/save`)

1. Antes del request, la página corre el pre-flight (`getBlockingIssues`, `src/lib/quotation-validation.ts`): cada producto necesita ETM y cantidad > 0, y el precio puede ir vacío pero no negativo; los "no lo vendemos" quedan exentos. Sin código de modelo no bloquea (severidad `warning`). La ruta valida `name`, `customer_name` y al menos 1 ítem de tipo `product`.
2. Calcula `total_amount` sumando `unit_price * quantity` de ítems producto con ambos campos presentes.
3. Inserta en `quotations` (status: `draft`).
4. Inserta en `quotation_items` con `sort_order = index`.
5. Separadores: `etm, description, model_code, etc.` = null; `section_label` se preserva.
6. Ejecuta `processAutoLearn()` después de guardar, en su propio try/catch: si falla, la cotización ya quedó guardada y la respuesta trae `warning: 'auto_learn_failed'`.
7. Si la inserción de ítems falla → rollback (elimina la cotización).

## Archivos relevantes

- `src/app/dashboard/quoter/page.tsx`
- `src/components/quoter/` (3 componentes: `FileUploader`, `QuotationEditor`, `ProductModal`)
- `src/stores/quotationStore.ts`
- `src/lib/excel/parser.ts`
- `src/hooks/useQuotes.ts`
- `src/app/api/quotes/lookup/route.ts`
- `src/app/api/quotations/save/route.ts`
