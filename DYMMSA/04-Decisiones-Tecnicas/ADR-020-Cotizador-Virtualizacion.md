# ADR-020 — Rendimiento del cotizador: virtualización con umbral de drag

**Fecha:** 2026-07-17
**Estado:** Implementado
**Issue:** #29

## Contexto

El editor de cotizaciones (`QuotationEditor`) se trababa con cotizaciones grandes
(~1000 productos). El profiling de código identificó tres focos, en orden de
impacto:

1. **Memo de fila roto.** `SortableRow` está en `React.memo`, pero se le pasaba
   `dymmsaDesc={resolveDymmsaDescription(item, catalogMap)}` — un **objeto nuevo
   por render** → la comparación de memo siempre fallaba → **las ~1000 filas se
   re-renderizaban en CADA render del editor** (p. ej. tipear el nombre de la
   cotización). El trabajo de memoizar callbacks e `isVisible` quedaba anulado.
2. **Suscripción al store completo en la página.** `quoter/page.tsx` hacía
   `const { name, items, ... } = useQuotationStore()` sin selector → cada tecla
   en los inputs de encabezado re-renderizaba la página y, en cascada (por el
   punto 1), las 1000 filas.
3. **Sin virtualización.** ~1000 `<tr>` × ~13 `<td>` montados de golpe, y **cada
   fila monta un `useSortable`** de `@dnd-kit` — costo estructural en render
   inicial, scroll y re-render.

Secundario: `persist` serializaba los ~1000 ítems a `localStorage` en cada
mutación (I/O síncrono que traba al encadenar acciones).

## Decisión

### 1. Arreglos del render (mayor ROI, sin dependencias)
- `dymmsaDesc` se precalcula en un `Map<_id, {value, source}>` memoizado
  (`useMemo` sobre `[items, catalogMap]`) → referencia estable → el `React.memo`
  de las filas por fin funciona.
- Selectores acotados en `quoter/page.tsx` (`s => s.items`, `s => s.name`…) +
  `QuotationEditor` envuelto en `React.memo` (su única prop, `errorItemIds`, es
  estable) → tipear encabezado ya no repinta la tabla.
- Stats en un solo paso sobre `productItems`; `existingEtms` memoizado.

### 2. Virtualización con umbral de drag = 300 ítems
`@tanstack/react-virtual`. La clave del diseño es que **virtualización y DnD
nunca coexisten** — dnd-kit necesita la fila montada en el DOM para soltar sobre
ella, y virtualizar desmonta las que están fuera del viewport:

- **≤ 300 ítems** (`DRAG_MAX_ITEMS`): se renderiza la lista completa con el drag &
  drop actual (grip). 300 filas rinden bien una vez arreglado el memo.
- **> 300 ítems**: se virtualiza el `<tbody>` (solo ~20 filas montadas) y el drag
  se **apaga**; el reordenar pasa a **flechas ↑↓** por fila (`moveItem(id, dir)`,
  swap con el vecino en el arreglo completo).

Detalles de la tabla virtualizada:
- **`<colgroup>` + `table-fixed`**: sin anchos fijos las columnas saltan al
  scrollear porque solo ~20 filas definen su ancho. El contenido trunca.
- **Spacer rows**: dos `<tr>` de relleno (altura `paddingTop`/`paddingBottom`)
  arriba y abajo de la ventana virtual, dentro del mismo `<table>` real — así se
  conserva la semántica de tabla y la alineación con el `<thead>`.
- **`measureElement`** por fila (vía `forwardRef` + `data-index`) para tolerar
  alturas mixtas (producto vs separador).
- **`<thead>` sticky** dentro del contenedor scrolleable (`max-h-[70vh]`).
- Celdas compartidas entre ambos modos (`RowCells`, `SeparatorLabelCells`): la
  única diferencia entre drag y virtualizado es la primera celda (grip vs flechas).

### 3. Persistencia con debounce
`createDebouncedStorage` (`src/lib/debounced-storage.ts`) envuelve `localStorage`:
`setItem` trailing-debounced (~500 ms) para coalescer mutaciones encadenadas en
una sola escritura; `getItem` sirve lo pendiente (read-your-writes); **flush en
`pagehide` y al pasar a `hidden`** para no perder el último cambio. Cableado en
el `storage` del `persist` del `quotationStore`.

## Alternativas descartadas

- **Virtualizar + mantener drag con auto-scroll** (dnd-kit sobre lista
  virtualizada): funciona pero es delicado de afinar (drop sobre filas
  desmontadas, medición). El umbral evita el problema de raíz.
- **Layout con divs `role="table"`** en vez de `<table>` real: se evaluó por si el
  colgroup daba guerra; se conservó el `<table>` (spacer rows + table-fixed) por
  menor churn y semántica nativa.

## Consecuencias

- Editar un encabezado o abrir el modal ya no repinta la tabla.
- Cotizaciones de 1000+ ítems montan ~20 filas en vez de ~1000; scroll fluido.
- El reordenar por arrastre solo está disponible hasta 300 ítems; arriba se usan
  flechas (aviso en la UI). Un separador puede moverse igual con flechas.
- **Pendiente / seguimiento:** `QuotationDetail` (detalle de una cotización
  guardada y editable) comparte el patrón de filas con DnD y sufriría lo mismo
  con 1000 ítems — candidato a reusar `RowCells`/virtualización en otra issue.

## Tests

- `tests/lib/debounced-storage.test.ts`: coalesce, read-your-writes, flush,
  removeItem cancela pendiente, SSR sin backing.
- `tests/components/quotationStore.test.ts`: `moveItem` (arriba/abajo, bordes,
  id inexistente, swap con separador).
- `tests/components/QuotationEditor.test.tsx`: cambio de modo por umbral (drag
  ≤300 con grips / flechas >300 sin drag).
