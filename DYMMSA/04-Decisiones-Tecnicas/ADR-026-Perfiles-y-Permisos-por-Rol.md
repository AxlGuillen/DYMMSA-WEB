# ADR-026 — Perfiles y permisos por rol (módulo de horas)

**Fecha:** 2026-09-08
**Estado:** Aceptado
**Issue:** #93 · **Relacionado:** [[ADR-021-Testing-E2E-Supabase-Local]] (la única prueba real de RLS), [[ADR-009-Errores-Descriptivos]]

## Contexto

Las horas de entrada/salida del equipo vivían solo en el reporte semanal del checador NGTeco (`NGTimereport-*.xls`). La issue #93 pide guardarlas como histórico consultable con dos niveles de acceso: **Diego y Axl ven a todos; los demás, solo lo propio**.

Hasta este módulo la app no tenía noción de rol ni de perfil: los 5 usuarios vivían solo en `auth.users` y **ninguna policy del esquema usaba `auth.uid()`** — todas eran "cualquier `authenticated`". Este es el primer permiso por persona del sistema.

Decisiones tomadas con el usuario (2026-09-08): el checador es la verdad (se importa su `.xls`, sin captura de rutina); solo admins corrigen y con rastro; roles y el mapeo checador↔usuario en una tabla `profiles`.

## Decisión

### 1. `profiles` 1:1 con `auth.users` (no `app_metadata`, no allowlist en código)

`profiles(id → auth.users CASCADE, display_name, role admin|member, clock_employee_id UNIQUE)`. Se descartó `app_metadata` (editable solo con service role, invisible para el resto del equipo, sin FK) y una allowlist de emails en env (no editable desde la app y sin lugar para el id del checador). Una tabla da al admin un lugar para cambiar rol y mapeo sin deploy.

### 2. Trigger `handle_new_user` que **bloquea el alta si falla**

`AFTER INSERT ON auth.users` → inserta el perfil (`display_name = COALESCE(full_name, display_name, email)`). Es `SECURITY DEFINER SET search_path = ''` con nombres calificados y `REVOKE EXECUTE FROM PUBLIC/anon/authenticated`: corre como `supabase_auth_admin`, que no tiene permisos en `public`, así que sin DEFINER **cualquier alta de usuario abortaría** ("Database error saving new user"). Que un fallo del trigger bloquee el alta es deliberado: mejor sin usuario que un usuario sin perfil que la app no sabe tratar. Backfill idempotente en la misma migración para los 5 existentes.

### 3. `is_admin()` como SECURITY DEFINER con `search_path` fijo

`sql STABLE SECURITY DEFINER SET search_path = ''` → `EXISTS (SELECT 1 FROM public.profiles WHERE id = (select auth.uid()) AND role = 'admin')`. El DEFINER evita la recursión (una policy de `profiles` que consulte `profiles`) y el `search_path` vacío cierra el vector clásico de las funciones DEFINER. Precedente en el repo: `urrea_catalog_brand_counts`.

### 4. Tres capas, ninguna sola

| Capa | Qué hace | Por qué no basta sola |
|---|---|---|
| RLS + `is_admin()` | SELECT `user_id = auth.uid() OR is_admin()`; escrituras `is_admin()` | El 403 del handler nunca la toca; es la red de seguridad real (MCP, SQL directo) |
| `requireAdmin()` en el handler | `requireAuth` + lee `profiles.role` → 403 descriptivo | Sin ella el member vería un 42501 críptico o un 500 |
| `useProfile().isAdmin` en el cliente | Oculta selector, ✎, sidebar admin | Solo UX; cualquiera puede llamar al endpoint |

**Regla:** un permiso por rol nunca se implementa solo ocultando en el frontend.

### 5. `source_clock_in` inmutable como llave de idempotencia

`UNIQUE (user_id, work_date, source_clock_in)`. Si la llave fuera `clock_in`, la primera corrección de un admin rompería el re-import y duplicaría la pareja original. `source_clock_in` guarda lo que dijo el checador (en captura manual, la hora capturada) y el PATCH jamás lo toca.

### 6. RPC transaccional `import_time_entries` (INVOKER) en vez de `.upsert()`

El `.upsert()` de supabase-js genera `DO UPDATE SET <todo>` sin `WHERE` y **pisaría las correcciones del admin** al re-subir la semana; `ignoreDuplicates` evitaría eso pero perdería una salida que el checador registró después; y escribir `time_entries` + `time_imports` en dos llamadas viola la regla de rollback. La RPC hace el `INSERT ... ON CONFLICT DO UPDATE ... WHERE edited_at IS NULL` en una transacción, cuenta insertadas/actualizadas con `xmax = 0` y reporta `skipped_edited`. Es `SECURITY INVOKER`: RLS e `is_admin()` aplican igual que desde la app (un member recibe 42501). Dedupe con `DISTINCT ON` por si el reporte repite una pareja.

### 7. Rastro de edición de una sola escritura

`edited_by`, `edited_at` y `original jsonb` (`{clock_in, clock_out, note}`) — `original` se escribe **solo la primera vez** y nunca se sobreescribe: conserva lo que dijo el checador, que es el dato de una disputa. Sin tabla de auditoría aparte en v1.

### 8. FKs y GRANTs

- `time_entries.user_id → profiles` **sin cascade** (borrar un usuario no borra nómina; mismo criterio que `payables → suppliers`). `edited_by` e `imported_by` → `SET NULL`.
- GRANTs explícitos a `authenticated` y `service_role`, **sin `anon`** — desviación deliberada del patrón del baseline: nada público lee estas tablas.
- Totales diarios/semanales **no se persisten**: los calcula `buildWeekView()` al leer.

## Consecuencias

- Primer módulo donde `bun run test:integration` es imprescindible antes de mergear a `main`: el mock no finge RLS.
- Los totales `HH:MM` pueden diferir ±1 min del reporte: el checador cuenta segundos que no imprime.
- Turnos nocturnos fuera (CHECK `clock_out >= clock_in`); captura de rutina, export a Excel y tools MCP quedan para después.
- El seed local gana un segundo usuario (`member@dymmsa.local`) y `resetDb()` nunca trunca `profiles` (van pegados a auth, que no se re-siembra).
