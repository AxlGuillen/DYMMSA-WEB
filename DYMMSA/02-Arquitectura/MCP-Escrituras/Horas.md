# MCP escrituras — Horas

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[02-Arquitectura/MCP-Escrituras/Nomina]] · [[02-Arquitectura/MCP-Escrituras/Equipo-y-perfil]]

## Resumen

Checadas del NGTeco (`time_entries`, una fila por pareja), su bitácora de cargas (`time_imports`) y los días justificados (`excused_days`: feriados y salidas autorizadas). Todo lo que escribe es **solo admin**: rutas con `requireAdmin()`, y la RLS repite la regla con `is_admin()`. El MCP ya cubre casi todo: `save_time_entries` (reporte como filas transcritas + crear o corregir **una** checada) y `save_excused_day` (marcar, cambiar o quitar). **Lo único que falta es borrar una checada.** Riesgo general bajo: lo corregido guarda el rastro del checador y Nómina **copia** las horas (nunca las lee en vivo), así que una corrección aquí no mueve un corte ya confirmado.

## Rutas que escriben

### `POST /api/time-entries` — `src/app/api/time-entries/route.ts`
- **Auth / rol:** `requireAdmin()` (403 a un member). RLS `time_entries` INSERT `WITH CHECK (is_admin())`; GRANT `INSERT` a `authenticated`, sin `anon`.
- **Entrada:** `{ user_id, work_date, clock_in, clock_out?, note? }`. La ruta valida `user_id` con `isUuid`; el resto `createManualEntry()`: `isRealDate(work_date)`, `normalizeTime(clock_in)`, `parseClockOut()` (`''`/`null` = sin salida), salida ≥ entrada.
- **Qué hace:** un `insert` en `time_entries` con `source = 'manual'`, `source_clock_in = clock_in` y la nota recortada (vacía → `null`). Responde 201 con la fila normalizada a `HH:MM`.
- **Reglas y efectos secundarios:** `23505` (misma persona, día y entrada) → 400 "Ya existe una checada con esa entrada ese día"; `23503` → 400 "El usuario no existe"; `42501` → 403. **Si un reporte posterior trae la misma entrada, la RPC del import la reconcilia**: el `ON CONFLICT (user_id, work_date, source_clock_in) DO UPDATE … WHERE edited_at IS NULL` la pasa a `source = 'import'` y le pone la salida del reporte, porque una checada manual nunca sella `edited_at`. Lo dice el comentario de la ruta; CLAUDE.md no lo menciona.
- **Dónde vive la lógica:** lib, `createManualEntry()` en `src/lib/time-entries-store.ts`. La tool ya la usa.
- **Quién la usa en la UI:** `useCreateTimeEntry` → `TimeEntryForm` (Mi semana, cuando el admin ve a una persona).

### `PATCH /api/time-entries/[id]` — `src/app/api/time-entries/[id]/route.ts`
- **Auth / rol:** `requireAdmin()`. RLS UPDATE `is_admin()`.
- **Entrada:** `TimeEntryUpdate` = `{ clock_in?, clock_out?, note? }`. El `id` no se valida como uuid: uno malformado deja `current` en `null` y responde 404 (bien).
- **Qué hace:** lee la fila, arma solo los cambios enviados y valida la hora de entrada, la salida (`''` la quita) y la nota. Sin cambios → 400; salida antes de la entrada → 400. **Solo si cambió una hora** sella `edited_by` (`auth.profile.id`) y `edited_at`, y escribe `original = { clock_in, clock_out, note }` **únicamente si estaba vacío**. Después hace el `update` y devuelve la fila.
- **Reglas y efectos secundarios:** `source_clock_in` **nunca** se toca: es la llave de idempotencia del import (ADR-026). Con `edited_at`, el import la salta y la cuenta en `skipped_edited`. Una nota sola no sella nada, a propósito: así el checador todavía puede completar esa pareja. No cambia `work_date` ni `user_id`: para mover una checada hay que borrarla y registrarla de nuevo.
- **Dónde vive la lógica:** lib, `correctTimeEntry()` en `src/lib/time-entries-store.ts`. Ya está compartida con la tool.
- **Quién la usa en la UI:** `useUpdateTimeEntry` → `TimeEntryForm`.

### `DELETE /api/time-entries/[id]` — `src/app/api/time-entries/[id]/route.ts`
- **Auth / rol:** `requireAdmin()`. RLS DELETE `is_admin()`.
- **Entrada:** solo el `id` de la ruta. **No se valida como uuid**: uno malformado choca con `22P02` en Postgres y la ruta responde **500** en vez de 404 (la de `excused-days/[id]` sí valida).
- **Qué hace:** `delete().eq('id', id).select('id')`; si borra 0 filas → 404, si no `{ ok: true }`.
- **Reglas y efectos secundarios:** es un borrado duro y se lleva el rastro (`original`, `edited_*`). **Borrar una checada importada no dura**: al volver a subir ese reporte su llave ya no existe y la RPC la inserta otra vez. El diálogo de la app lo avisa ("Si el checador la vuelve a reportar, un nuevo import la restaura"). No toca Nómina: si esas horas ya se trajeron al corte, el día de nómina se queda como estaba (ADR-033).
- **Dónde vive la lógica:** inline en la ruta (tres líneas). **Para la tool hay que extraer `deleteTimeEntry(db, id)`** a `time-entries-store.ts`, con `isUuid` y `TimeEntryError('…', 'not_found')`.
- **Quién la usa en la UI:** `useDeleteTimeEntry` → `TimeEntryForm` (con `AlertDialog` "¿Eliminar esta checada?").

### `POST /api/time-entries/import` — `src/app/api/time-entries/import/route.ts`
- **Auth / rol:** `requireAdmin()`. La RPC `import_time_entries` (INVOKER) exige `is_admin()` (lanza `42501`), y `time_imports` acepta INSERT solo de `is_admin()`.
- **Entrada:** `multipart/form-data`, campo `file` de hasta 5 MB. `XLSX.read` toma la hoja `Employee Timecard` (o la primera) y `sheet_to_json` con `raw: false`.
- **Qué hace:** pasa las filas por `parseNgtecoReport(rows)` y luego por `importTimeReport()`. Esta exige período y bloques de empleado, mapea `(id)` → `profiles.clock_employee_id` (`loadClockProfiles`) y descarta con aviso las parejas con salida antes de la entrada. Luego llama la RPC: un upsert transaccional que salta lo editado y registra la carga en `time_imports` con `imported_by = auth.uid()`. Responde `{ period, inserted, updated, skipped_edited, unmapped, warnings }`.
- **Reglas y efectos secundarios:** es idempotente y los no mapeados no bloquean; `23514` → 400. La ruta **no** exige `reportMismatches()`, pero la tool sí (ADR-035: lo transcrito debe cuadrar con los totales del reporte).
- **Dónde vive la lógica:** lib (`parseNgtecoReport` en `timesheet.ts` + `importTimeReport` en `time-entries-store.ts`). Solo leer el binario queda en la ruta.
- **Quién la usa en la UI:** `useImportTimeEntries` → `TimeImportPanel` (`/dashboard/hours/import`).

### `POST /api/excused-days` — `src/app/api/excused-days/route.ts`
- **Auth / rol:** `requireAdmin()`. RLS INSERT `is_admin()` (UPDATE y DELETE también solo admin; SELECT: los del equipo, los propios o todos para un admin).
- **Entrada:** `parseExcusedDay()` (`timesheet.ts`): `work_date` real, `kind` `holiday | early_release`, `user_id` opcional (la ruta añade `isUuid`), `note` de hasta 200 caracteres.
- **Qué hace:** un `insert` → 201.
- **Reglas y efectos secundarios:** `UNIQUE NULLS NOT DISTINCT (work_date, user_id)` → `23505` → 400 descriptivo (persona o equipo); `23503` → 400. El de la persona gana sobre el del equipo (`excusesFor`). Solo cambia lecturas: `weekTargetMinutes`, `dayStatus` y el pago estimado de la oficina. No toca Nómina.
- **Dónde vive la lógica:** mixta. La validación vive en lib (`parseExcusedDay`); el insert y el mapeo de errores, inline. **La tool `save_excused_day` tiene su propia búsqueda, insert, update y delete inline** (`src/lib/mcp/tools/hours.ts`): son dos implementaciones de la misma regla.
- **Quién la usa en la UI:** `useCreateExcusedDay` → `ExcusedDaysPanel` (Equipo). **La app no puede editar** un día justificado (solo marcarlo o quitarlo); la policy UPDATE existe por la tool (review PR #138).

### `DELETE /api/excused-days/[id]` — `src/app/api/excused-days/[id]/route.ts`
- **Auth / rol:** `requireAdmin()`. RLS DELETE `is_admin()`.
- **Entrada:** `id`; si no es uuid → 404.
- **Qué hace:** `delete … select('id')`; 0 filas → 404.
- **Reglas y efectos secundarios:** ninguno fuera de la fila.
- **Dónde vive la lógica:** inline; la tool repite el delete (y revisa las 0 filas que deja la RLS).
- **Quién la usa en la UI:** `useDeleteExcusedDay` → `ExcusedDaysPanel`.

## Cobertura MCP actual

| Tool | Tipo | adminOnly | Parámetros / límites |
|------|------|-----------|----------------------|
| `get_week_hours` | lectura | no | `persona?` (`resolvePerson`), `fecha?`; trae días con estado, justificantes y checadas (entrada, salida, nota) |
| `get_hours_trend` | lectura | no | `persona?`, `semanas` 1–26 |
| `list_time_imports` | lectura | sí | `limit` ≤ 50 |
| `preview_time_report` | lectura (vista MCP Apps) | sí | `filas` ≤ 1000 × 20 celdas; tabla con botón "Guardar en Horas" |
| `save_time_entries` | escritura | sí | **A)** `filas` + `nombre_archivo?`: `parseNgtecoReport` → `reportMismatches` (si no cuadra, no guarda nada) → `importTimeReport`, archivo "Asistente (MCP): …". **B)** `checada { persona? (default: tú), fecha, entrada_actual?, entrada?, salida? ('' = sin salida), nota? ≤300 }`: sin `entrada_actual` usa `createManualEntry`; con ella busca la checada por su entrada actual (`find`) y usa `correctTimeEntry` |
| `save_excused_day` | escritura | sí | `fecha`, `tipo? feriado\|salida_autorizada`, `persona?` (sin ella = equipo), `nota? ≤200`, `quitar?`; busca por (fecha, persona\|null): crea, **actualiza** (tipo y nota) o borra |

**Lo que no puede hacer hoy:**
- Borrar una checada.
- Mover una checada a otra fecha o persona (la app tampoco).
- Subir el `.xls` como archivo (fuera a propósito, ADR-035).
- Elegir entre dos checadas del mismo día con la misma entrada: tras una corrección pueden repetir `clock_in` porque la UNIQUE es sobre `source_clock_in`, y `find` toma la primera sin avisar.

## Casos de uso desde el chat

1. "A Tania le faltó la salida del miércoles, salió a las 6." → `PATCH` (`save_time_entries.checada` con `entrada_actual`). **Existe.**
2. "Diego olvidó checar el lunes, entró 9:10 y salió 18:00." → `POST` (`checada` sin `entrada_actual`). **Existe.**
3. "Borra la checada duplicada de Luis del martes a las 8:02." → `DELETE`. **Falta.**
4. "Esa checada de las 13:00 de ayer no es de Ana, quítala." → `DELETE`. **Falta.** Si vino del checador, regresa al re-subir el reporte.
5. "La checada de las 8:00 del jueves de Ana era del miércoles." → `DELETE` + `POST`; no existe "mover". **Falta la mitad.**
6. "Aquí está el reporte del checador de la semana, cárgalo." → `preview_time_report` → `save_time_entries.filas` (= `POST import`). **Existe.**
7. "El 16 de septiembre es feriado para todos." → `save_excused_day` (= `POST excused-days`). **Existe.**
8. "A Mariana le di permiso de salir temprano el viernes." → `save_excused_day` con `persona`. **Existe.**
9. "Quita el feriado del lunes, al final sí se trabajó." → `save_excused_day quitar` (= `DELETE excused-days`). **Existe.**

## Riesgo por operación

| Operación | Riesgo | Por qué |
|-----------|--------|---------|
| Registrar checada a mano | bajo | Una fila nueva; el import la reconcilia; Nómina solo la copia como borrador |
| Corregir checada | bajo | Guarda lo que dijo el checador (`original`) y sobrevive al re-import; reversible |
| **Borrar checada** | **medio** | Borrado duro que pierde el rastro `original`/`edited_*`. Con una importada no dura (el re-import la restaura), y eso confunde si no se avisa. Con dos checadas iguales podría borrar la equivocada |
| Cargar reporte (filas) | medio | Muchas filas de golpe, mitigado: vista previa, obligación de cuadrar con los totales e idempotencia |
| Marcar, cambiar o quitar día justificado | bajo | Solo cambia el objetivo de lectura de la semana; no toca horas ni Nómina |

## Propuesta de tools

**0 tools nuevas en Horas.** Se extiende una y se refactoriza otra.

1. **`save_time_entries` — extender `checada` con `borrar: true`** (entidad: checada).
   - Parámetros: `checada { persona, fecha, entrada_actual, borrar: true, confirmar? }`. Propuesta: con `borrar`, `persona` es obligatoria (sin el default "tú") y `entrada_actual` también.
   - Patrón **confirmar (medio)**: la primera llamada sin `confirmar` no escribe y devuelve la checada encontrada (entrada, salida, origen `import`/`manual`, si fue corregida, lo que dijo el checador y la nota) más el aviso "si vino del checador, re-subir el reporte la restaura". La segunda, con `confirmar: true`, borra.
   - Refactor previo: `deleteTimeEntry(db, id)` en `time-entries-store.ts` (validación uuid + `not_found`), que la ruta `DELETE` también use. Cambiar el `find` de `savePunch` por `requireSingleMatch`; eso sirve también al corregir hoy.
   - `adminOnly` (ya lo es). La descripción mide 406 caracteres hoy; cabe en el tope de 1,000.
2. **`save_excused_day` — sin cambios funcionales**, con refactor recomendado: mover su lógica (buscar por fecha + persona, insertar, actualizar o borrar, mapear `23505`/`42501`/0 filas) a un store (`src/lib/excused-days-store.ts` o dentro de `time-entries-store.ts`), y que `POST`/`DELETE /api/excused-days` lo usen. Así la regla vive en un solo lugar y la app puede ganar "editar" sin tercera copia.
3. **Import:** sin cambios (ya comparte `importTimeReport`).

**Presupuesto:** +0 tools en el bloque app (sigue 36/36). Si otro grupo necesita espacio, aquí cabe una fusión de lectura: `get_hours_trend` → `get_week_hours` con `semanas` (misma persona, misma RLS, ambas para member). Libera 1 lugar.

## Fuera a propósito

- **El `.xls` como archivo binario por el MCP:** un archivo en base64 no cabe en una llamada del chat; va como filas transcritas (ADR-035).
- **Mover una checada** (cambiar `work_date`/`user_id`): ninguna ruta lo hace y `source_clock_in` es la llave del import. Se hace con borrar + registrar.
- **Editar `source_clock_in`, `original` o `edited_*`:** inmutables por diseño (ADR-026).
- **Borrar o editar la bitácora `time_imports`:** no hay ruta ni policy de UPDATE/DELETE.

## Preguntas abiertas

1. ¿Borrar una checada por el MCP con `confirmar: true` (medio, como propongo) o directo?
2. Con `borrar`, ¿`persona` obligatoria (sin el default "tú")?
3. Una checada importada que se borra vuelve con el re-import, igual que en la app. ¿Se acepta así o se quiere una marca de "descartada" que el import respete? Esa marca sería un cambio de BD, fuera de la Fase 0.
4. ¿Se extrae `save_excused_day` a un store y la app gana "editar" (`PATCH /api/excused-days/[id]`) para que app y MCP hagan lo mismo?
5. Si el bloque app necesita lugar, ¿se fusiona `get_hours_trend` en `get_week_hours`?
