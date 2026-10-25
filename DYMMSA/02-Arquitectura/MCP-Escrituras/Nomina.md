# MCP escrituras — Nómina

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-033-Nomina-Horas-por-Corte]] · [[02-Arquitectura/MCP-Escrituras/Horas]]
> **Actualización 2026-10-24 (#157):** la pregunta 4 se decidió por el snapshot. Cerrar congela `shift_snapshot`/`area_snapshot` en cada día del corte con la RPC `close_payroll_period` (snapshot antes del `closed`, en una transacción con el chequeo de borradores) y `reopen_payroll_period` los limpia; `buildPayrollView()` usa el snapshot cuando existe. La pregunta 5 también: cerrar un corte ya cerrado no re-sella. `setPeriodClosed` sigue recibiendo el nombre del actor desde la ruta. Los archivo:línea de abajo describen el código **anterior**.

## Resumen

Horas de nómina por corte sábado → viernes: `payroll_employees` (la lista propia; el taller no tiene cuenta), `payroll_days` (una fila por empleado y día; los estados `draft` y `confirmed`, con su origen `sheet`/`hours`/`manual`) y `payroll_periods` (el corte, que se abre y se cierra). Es **solo admin de punta a punta**: `requireAdmin` en las rutas, RLS `is_admin()` FOR ALL en las tres tablas y el trigger `payroll_days_guard_closed` (`23514`, también con service_role). Hoy el MCP **carga borradores** (`record_payroll_hours`, que también hace "Traer de Horas") y **administra empleados** (`save_payroll_employee`). **Le falta lo que vuelve las horas dinero:** corregir un día confirmado, borrar un día, confirmar borradores y cerrar o reabrir el corte. ADR-033 descartó expresamente que la tool confirme o cierre ("un 3.5 mal leído es dinero"), así que cablearlo exige revisar esa decisión. Riesgo general **alto**.

## Rutas que escriben

### `PUT /api/payroll/days` — `src/app/api/payroll/days/route.ts`
- **Auth / rol:** `requireAdmin()`. RLS `payroll_days` FOR ALL `is_admin()`. El trigger `guard_closed_payroll_period` rechaza con `23514` cualquier INSERT, UPDATE o DELETE de un día cuyo corte está cerrado.
- **Entrada:** `{ employee_id (uuid validado en la ruta), work_date (isIsoDate = isRealDate), worked_minutes (default 0), missed_minutes (default 0), note (string; si no, null) }`. `saveDays()` valida los minutos (`isDayMinutes`: entero de 0 a 1440), la nota (≤ 300) y que no haya duplicados.
- **Qué hace:**
  - **Día vacío** (0 trabajados, 0 no trabajados, sin nota): `DELETE` de `payroll_days` por (empleado, fecha), **inline en la ruta**. `23514` → 400 con el mensaje de Postgres. Responde `{ saved: 0, skipped: [], deleted: true }` aunque no existiera la fila.
  - **Si no:** `saveDays([day], { source: 'manual', status: 'confirmed', overwrite: true })` → `upsert onConflict employee_id,work_date`.
- **Reglas y efectos secundarios:**
  - `overwrite: true` pisa **cualquier** día (borrador de hoja, de Horas o confirmado) y lo deja `manual` + `confirmed`: **suma al total de inmediato**.
  - Con el corte cerrado, `saveDays` lanza `PayrollError` ("El corte que incluye el … está cerrado") antes del upsert; el trigger lo respalda.
  - `missed_minutes` y `note` sin enviar **se pisan** (0 y `null`). `saveDays` conservaría lo previo, pero la ruta manda los defaults.
  - Empleado inexistente (`23503`) → 400. **No revisa `active`**: la app puede capturar días de un empleado dado de baja; la tool `record_payroll_hours` los filtra.
- **Dónde vive la lógica:** mixta. El upsert está en lib (`saveDays`); el borrado del día vacío, inline. **Hay que extraer** el borrado o upsert completo a `payroll-store.ts` (p. ej. `saveTypedDay(db, day)`), con el corte cerrado como `PayrollError` antes del trigger, para que ruta y tool compartan la regla.
- **Quién la usa en la UI:** `useSavePayrollDay` → `PayrollDayDialog` (clic en una celda del corte).

### `POST /api/payroll/employees` — `src/app/api/payroll/employees/route.ts`
- **Auth / rol:** `requireAdmin()`; RLS `is_admin()`.
- **Entrada:** `parseEmployeeInput(body, { requireName: true })` (`payroll.ts`): `name` (1–80, espacios colapsados), `profile_id?` (uuid o null), `shift?` (`full_time | part_time`), `active?`.
- **Qué hace:** `createEmployee()` → insert → 201.
- **Reglas y efectos secundarios:** `23505` → `payrollDuplicateMessage()` (nombre o perfil ya ligado); `23503` → "El perfil ligado no existe"; `42501` → 400.
- **Dónde vive la lógica:** lib (`createEmployee` en `payroll-store.ts`), compartida con `save_payroll_employee`.
- **Quién la usa en la UI:** `useSavePayrollEmployee` → `PayrollEmployeesDialog`.

### `PATCH /api/payroll/employees/[id]` — `src/app/api/payroll/employees/[id]/route.ts`
- **Auth / rol:** `requireAdmin()`; RLS `is_admin()`.
- **Entrada:** `id` no uuid → 404. `parseEmployeeInput(body, { requireName: false })` devuelve solo las llaves presentes; sin cambios → 400.
- **Qué hace:** `updateEmployee()` → `update … maybeSingle()`; `null` → 404.
- **Reglas y efectos secundarios:** **sin DELETE a propósito**: la baja es `active = false` (FK de días sin cascade). **Cambiar `shift` o `profile_id` recalcula días ya guardados, incluso de cortes cerrados**: `buildPayrollView()` deriva el reparto normal/extra (jornada) y la regla del sábado (área del perfil ligado, `payrollArea`) **al leer**, y el candado solo congela `payroll_days`. Entre semana el equivalente no cambia (normal y extra son ×1); el sábado sí (taller: 5 h normales + resto ×2; oficina: todo normal).
- **Dónde vive la lógica:** lib (`updateEmployee`), compartida con `save_payroll_employee`.
- **Quién la usa en la UI:** `useSavePayrollEmployee` → `PayrollEmployeesDialog`.

### `PATCH /api/payroll/periods/[start]` — `src/app/api/payroll/periods/[start]/route.ts`
- **Auth / rol:** `requireAdmin()`; RLS `payroll_periods` FOR ALL `is_admin()`.
- **Entrada:** `start` (sábado real, `assertPeriodStart`; si no, `PayrollError` → 400) y body `{ closed: boolean }` (si no es booleano → 400).
- **Qué hace:** `setPeriodClosed(db, start, closed, auth.profile.display_name)`.
  - **Cerrar:** cuenta los borradores del corte; si hay alguno → 400 "Hay N días en borrador: confírmalos o bórralos antes de cerrar". Si no, `upsert payroll_periods { status: 'closed', closed_at, closed_by_name }`.
  - **Reabrir:** si el corte nunca se cerró, devuelve la fila actual (o una sintética abierta) **sin sellar nada**; si estaba cerrado, `{ status: 'open', reopened_at, reopened_by_name }`.
- **Reglas y efectos secundarios:** cerrar congela todos los días del corte (trigger). Los sellos son **snapshots de nombre**: ni ids ni `audit_events`. **Volver a cerrar un corte ya cerrado re-sella** `closed_at`/`closed_by_name` (reabrir sí es idempotente; cerrar no). Un error del upsert (incluido `42501`) cae como error genérico → 500.
- **Dónde vive la lógica:** lib (`setPeriodClosed` en `payroll-store.ts`). Para la tool falta el nombre del actor: `McpIdentity` trae `userId`, `email`, `clientId` y `role`, **sin `display_name`** → hay que leerlo de `profiles`.
- **Quién la usa en la UI:** `useSetPayrollClosed` → `PayrollView` (botones "Cerrar corte", deshabilitado con borradores, y "Reabrir corte"; **sin diálogo de confirmación**).

### `POST /api/payroll/periods/[start]/confirm` — `src/app/api/payroll/periods/[start]/confirm/route.ts`
- **Auth / rol:** `requireAdmin()`; RLS `is_admin()`.
- **Entrada:** solo `start` (sábado).
- **Qué hace:** `confirmDrafts()` → `update payroll_days set status = 'confirmed' where status = 'draft' and work_date in [sábado..viernes]` → `{ confirmed: N }`.
- **Reglas y efectos secundarios:** confirma **todos** los borradores del corte de una vez (hoja, Horas y sábados de oficina), sin distinguir empleado ni día; la app no tiene confirmación parcial. Una vez confirmados, las cargas automáticas ya no los pisan (vuelven en `skipped` con "ya está confirmado") y empiezan a sumar. `23514` → 400 (en la práctica un corte cerrado no tiene borradores).
- **Dónde vive la lógica:** lib (`confirmDrafts`).
- **Quién la usa en la UI:** `useConfirmPayroll` → `PayrollView` ("Confirmar borradores", **sin diálogo**).

### `POST /api/payroll/periods/[start]/prefill` — `src/app/api/payroll/periods/[start]/prefill/route.ts`
- **Auth / rol:** `requireAdmin()`; RLS `is_admin()` (además lee `time_entries` y `profiles`, que el admin ve completos).
- **Entrada:** solo `start`.
- **Qué hace:** `prefillFromHours()` toma los empleados **activos** ligados a un perfil, lee las áreas de esos perfiles y las checadas del corte, y luego:
  - **Oficina:** el sábado vale `max(checado, 8 h o 4 h)` con nota.
  - Un día con solo checadas abiertas **borra su propio borrador previo** (`source = 'hours'`, `draft`) y no crea nada.
  - Guarda con `saveDays(source 'hours', draft, overwrite false)` → `{ saved, skipped, open, linked, officeSaturdays }`.
- **Reglas y efectos secundarios:** nunca pisa lo confirmado, lo capturado a mano, lo de otro origen ni un corte cerrado (`skipped` con motivo). **Copia** los minutos: Nómina jamás lee `time_entries` en vivo (ADR-033).
- **Dónde vive la lógica:** lib (`prefillFromHours`), compartida con `record_payroll_hours traer_de_horas`.
- **Quién la usa en la UI:** `usePrefillPayroll` → `PayrollView` ("Traer de Horas").

## Cobertura MCP actual

| Tool | Tipo | adminOnly | Parámetros / límites |
|------|------|-----------|----------------------|
| `get_payroll_period` | lectura | sí | `fecha?`. Por empleado: días con horas, estado, origen y nota; totales normal/extra/sábado extra/domingo/equivalente. **Sin ids**; no dice si el empleado está activo ni a qué perfil está ligado |
| `record_payroll_hours` | escritura | sí | **A)** `dias[≤200] { empleado, fecha, horas 0–24, horas_no_trabajadas?, nota? }`: `resolveEmployee` (el exacto gana, sin acentos, `requireSingleMatch`, **solo activos**); rechaza 0 h + 0 no trabajadas; `saveDays(source 'sheet', draft, overwrite false)` → `omitidos` con motivo. **B)** `traer_de_horas` + `fecha?` → `prefillFromHours`. La descripción mide **2,443 de los 2,600** de su excepción (incluye `SHEET_GUIDE`) |
| `save_payroll_employee` | escritura | sí | `empleado?` (editar), `nombre`, `jornada completa\|media`, `perfil` (`resolvePerson`; `null`/`""` lo desliga), `activo` |

**Lo que no puede hacer hoy:**
- Confirmar borradores o cerrar/reabrir un corte.
- **Corregir un día confirmado**, capturado a mano o de otro origen (vuelve en `omitidos`).
- **Borrar un día**, ni siquiera el borrador de la hoja que la propia IA leyó mal.
- Capturar un día de un empleado inactivo (la app sí puede).

## Casos de uso desde el chat

1. "Esta es la hoja del taller de la semana, cárgala." → `record_payroll_hours.dias`. **Existe.**
2. "Trae las horas del checador al corte." → `prefill`. **Existe** (`traer_de_horas`).
3. "Da de baja a Luis" / "Liga a Tania con su perfil." → `PATCH employees/[id]`. **Existe.**
4. "Confirma los borradores de esta semana." → `confirm`. **Falta.**
5. "Cierra el corte del viernes." → `PATCH periods/[start] { closed: true }`. **Falta.**
6. "A Pedro el martes ponle 9.5, no 8." (día ya confirmado) → `PUT /api/payroll/days`. **Falta**: hoy vuelve como `omitido: ya está confirmado`.
7. "El jueves Pedro no vino, bórrale ese día." → `PUT` con día vacío. **Falta.**
8. "Leíste mal: el sábado de Juan eran 5, no 3; corrígelo antes de confirmar." → borrador de hoja que solo `record_payroll_hours` re-escribe con el mismo origen. **Existe a medias**: si el día ya vino de Horas o se capturó a mano, se omite.
9. "Reabre el corte pasado, a Juan le faltó el domingo." → `PATCH { closed: false }` + `PUT`. **Falta.**

## Riesgo por operación

| Operación | Riesgo | Por qué |
|-----------|--------|---------|
| Cargar hoja como borrador | bajo | No suma hasta confirmar; nunca pisa lo confirmado; lo omitido vuelve con motivo |
| Traer de Horas | bajo | Borrador; nunca pisa confirmado ni manual; idempotente |
| Alta/edición/baja de empleado | bajo (medio si cambia jornada o perfil ligado) | No borra nada; pero jornada y área se aplican al leer y mueven el equivalente del sábado **también en cortes cerrados** |
| Corregir un día (sobrescribe + confirma) | medio | Suma de inmediato y pisa lo que trajo la hoja o Horas; es un valor por celda dicho por el admin; un corte cerrado lo bloquea |
| Borrar un día | medio | Quita horas de un empleado; reversible capturándolo otra vez; un corte cerrado lo bloquea |
| **Confirmar borradores** | **alto** | Convierte en horas pagables todo lo que leyó la IA de un escaneo; es el paso humano que ADR-033 dejó fuera del MCP a propósito |
| Cerrar corte | medio | Congela el corte (trigger), exige 0 borradores; se revierte reabriendo |
| Reabrir corte | medio | Descongela un corte posiblemente ya pagado; queda `reopened_by_name` (sin bitácora) |

## Propuesta de tools

**1 tool nueva + 1 cambio de lectura.**

1. **`save_payroll_period` (NUEVA)**. Entidad: el corte, es decir, lo que el admin hace en la pantalla de Nómina.
   - `accion: 'corregir_dia' | 'confirmar_borradores' | 'cerrar' | 'reabrir'` + `fecha` (cualquier día del corte; default el actual).
   - **`corregir_dia`** — `{ empleado, fecha, horas, horas_no_trabajadas?, nota?, borrar? }`, un día por llamada. Misma regla que la celda (`PUT`): sobrescribe y queda `manual` + `confirmed`; `borrar: true` borra la fila. Patrón **confirmar (medio)**: sin `confirmar` devuelve antes → después (estado, origen, horas) y el efecto en el total del empleado; con `confirmar: true` escribe. Resuelve **todos** los empleados, no solo activos, para poder corregir cortes de alguien ya dado de baja.
   - **`confirmar_borradores`** — patrón **vista previa (alto)**. Pide una `clave` firmada (HMAC) que **emite `get_payroll_period`** cuando el corte tiene borradores; esa es la fusión: el gemelo de lectura ya existe, no hace falta un `preview_*`. La clave se ata al admin, al corte, a la **huella del conjunto de borradores** (`id`, `worked_minutes`, `missed_minutes`, `updated_at`) y a una expiración. Si entre la lectura y la confirmación entró o cambió un borrador, no confirma nada. Opcional: una vista MCP Apps del corte con botón "Confirmar", como `time-report`.
   - **`cerrar` / `reabrir`** — patrón **confirmar (medio)**: sin `confirmar` devuelve el resumen (borradores pendientes, totales, quién lo cerró o reabrió); con `confirmar: true` escribe.
   - `adminOnly: true`.
   - Refactor previo:
     - `confirmDrafts(db, start, expected?)` debe confirmar **exactamente** los ids de la clave (`.in('id', ids).eq('status', 'draft')`) y comparar el conteo.
     - Extraer el borrado o upsert del `PUT` a `payroll-store.ts` (`saveTypedDay`).
     - `setPeriodClosed` necesita el `display_name` del actor (leerlo de `profiles` por `ctx.userId`) y debería volverse idempotente al re-cerrar.
     - Un **firmador genérico**: `src/lib/odoo/preview-token.ts` es específico de cotizaciones Odoo y **deriva su secreto de `ODOO_WRITE_API_KEY`**, que solo existe por ventanas (CLAUDE.md). Una clave de DYMMSA necesita su propio secreto de entorno, permanente.
   - **Tensión con ADR-034:** `corregir_dia` y `confirmar_borradores` escriben `payroll_days`, cuya tool es `record_payroll_hours`. Se agrupan aquí porque son acciones del corte y porque `record_payroll_hours` debe seguir siendo "solo borradores" (su descripción ya no tiene espacio: 2,443 / 2,600). Ver alternativas en Preguntas.
2. **`get_payroll_period` (cambio de lectura, 0 tools)**: que emita `clave_confirmacion` cuando hay borradores y que diga por empleado si está activo y a qué perfil está ligado.
3. **`record_payroll_hours` y `save_payroll_employee`:** sin cambios. Opcional: que `save_payroll_employee` avise cuando cambia la jornada o el perfil de alguien con cortes cerrados (ver hallazgo).

**Requiere un ADR** que revise ADR-033 §9 y su alternativa descartada "Que la tool confirme o cierre".

**Presupuesto:** +1 tool en el bloque app (36 → 37).

## Fuera a propósito

- **Borrar empleados:** no existe ni en la app (FK de días sin cascade; la baja es `active = false`).
- **Montos, tarifas o multiplicadores guardados:** "Horas, nunca montos"; el multiplicador se deriva de la fecha (ADR-033).
- **Editar `payroll_periods` directo** (sellos, `status` a mano): solo vía las acciones cerrar/reabrir.
- **Confirmación parcial** (por empleado o por día) como acción aparte: la app no la tiene. `corregir_dia` ya confirma una celda a la vez.

## Preguntas abiertas

1. ¿Se revierte ADR-033 ("que la tool confirme o cierre" fue descartado)? Si sí, ¿confirmar con clave firmada (alto) como propongo, o basta `confirmar: true`?
2. ¿Dónde va la corrección de un día confirmado?
   - (a) `save_payroll_period.corregir_dia`, como propongo: +1 tool en total.
   - (b) Extender `record_payroll_hours` con un modo `corregir`: 0 tools, pero rompe su promesa "solo borradores" y obliga a subir la excepción de 2,600 caracteres.
   - (c) Una tool aparte, `save_payroll_day`: +2 en total.
3. ¿Reabrir un corte es medio (como cerrar) o alto, porque puede estar ya pagado?
4. Cambiar la jornada o el área recalcula cortes **cerrados**. ¿Se acepta, o el cierre debe guardar un snapshot (jornada y área por empleado)? Es un cambio de BD fuera de #155, pero sube el riesgo de `save_payroll_employee` y del futuro `save_profile`.
5. ¿Re-cerrar un corte cerrado debe ser no-op (conservar quién lo cerró primero)?
6. ¿El MCP puede capturar días de empleados inactivos, como la app?
