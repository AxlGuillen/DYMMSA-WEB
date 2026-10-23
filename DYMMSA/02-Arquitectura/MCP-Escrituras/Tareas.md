# MCP escrituras — Tareas

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[04-Decisiones-Tecnicas/ADR-014-Modulo-Tareas-GitHub]] · [[04-Decisiones-Tecnicas/ADR-015-MCP-Interno]]

## Resumen

No hay tabla: las tareas **son** los GitHub Issues del repo (`GITHUB_REPO`), escritos con un PAT del servidor (`GITHUB_TOKEN`) desde `src/lib/github.ts` (ADR-014). Prioridad = label `priority:*`, estado = open/closed (`not_planned` = descartada), reporter = línea `Reportado por:` del body. Las rutas crean, editan (título, descripción, prioridad, estado), comentan y suben imágenes al bucket público `task-images`. El MCP ya escribe aquí desde 2026-07/08: `create_task` y `update_task` (comentar, priorizar, cerrar/reabrir; nunca título ni descripción). Riesgo general **bajo**: no toca dinero ni stock; lo delicado es reescribir texto humano.

## Rutas que escriben

### `POST /api/tasks` — `src/app/api/tasks/route.ts`
- **Auth / rol:** `requireAuth` (cualquier sesión). Sin RLS: la escritura va a GitHub con el PAT del servidor, así que el único permiso es tener sesión.
- **Entrada:** body `{ title, description?, priority? }`, validación inline. `title` con trim, obligatorio (400). `priority` inválida se **ignora** (sin label). `description` libre (markdown, puede traer imágenes ya subidas).
- **Qué hace:** `POST /issues` con `body = buildIssueBody(description, reporter)` (`Reportado por: <email>` + descripción) y `labels` (`priorityToLabel`) → 201 con `mapIssueToTask()`.
- **Reglas y efectos secundarios:** reporter = `user.email ?? 'DYMMSA'`. Errores por `handleGitHubError()`: el status de GitHub pasa tal cual (401 token vencido, 403 permisos/rate limit, 404, 422); sin configuración → 500; sin red → 503. Comparte el rate limit del PAT con todo el módulo (y con el MCP).
- **Dónde vive la lógica:** mixta — helpers en `src/lib/github.ts` (`fetchGitHub`, `buildIssueBody`, `priorityToLabel`, `isTaskPriority`, `mapIssueToTask`), validación inline.
- **Quién la usa en la UI:** `useCreateTask` → `src/components/tasks/TaskForm.tsx` (junto con la subida de imágenes).

### `PATCH /api/tasks/[number]` — `src/app/api/tasks/[number]/route.ts`
- **Auth / rol:** `requireAuth`; sin RLS (PAT).
- **Entrada:** `number` del path (entero ≥ 1 o 400) + body `{ title?, description?, priority?, state?, stateReason? }`. `title` string → trim, vacío → 400. `state` `open | closed`; al cerrar, `stateReason` `not_planned` o, por default, `completed` (al reabrir GitHub pone `reopened`). `description` string → reescribe el body. `priority`: `undefined` no toca; cualquier otro valor que no sea una prioridad válida (`null`, `''` **o un texto inválido**) **quita** la prioridad. Sin cambios → 400.
- **Qué hace:** si cambia descripción o prioridad, primero `GET /issues/{n}` para conservar el reporter original (`extractReporter`; si no hay, usa el email del usuario) y los labels que no son `priority:*`; luego `PATCH /issues/{n}`.
- **Reglas y efectos secundarios:** leer-y-escribir no atómico (dos ediciones simultáneas de labels: gana la última). Editar la descripción reescribe texto humano conservando la línea `Reportado por:`.
- **Dónde vive la lógica:** mixta. La mezcla de labels y el `state_reason` están **duplicados**: la ruta y `updateTask()` (`src/lib/mcp/tools/tasks.ts`) los implementan por separado (la tool es más estricta con la prioridad: un typo es error y `"none"` la quita).
- **Quién la usa en la UI:** `useUpdateTask` → `src/components/tasks/TaskDetail.tsx` (cerrar, descartar, reabrir, prioridad y editar título/descripción).

### `POST /api/tasks/[number]/comments` — `src/app/api/tasks/[number]/comments/route.ts`
- **Auth / rol:** `requireAuth`; sin RLS (PAT).
- **Entrada:** `number` (entero ≥ 1) + body `{ body }` (vacío tras trim → 400).
- **Qué hace:** `POST /issues/{n}/comments` con `buildIssueBody(body, user.email ?? 'DYMMSA')` → 201 con `mapComment()`.
- **Reglas y efectos secundarios:** todos los comentarios los crea el dueño del PAT; la autoría real va en `Reportado por:`. No hay ruta para editar ni borrar comentarios.
- **Dónde vive la lógica:** mixta (helpers en `github.ts`, validación inline).
- **Quién la usa en la UI:** `useCreateComment` → `TaskDetail`.

### `POST /api/tasks/upload` — `src/app/api/tasks/upload/route.ts`
- **Auth / rol:** `requireAuth`; sube con **service role** (`createAdminClient()`, bypassa RLS de Storage).
- **Entrada:** multipart `file`: MIME en whitelist (`image/png|jpeg|gif|webp`, si no → 400) y ≤ 5 MB (400).
- **Qué hace:** sube a `task-images/<uuid>.<ext>` (`upsert: false`) y devuelve `{ url }` pública para pegarla en el markdown.
- **Reglas y efectos secundarios:** bucket **público**; una imagen subida y no usada queda huérfana (no hay limpieza).
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useUploadTaskImage` → `TaskForm` (solo al crear; `TaskDetail` no sube imágenes al editar).

## Cobertura MCP actual

- **`list_tasks`** (lectura): `state` (`open | closed | all`), `priority`, `page` (30 por página); excluye PRs.
- **`get_task`** (lectura): `number` → tarea + todos los comentarios.
- **`create_task`** (escritura, `createTask()`): `title` (obligatorio), `description`, `priority` (inválida se ignora, igual que la ruta). Reporter **fijo** `"Asistente (MCP)"`.
- **`update_task`** (escritura, `updateTask()`, enmienda #72 de ADR-015): `task_number`, `comment`, `priority` (estricta; `"none"` la quita), `state` (`open` = reabrir | `closed`), `state_reason` (`completed` | `not_planned` = descartada). Publica primero el comentario y luego el `PATCH`, **sin rollback** a propósito. **Nunca** edita título ni descripción.
- Ninguna es `adminOnly` y ninguna usa el contexto: `run(extra, () => …)` ignora `ctx`, así que cualquier persona conectada (member incluido) escribe con el PAT compartido. El comentario de `src/lib/mcp/tools/tasks.ts` que justifica el reporter fijo ("el MCP no tiene usuario: el token es compartido") es anterior a ADR-023: hoy `ctx.email` y `ctx.userId` existen.
- **Ya cubierto** de lo que pide el issue: reabrir (`state: 'open'`) y descartar (`not_planned`). **Falta:** editar título/descripción (excluido por decisión) y adjuntar imágenes.

## Casos de uso desde el chat

1. "Registra una tarea: revisar los precios de Truper, prioridad alta." → `create_task` (ya existe).
2. "Comenta en la 45 que ya quedó y ciérrala." → `update_task` (comment + state, ya existe).
3. "Descarta la 52, era falso positivo." → `update_task` con `not_planned` (ya existe).
4. "Reabre la 45, volvió a pasar." → `update_task` con `state: open` (ya existe).
5. "Cámbiale el título a la 45: 'Precios de Truper en cotizador'." → `PATCH title` (hoy fuera del MCP).
6. "Agrega a la descripción de la 45 que también pasa con SURTEK." → `PATCH description` (reescribe el body; hoy fuera).
7. "Adjunta esta captura a la tarea." → `POST /upload` + editar descripción (hoy fuera).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Crear tarea | bajo | Un issue nuevo; se cierra si sobra |
| Comentar | bajo | Desde la app/MCP no se borra, pero no toca datos del negocio |
| Cambiar prioridad | bajo | Reversible; conserva labels ajenos |
| Cerrar / descartar / reabrir | bajo | Reversible |
| Editar título | medio | Reescribe texto humano |
| Editar descripción | medio | Reescribe texto humano; debe conservar `Reportado por:` (`extractReporter`) |
| Subir imagen | medio | Bucket público con service role; huérfanas sin limpieza; binario por chat |

## Propuesta de tools

**Ninguna tool nueva (0).** Lo que falta cabe en las dos existentes o se queda fuera:

- **`update_task` (existente)** — si el usuario lo decide (Pregunta 3), sumar `titulo` y `descripcion` con patrón **confirmar**: sin `confirmar: true` devuelve el texto actual y el nuevo y no escribe; con él, reescribe conservando el reporter como la ruta. Hoy está excluido por ADR-015 #72 ("reescribir texto humano es el riesgo que se evita").
- **Atribución:** usar la persona conectada (`ctx.email`, como la ruta usa `user.email`, o el `display_name`) en vez de `"Asistente (MCP)"`, p. ej. `Reportado por: tania@… (vía asistente)`. No suma tools.
- **`adminOnly`:** hoy no lo son. La decisión "toda escritura nueva es adminOnly" no las alcanza; volverlas admin le quitaría a un member algo que la app sí le da (reportar tareas). Ver Pregunta 1.
- **Store / refactor necesario:** `src/lib/tasks-store.ts` (o dentro de `github.ts`) con `buildTaskPatch(current, input)` (labels de prioridad + `state_reason` + reporter) y `createTaskIssue(input, reporter)`, compartidos por `PATCH /api/tasks/[number]`, `POST /api/tasks` y las tools. Al unificar, decidir qué regla de prioridad gana (la ruta quita la prioridad ante un texto inválido; la tool da error).
- **Fusión posible (presupuesto):** `create_task` + `update_task` → **`save_task`** (sin número = crear; con número = editar/comentar/cerrar) libera **1** lugar en el bloque app. ADR-034 regla 1 dejó las escrituras viejas con su nombre para no romper rutinas; con la app en 36/36 es la fusión más barata del grupo.

**Total del módulo:** **0 tools nuevas** (−1 si se fusiona en `save_task`).

## Fuera a propósito

- **`POST /api/tasks/upload`**: un archivo binario no viaja bien en una llamada del chat (mismo motivo que el `.xls` del checador, ADR-035), sube con service role a un bucket público y deja huérfanas. Las capturas se adjuntan en la app.
- **Editar título/descripción** se queda fuera mientras no se reabra la decisión de ADR-015 (Pregunta 3).
- Borrar issues o comentarios: no existe ni en la app.

## Preguntas abiertas

1. ¿`create_task`/`update_task` se quedan abiertas a members (como en la app) o pasan a `adminOnly` con el resto de las escrituras?
2. ¿Las tareas y comentarios del MCP se atribuyen a la persona conectada en vez de `"Asistente (MCP)"`?
3. ¿Se reabre la decisión de ADR-015 para editar título y descripción desde el chat (con confirmación)?
4. ¿Se fusionan `create_task` y `update_task` en `save_task` para liberar presupuesto?
5. ¿Imágenes fuera del MCP definitivamente?
