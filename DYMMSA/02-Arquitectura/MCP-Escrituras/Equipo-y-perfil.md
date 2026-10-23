# MCP escrituras — Equipo y Mi perfil

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-026-Perfiles-y-Permisos-por-Rol]] · [[04-Decisiones-Tecnicas/ADR-032-Mi-Perfil-Auto-Edicion-y-NSS]] · [[02-Arquitectura/MCP-Escrituras/Nomina]]

## Resumen

`profiles` (1:1 con `auth.users`; la crea el trigger `handle_new_user` al registrarse, **ninguna ruta da de alta ni borra personas**), `profile_pay` (tarifa por hora, tabla solo admin) y el bucket `avatars`. Escriben dos frentes:

- **Mi perfil:** cualquier usuario con sesión, sobre su fila. Edita nombre y NSS, y sube o quita su foto.
- **Equipo:** solo el admin, sobre cualquiera. Edita nombre, rol, id del checador, jornada, área, NSS y tarifa.

**El MCP hoy solo lee** (`get_profiles`, sin `area` ni tarifa). Riesgo general **medio-alto**:
- El rol abre todo (Nómina, tarifas, el NSS de todos, la bitácora).
- El área cambia la regla del sábado en Nómina.
- El id del checador decide a quién se asignan las checadas del próximo import.

## Rutas que escriben

### `PATCH /api/profile` — `src/app/api/profile/route.ts`
- **Auth / rol:** `requireAuth()`, cualquier usuario con sesión (member incluido). RLS de `profiles`:
  - Policy "Users update own profile" (`id = auth.uid()`) y "Admins can update profiles" (`is_admin()`).
  - El trigger **`profiles_guard_admin_fields`** responde `42501` si alguien que no es admin (con `auth.uid()`) cambia `role`, `clock_employee_id`, `shift`, `is_owner` o `area`.
  - Para la fila propia quedan libres `display_name`, `nss` y `avatar_path`: **la policy dice lo mismo que la ruta** (ADR-026).
  - GRANT `SELECT, UPDATE` a `authenticated` (sin INSERT/DELETE), sin `anon`.
- **Entrada:** solo las llaves `display_name` y `nss`; cualquier otra → 400 "Solo puedes editar tu nombre y tu NSS…". Se validan con `parseDisplayName` (trim, 1–80) y `parseNss` (`null`/`""` lo borra; `normalizeNss` + `nssError`, dígito verificador Luhn). La BD respalda con los CHECK `nss ~ '^[0-9]{11}$'` y `display_name` 1–80.
- **Qué hace:** `update profiles … eq('id', auth.user.id)` → `select OWN_COLUMNS` (**sin tarifa**) + el email de la sesión.
- **Reglas y efectos secundarios:**
  - `display_name` es lo que ve todo el equipo, y también la llave de las búsquedas por nombre del MCP (`resolvePerson`).
  - Renombrar no reescribe los snapshots: `actor_name` en `audit_events`, y `closed_by_name`/`reopened_by_name` en Nómina.
  - El NSS es dato personal (ADR-032).
- **Dónde vive la lógica:** mixta. Los parsers están en `src/lib/profile.ts`; la lista de llaves permitidas y el update, inline.
- **Quién la usa en la UI:** `useUpdateOwnProfile` → `ProfileView` (`/dashboard/profile`).

### `POST /api/profile/avatar` — `src/app/api/profile/avatar/route.ts`
- **Auth / rol:** `requireAuth()`. Las policies de `storage.objects` limitan SELECT, INSERT y DELETE del bucket `avatars` a la carpeta `<auth.uid()>/`. El CHECK `profiles_avatar_own_folder` exige que `avatar_path` empiece con `<id>/`. Se sube **con el token del usuario**, nunca con service role.
- **Entrada:** `multipart/form-data` campo `file`, de hasta 2 MB. El tipo se valida **por los bytes** (`readImageInfo`: JPEG, PNG o WebP). Con EXIF/XMP → 400 (`hasMetadata`); la app la limpia antes con `cropAvatar` en el navegador, que la recorta a 256 px. Máximo 512 × 512.
- **Qué hace:**
  1. Lee el `avatar_path` actual.
  2. Sube a `avatars/<uid>/<uuid>.<ext>` (`upsert: false`).
  3. Guarda `avatar_path`; si eso falla, borra el archivo recién subido.
  4. Borra el archivo anterior (`removeQuietly`; si falla, solo un warning).
  5. Responde 201 `{ avatar_url }`.
- **Reglas y efectos secundarios:** la foto es pública por URL. Son dos escrituras (storage + fila) con compensación manual.
- **Dónde vive la lógica:** inline en la ruta, con helpers en `src/lib/avatar.ts` y `src/lib/image-info.ts`.
- **Quién la usa en la UI:** `useUploadAvatar` → `ProfileView`.

### `DELETE /api/profile/avatar` — `src/app/api/profile/avatar/route.ts`
- **Auth / rol:** `requireAuth()`; mismas policies de storage (solo la carpeta propia).
- **Entrada:** ninguna.
- **Qué hace:** lee el path; sin foto → `{ avatar_url: null }`. Si hay, pone `avatar_path` en `null` y borra el archivo (si el borrado falla, solo un warning).
- **Reglas y efectos secundarios:** vuelve a las iniciales.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useRemoveAvatar` → `ProfileView`.

### `PATCH /api/profiles/[id]` — `src/app/api/profiles/[id]/route.ts`
- **Auth / rol:** `requireAdmin()` (403). RLS de `profiles`: UPDATE `is_admin()` (el trigger no aplica a un admin); `profile_pay`: FOR ALL `is_admin()`, sin `anon` (review PR #137).
- **Entrada:** `id` no uuid → 404. El body es `ProfileUpdate`:
  - `display_name` (`parseDisplayName`)
  - `role` (`admin | member`)
  - `clock_employee_id` (entero ≥ 1 o `null`)
  - `shift` (`full_time | part_time | null`)
  - `nss` (`parseNss`)
  - `area` (`office | workshop`)
  - `hourly_rate` (`parseHourlyRate`: > 0 o `null`)

  Los enums y el checador se validan inline; sin cambios → 400.
- **Qué hace:**
  1. Lee `(id, role)` del perfil; si no existe → 404.
  2. **Guarda del último admin:** si degrada a `member` a un admin, cuenta los admins; si hay ≤ 1 → 400 "Debe quedar al menos un administrador".
  3. `update profiles` (`23505` → "Ese id de checador ya está asignado a otro usuario").
  4. `profile_pay`: upsert, o delete si la tarifa es `null` (sin fila = sin tarifa).
  5. Relee con `PROFILE_WITH_PAY_COLUMNS` → `presentProfile`.

  Son **dos escrituras sin transacción**: si falla la segunda → 500 "El perfil se guardó, pero la tarifa por hora no".
- **Reglas y efectos secundarios:**
  - **`role`:** cambia `is_admin()` y la RLS de inmediato. La lista de tools del MCP de esa persona sigue la identidad cacheada hasta 60 s (`TTL_MS` en `src/lib/mcp/oauth.ts`); la RLS manda desde el primer momento.
  - **`clock_employee_id`:** decide el mapeo del **próximo** import (`loadClockProfiles`). Quitarlo deja a la persona en `sin_perfil`; las checadas ya cargadas no se mueven.
  - **`shift`:** objetivo semanal, `dayStatus`, pago estimado de oficina.
  - **`area`:** selector de Mi semana, Resumen del equipo y **la regla del sábado en Nómina** para el empleado ligado (`payrollArea`). Como Nómina deriva al leer, **también recalcula cortes cerrados**.
  - **`hourly_rate`:** solo `officeWeekPay` (lo ve solo el admin).
  - La guarda del último admin vive **solo en la ruta**: ni la RLS ni el trigger la imponen.
  - **`is_owner` no tiene ruta** (se cambia por SQL). Ojo: el trigger solo frena a quien no es admin, así que un admin con su token por PostgREST sí podría cambiarlo.
- **Dónde vive la lógica:** inline en la ruta (validación de enums, guarda, dos escrituras, mapeo de errores) con los parsers en `src/lib/profile.ts`. **Hay que extraerla** a `src/lib/profiles-store.ts` (p. ej. `updateProfileAsAdmin(db, id, input)` con su `ProfileError`) antes de cablear una tool, o la tool perdería la guarda del último admin.
- **Quién la usa en la UI:** `useUpdateProfile` → `TeamTable` (Equipo, `/dashboard/hours/team`). El diálogo siempre manda nombre, rol, área, checador y jornada; NSS y tarifa solo si cambiaron.

## Cobertura MCP actual

| Tool | Tipo | adminOnly | Parámetros / límites |
|------|------|-----------|----------------------|
| `get_profiles` | lectura | no | `persona?`. Trae nombre, rol, dueño, jornada, id del checador, foto y NSS: **el NSS solo de quien pregunta en el listado, el de otro solo al pedirlo por nombre** (review PR #126). **No trae `area`** ni tarifa ni email |

Además, `save_payroll_employee` liga o desliga un **perfil** a un empleado de nómina (`perfil`), pero no edita el perfil.

**Lo que no puede hacer hoy:** ninguna escritura sobre `profiles` ni `profile_pay`. Ni el nombre o NSS propios, ni rol, checador, jornada, área o NSS de otros, ni la tarifa, ni la foto.

## Casos de uso desde el chat

1. "Mi NSS es 1234 56 7890 1, guárdalo." → `PATCH /api/profile` (o el camino admin sobre la fila propia).
2. "Cámbiame el nombre a 'Axl Guillén'." → `PATCH /api/profile`.
3. "Tania va a checar con el id 7." → `PATCH /api/profiles/[id]` `clock_employee_id`.
4. "Diego pasa a medio tiempo desde esta semana." → `PATCH /api/profiles/[id]` `shift`. Mueve objetivos y pago estimado; si Diego está ligado en Nómina, su jornada **de nómina** es otra columna (`save_payroll_employee`).
5. "Marco ahora es del taller." → `PATCH /api/profiles/[id]` `area`. Cambia el sábado en Nómina, incluso en cortes cerrados.
6. "Captura el NSS de Mariana: …" → `PATCH /api/profiles/[id]` `nss`.
7. "Haz administradora a Tania" / "Quítale lo admin a Luis." → `PATCH /api/profiles/[id]` `role` (guarda del último admin).
8. "Súbele la tarifa a Diego a $60 la hora." → `PATCH /api/profiles/[id]` `hourly_rate`. Hoy la decisión es que **no viaja por el MCP**.
9. "Quítame la foto." → `DELETE /api/profile/avatar`.

## Riesgo por operación

| Operación | Riesgo | Por qué |
|-----------|--------|---------|
| Nombre propio | bajo | Reversible; no reescribe snapshots |
| NSS propio | bajo | Validado con dígito verificador; dato propio |
| Nombre de otro | bajo | Reversible; cambia cómo lo encuentra el MCP por nombre |
| NSS de otro | medio | Dato personal dictado por chat; el Luhn ataja casi todos los errores de dedo |
| Id del checador | medio | Reasigna el próximo import; quitarlo deja checadas sin perfil |
| Jornada | medio | Objetivos semanales y pago estimado de la oficina |
| Área | medio | Cambia la regla del sábado de Nómina, también en cortes cerrados |
| **Rol** | **alto** | Escala privilegios (Nómina, tarifas, NSS de todos, bitácora); un mensaje inyectado en un documento podría pedirlo; la guarda del último admin solo está en la ruta |
| **Tarifa por hora** | **alto** | Dinero; decisión 2026-10-05 "no viaja por el MCP"; `profile_pay` se volvió admin-only justo para que no se filtre |
| Subir foto | — | Fuera (binario) |
| Quitar foto | bajo | Reversible subiendo otra; solo la propia (storage) |

## Propuesta de tools

**1 tool nueva + 1 cambio de lectura.**

1. **`save_profile` (NUEVA)**. Entidad: `profiles`; solo edita (las personas se crean al registrarse).
   - Parámetros:
     - `persona?` (sin ella = tú; con ella, `resolvePerson`, que **debería dar prioridad al nombre exacto** como `resolveEmployee` de Nómina)
     - `nombre?`
     - `nss?` (`null`/`""` lo borra)
     - `id_checador?` (entero ≥ 1 o `null`)
     - `jornada?` (`completa | media | ninguna`)
     - `area?` (`oficina | taller`)
     - Opcional, según las Preguntas 1 y 2: `rol?` (`admin | miembro`).
   - Patrón:
     - Nombre o NSS **propios** → **directo** (bajo).
     - Cualquier cambio a otra persona, o checador, jornada o área → **confirmar (medio)**: sin `confirmar` devuelve antes → después y los efectos ("cambia cómo se paga su sábado en Nómina", "el próximo reporte asignará el id 7 a…"); con `confirmar: true` escribe.
     - Si entra `rol` → **alto**: no permitir cambiar el propio rol por el MCP, conservar la guarda del último admin y exigir confirmación explícita. Se puede usar clave firmada si se adopta el firmador genérico de [[02-Arquitectura/MCP-Escrituras/Nomina]].
   - **Respuesta:** el NSS solo **enmascarado** (`maskNss`, últimos 4) para no dejar NSS completos en el historial del chat, coherente con "NSS solo bajo pedido por nombre".
   - `adminOnly: true` (decisión de #155). Consecuencia: un member **no** podrá editar su propio nombre o NSS por el MCP (ver Preguntas).
   - Refactor previo: `src/lib/profiles-store.ts`:
     - `updateProfileAsAdmin()` con la guarda del último admin, el update y el mapeo de `23505`. Debe incluir la escritura de `profile_pay` aunque el MCP no la exponga, para que la ruta la use completa.
     - `updateOwnProfile()` con la lista de llaves de Mi perfil.
     - Las dos rutas `PATCH` pasan a usarlas.
   - No se fusiona con `save_payroll_employee`: son tablas y reglas distintas. Ligar empleado ↔ perfil sigue allá.
2. **`get_profiles` (cambio de lectura, 0 tools):** añadir `area` (hoy el modelo no puede leer el valor que `save_profile` cambiaría). La tarifa sigue fuera.

**Presupuesto:** +1 tool en el bloque app.

## Fuera a propósito

- **`POST /api/profile/avatar` (subir foto):**
  - Un binario en base64 no cabe en una llamada del chat (mismo motivo que el `.xls`, ADR-035).
  - La ruta rechaza fotos con metadatos y la limpieza la hace el navegador (`cropAvatar`).
  - Storage solo deja escribir la carpeta propia: un admin no puede poner la foto de otro con su token.
- **`DELETE /api/profile/avatar` (quitar foto):** bajo riesgo, pero trivial en la app. Si se hiciera para **otra** persona, el admin podría vaciar `avatar_path`, pero el `remove()` del archivo fallaría por la policy de storage y quedaría huérfano. Si se incluye, solo para la foto propia (Pregunta 4).
- **`hourly_rate` (tarifa):** decisión 2026-10-05, "No viaja por el MCP" (changelog 2026-10, `profile_pay` admin-only tras review PR #137). Recomiendo mantenerla fuera de lectura y escritura.
- **`is_owner`:** sin ruta por diseño; se cambia por SQL bajando al anterior antes de subir al nuevo (índice único parcial).
- **Alta o baja de personas:** no hay ruta. El alta es el registro en Auth (`handle_new_user`) y borrar un usuario con checadas falla con `23503` a propósito.

## Preguntas abiertas

1. **Rol por el MCP:** ¿se incluye? Recomiendo **no** (alto, escalada de privilegios). Si se incluye: ¿nunca el propio, con confirmación explícita o clave firmada?
2. **Tarifa por hora:** ¿se mantiene la decisión del 2026-10-05 de que no viaja por el MCP? Recomiendo mantenerla.
3. **Mi perfil para members:** con todas las escrituras nuevas `adminOnly`, un member no puede guardar su nombre o NSS desde el chat. ¿Se acepta, o `save_profile` en modo "solo lo mío" sería la excepción (hoy members ya tienen escrituras como `create_task` o `save_supplier`)?
4. **Quitar la foto propia por el MCP:** ¿vale la pena o queda en la app?
5. ¿La guarda "al menos un administrador" debería bajar a la BD (trigger) para que ni PostgREST ni una tool futura la salten? Igual para `is_owner`, que hoy un admin puede cambiar con su token.
6. El área recalcula Nómina de cortes cerrados (ver [[02-Arquitectura/MCP-Escrituras/Nomina]]). ¿`save_profile` debe avisarlo o bloquearlo cuando la persona está ligada a un empleado con cortes cerrados?
