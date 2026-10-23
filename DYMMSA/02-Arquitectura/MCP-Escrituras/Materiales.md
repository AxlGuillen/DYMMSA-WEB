# MCP escrituras — Materiales

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-022-Modulo-de-Corte]]

## Resumen

Catálogo de **presentaciones del proveedor** para el módulo de corte (#59, #71, ADR-022): barras de tubo (diámetro × largo) y hojas de placa (espesor × ancho × largo), siempre en mm. El catálogo se arma solo: cada medida que se captura en el `CutPlanner` queda registrada. Dos métodos escriben sobre `material_presentations`. El MCP registra medidas (`save_material_presentation`, #134), pero no borra ni lista el catálogo completo. El riesgo es bajo: nada en la BD referencia una presentación.

> El margen por corte (`cut_margin_mm`) es un ajuste global, no una presentación: ver [[02-Arquitectura/MCP-Escrituras/Ajustes]]. La lista de corte de una orden (`PUT /api/orders/[id]/cut-plan`) es del grupo de órdenes.

## Rutas que escriben

### `POST /api/material-presentations` — `src/app/api/material-presentations/route.ts`
- **Auth / rol:** `requireAuth` (member incluido). RLS `"Authenticated users can manage presentations"`: `FOR ALL TO authenticated USING (true)`.
- **Entrada:** `{ material_type: 'tube' | 'plate', diameter_mm?, thickness_mm?, width_mm?, length_mm }` → `parsePresentationInput()` (`src/lib/cut-plan.ts`):
  - números finitos > 0;
  - un tubo exige diámetro; una placa, espesor y ancho;
  - los campos del otro tipo salen `null`, porque lo exige el CHECK `material_presentation_shape`.
- **Qué hace:** upsert de `{ ...value, last_used_at: now }` con `onConflict: PRESENTATION_KEY` (`material_type,diameter_mm,thickness_mm,width_mm,length_mm`, que es el UNIQUE **NULLS NOT DISTINCT**), y luego `.select().single()`.
- **Reglas y efectos secundarios:**
  - Idempotente: repetir la misma medida solo refresca `last_used_at`, que da el orden de "la más reciente primero".
  - Un error responde 500 genérico, sin mapeo de PG; el parse ya evita el 23514 del CHECK.
  - Responde 200 (no 201) con la fila. Los `numeric` no se coercen aquí (el GET sí lo hace).
- **Dónde vive la lógica:** mixta.
  - En lib: el parse y la llave, en `cut-plan.ts`, ya compartidos con la tool.
  - Repetido: el upsert está escrito en la ruta y otra vez en la tool (una llamada cada una).
  - `cut-plan.ts` es "Pure mm math" sin BD, así que un helper de escritura iría en un `src/lib/material-presentations-store.ts` nuevo.
- **Quién la usa en la UI:** `useSavePresentation(orderId)`:
  - `CutPlanner`: al guardar la lista de corte registra las presentaciones capturadas con `Promise.allSettled`, y avisa con un warning si alguna falla;
  - `MaterialsManager` (`/dashboard/materials`): alta manual.

### `DELETE /api/material-presentations/[id]` — `src/app/api/material-presentations/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** solo el `id` del path.
- **Qué hace:** delete por id con `.select('id')`. Si borró 0 filas → 404 "Medida no encontrada"; si no, responde `{ deleted: id }`.
- **Reglas y efectos secundarios:** es seguro, porque `cut_plan_pieces` no referencia presentaciones. Los planes existentes no cambian: la medida solo deja de sugerirse en los planes futuros. Es la única ruta de borrado de este grupo que sí responde 404 con un id inexistente.
- **Dónde vive la lógica:** inline (trivial).
- **Quién la usa en la UI:** `useDeletePresentation` → `MaterialsManager`, con AlertDialog "¿Eliminar esta medida?".

> No hay `PATCH`: "cambiar" una medida es borrarla y registrar la correcta.

## Cobertura MCP actual

- **`get_cut_plan`** (lectura, por orden): por cada grupo de diámetro o espesor de la orden, muestra las presentaciones de esa medida con barras u hojas y sobrante. **No lista el catálogo completo.** Aun así, `tests/mcp/coverage.test.ts` mapea `GET /api/material-presentations` a esta tool, así que esa cobertura es parcial.
- **`save_material_presentation`** (escritura, **no** `adminOnly`):
  - Parámetros: `tipo` (`tubo | placa`), `diametro_mm?`, `espesor_mm?`, `ancho_mm?`, `largo_mm`, todos positivos.
  - Pasa por `parsePresentationInput`. Antes del upsert busca por la misma llave (`.is(col, null)` para los NULL) para responder `ya_existia` o `registrada`.
  - La descripción pide convertir pulgadas (×25.4) y metros, y confirmar la conversión con el usuario.
  - No borra. La respuesta dice "una medida errónea se borra en la app".
- **No puede hoy:** borrar una medida, ni listar todas las registradas.

## Casos de uso desde el chat

1. "Agrega barra de tubo de 1 pulgada de 6 metros" → `POST` con 25.4 × 6000 (ya existe).
2. "El proveedor maneja hojas de placa de 3 mm de 1.22 × 2.44 m" → `POST` de placa con 3 / 1220 / 2440 (ya existe).
3. "Borra la barra de 25.4 × 600, la capturé mal: era de 6 metros" → `DELETE`, y luego `POST` con 6000.
4. "Ya no nos venden barras de 3 m de media pulgada, quítala" → `DELETE`.
5. "Cambia la hoja de 1200 × 2400 a 1220 × 2440" → `DELETE` + `POST` (no hay `PATCH`).
6. "¿Qué medidas de tubo tengo registradas?" → lectura. Hoy es un hueco: ninguna tool lista el catálogo.

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Registrar medida | bajo | Idempotente; catálogo que se arma solo; validación de forma compartida |
| Borrar medida | bajo | Nada la referencia; los planes existentes no cambian; se recaptura en un paso. El riesgo real es borrar la medida equivocada por un decimal de conversión |

## Propuesta de tools

**`save_material_presentation` (existe, se extiende)** — entidad: presentación del proveedor.
- Nuevo parámetro `quitar?: true`, con el precedente de `save_excused_day`.
- **Identifica la fila por las mismas medidas**, que son la llave UNIQUE, y no por id: el modelo nunca ve ids de presentaciones.
- Si no hay coincidencia exacta, error que lista las medidas registradas de ese tipo y ese diámetro o espesor. Así el modelo reintenta con el número exacto: un 1/3" convertido puede no cuadrar con lo guardado.
- Respuesta: "borrada" con la descripción legible (`describePresentation`).
- Confirmación: directo (riesgo bajo). La regla general de las instrucciones ya pide decir qué se va a escribir.
- `adminOnly`: sí, por la decisión de #155 (ver pregunta 1).
- Refactor: crear `src/lib/material-presentations-store.ts` con:
  - `savePresentation(db, row)`: el upsert más la detección de `ya_existia`, hoy repartida entre la ruta y la tool;
  - `deletePresentation(db, { id } | { key })`.

  `POST /api/material-presentations`, `DELETE /api/material-presentations/[id]` y la tool lo comparten.
- Costo: 0 tools; unos 100 caracteres más de descripción y esquema (estimado).

**Total del módulo:** 0 tools nuevas.

## Fuera a propósito

- Ninguna ruta del módulo queda fuera.
- No se expone `last_used_at` ni un "editar medida": la app no lo tiene, y editar es borrar y registrar.

## Preguntas abiertas

1. `save_material_presentation` hoy la recibe un member. ¿Pasa a `adminOnly`? En la app, cualquier sesión registra medidas al guardar una lista de corte.
2. Para borrar, ¿basta identificar la medida exacta (propuesta), o se quiere una lectura del catálogo completo? Con la app en 36/36, esa lectura tendría que fusionarse, por ejemplo con `get_cut_plan` sin `orden` listando el catálogo.
3. ¿Borrar por el MCP pide `confirmar`, como el diálogo de la app, o va directo? Propuesta: directo, porque la medida se recaptura en una llamada.
