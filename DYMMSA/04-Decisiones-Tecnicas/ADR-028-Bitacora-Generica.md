# ADR-028 — Bitácora genérica (`audit_events`) con visibilidad solo-admin real

**Fecha:** 2026-09-23
**Estado:** Aceptado
**Issue:** #100 · **Relacionado:** [[ADR-026-Perfiles-y-Permisos-por-Rol]] (`is_admin()`, tres capas), [[ADR-021-Testing-E2E-Supabase-Local]] (la única prueba real de RLS y triggers)

## Contexto

La issue #100 pide saber **quién marcó una factura como pagada** en Finanzas. Dos decisiones del usuario (2026-09-23) definieron el diseño:

1. **Bitácora completa, no solo "el último que la marcó"**, y que siente las bases para rastrear otros módulos después.
2. **Solo el admin la ve, y los members no deben saber siquiera que se guarda.**

La segunda descarta la solución obvia (columnas `paid_by`/`paid_marked_at` en `payables`): la policy de `payables` es "cualquier `authenticated`", y **cualquier usuario puede leer la tabla directo por PostgREST con su token** — ocultar la columna en la UI no oculta nada. El MCP lee con ese mismo token (ADR-023), así que la regla "la policy debe decir lo mismo que la ruta" (review PR #99) aplica al pie de la letra.

## Decisión

### 1. Una tabla genérica, no una por entidad

`audit_events (entity_type, entity_id, action, actor_id, actor_name, data jsonb, created_at)`. `entity_type = 'payable'` hoy; `'order'`, `'quotation'`… mañana son **un trigger más, no una tabla más**. `data` guarda `{ from, to }` en los cambios y el snapshot de la fila en `created`/`deleted`, así la bitácora sobrevive al borrado de la entidad.

### 2. RLS: solo lectura, solo admin, sin escritura desde la app

- `SELECT TO authenticated USING (public.is_admin())`.
- **Ninguna policy de INSERT/UPDATE/DELETE** para `authenticated` y `GRANT SELECT` solamente (sin `anon`). Un member recibe **0 filas** y `insufficient_privilege` si intenta insertar — verificado en la nube con `BEGIN … ROLLBACK`.
- `service_role` tiene `ALL` (tests de integración y mantenimiento).

### 3. Escribe un trigger `SECURITY DEFINER`, no la ruta

`audit_payable()` corre `AFTER INSERT OR UPDATE OR DELETE ON payables`, con `search_path = ''` y `REVOKE EXECUTE FROM PUBLIC` (mismo patrón que `handle_new_user`/`is_admin`). Tres razones:

- **Se registra aunque el cambio no pase por la API** (MCP, SQL, un script): el rastro no depende de que cada ruta se acuerde de escribirlo.
- **El member no ejecuta una escritura que le delate nada**: su `UPDATE payables` es el mismo de siempre; el evento lo inserta el owner de la función.
- **Identidad sin confianza en el cliente**: `actor_id = auth.uid()` sale del JWT, y `actor_name` es un **snapshot** de `profiles.display_name` leído como owner (el DEFINER salta la RLS de perfiles). Con `service_role` no hay `auth.uid()` → actor `NULL`, que la UI pinta como "Sistema".
- **`actor_id` sin FK a `profiles`** (migración `20260924034509`, review PR #106): con el FK, un JWT sin fila en `profiles` hacía fallar el `INSERT` de la bitácora **dentro del trigger** y tumbaba la escritura del usuario (23503 → 500). Una bitácora nunca debe fallar la operación que registra; `actor_name` ya es el rastro durable y `actor_id` queda informativo.

Solo se auditan **estado y fecha de pago** (`status_changed`, `paid_at_changed`) más `created`/`deleted`; editar concepto, monto o notas no genera evento. Es a propósito: lo que importa fiscalmente es cuándo y quién dijo "ya se pagó".

### 4. Tres capas, como en ADR-026

- **BD**: la policy `is_admin()`.
- **Ruta**: `GET /api/payables/[id]/events` con `requireAdmin()` (403). `GET /api/payables` anexa `paid_by` **solo si el llamador es admin** — para un member la respuesta **no trae la llave**, ni siquiera `null`: su shape es idéntico al de antes de #100.
- **UI**: la columna "Pagada por" y el "Historial" del popup existen solo con `useProfile().isAdmin`; la columna tampoco aparece en el picker de un member.

### 5. Qué NO es

No reemplaza el rastro `edited_by/edited_at/original` de `time_entries` (ADR-026 §7): aquel es parte del dato (el import lo respeta); esto es una bitácora aparte. Tampoco es auditoría de lectura.

## Consecuencias

- **Migraciones `20260924031216 add_audit_events`** (tabla, índice `(entity_type, entity_id, created_at DESC)`, RLS, función, trigger, GRANTs) y **`20260924034509 audit_events_actor_without_fk`**. `schema.sql` y el baseline actualizados en el mismo commit; `resetDb()` trunca `payables` y `audit_events`.
- **La única prueba real es `tests/integration/payables-audit.integration.test.ts`** (Docker): el trigger, el nombre del member en el evento, las 0 filas del member, el `INSERT` denegado y el 403. El mock no finge nada de eso. El workflow `integration.yml` la corre en CI cuando el PR toca `supabase/**` (#104).
- Sumar otra entidad: una función `audit_<entidad>()` con su trigger, escribiendo en la misma tabla con su `entity_type`; la ruta de lectura y la UI se copian del patrón de payables.
- Costo: un `INSERT` extra por cambio de estado y una consulta extra a `audit_events` por página de la lista **solo para admins** — y solo para las filas pagadas HOY: una factura regresada a pendiente conserva su evento viejo, y anexarlo diría "Pagada por" sobre una pendiente (review PR #106). Las dos lecturas desempatan por `id`, como el overview.
