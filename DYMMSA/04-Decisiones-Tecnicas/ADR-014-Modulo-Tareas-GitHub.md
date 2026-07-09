# ADR-014 — Módulo Tareas sobre GitHub Issues

**Fecha:** 2026-07-09
**Estado:** Aceptado

## Contexto

DYMMSA (2 personas: el desarrollador y el cliente/amigo) necesita un gestor de
tareas interno: crear tareas con nombre, descripción con imágenes y prioridad,
verlas y llevar un histórico, sin que el cliente salga de la app. Se quería
además ligar las tareas con las entradas de "Novedades".

## Decisión

**GitHub Issues del repo es la única fuente de verdad. No hay tabla en Supabase.**
El módulo Tareas es una interfaz delgada sobre la API de GitHub Issues.

| Concepto de la task | GitHub |
|---|---|
| Nombre | `title` del issue |
| Descripción (con imágenes) | `body` en markdown (imágenes embebidas `![](url)`) |
| Prioridad | Label `priority:low\|medium\|high\|highest` |
| Estado | `open` / `closed` |
| Quién reportó | Línea `Reportado por: X` al inicio del body (todos los issues los crea el token) |
| Histórico | Issues `closed` (filtro "Cerradas") |
| Comentarios | Comentarios nativos del issue |

### Por qué no una tabla + sync

Sincronización bidireccional (tabla ↔ Issues) es de los problemas más
traicioneros: conflictos, webhooks, borrados fantasma. El código de sync sería
más grande que el módulo. Con Issues como única fuente **no hay nada que
sincronizar**. Bonus: `fixes #N` en un commit cierra la task, y la actividad
queda en el perfil de GitHub del desarrollador.

### Imágenes: la única pieza con estado propio

GitHub **no** permite subir imágenes vía API (solo desde su UI). Se suben a un
bucket **público** de Supabase Storage (`task-images`, migración
`create_task_images_bucket`: 5 MB, PNG/JPG/GIF/WEBP) y la URL se embebe en el
markdown del issue. Público porque el proxy de imágenes de GitHub (camo) debe
poder leerla server-side; las rutas son UUID impredecibles. La subida usa el
service role (bypassa RLS); no se requieren políticas extra.

### Link con Novedades

La página de Novedades (`CHANGELOG.md`) convierte `#123` en un link a
`/dashboard/tasks/123` (parser en el render, sin schema). Así una entrada
"Corregido X (#45)" lleva a la task que lo originó.

## Arquitectura

- **`src/lib/github.ts`** — funciones puras (mapIssueToTask, buildIssueBody,
  extractReporter, priority helpers, isPullRequest) + `fetchGitHub()` (auth,
  headers, `GitHubError` con mensajes claros por status). La API de issues
  incluye PRs → se excluyen con `isPullRequest`.
- **Rutas** (todas con `requireAuth`): `GET/POST /api/tasks`,
  `GET/PATCH /api/tasks/[number]`, `POST /api/tasks/[number]/comments`,
  `POST /api/tasks/upload`. `handleGitHubError` traduce `GitHubError` a HTTP.
- **UI:** hook `useTasks` (TanStack), `/dashboard/tasks` (lista + filtros
  estado/prioridad + modal de creación con adjuntar imágenes),
  `/dashboard/tasks/[number]` (detalle + comentarios + editar/cerrar/reabrir).
- **Env:** `GITHUB_TOKEN` (fine-grained PAT, permiso Issues: Read/Write +
  Metadata: Read, solo este repo), `GITHUB_REPO` (`owner/repo`).

## Reglas / decisiones de scope

1. El **reporter** se antepone al body como `Reportado por: <email de sesión>`
   (creación y comentarios), ya que todo lo crea el token del repo.
2. En **PATCH** de descripción/prioridad se lee el issue actual para **conservar
   el reporter original** y no pisar labels ajenos a la prioridad (los labels de
   GitHub se reemplazan en bloque; se preservan explícitamente los no-prioridad).
3. **Falsos positivos → "Descartar", no borrar.** Un reporte equivocado se cierra
   como **`not_planned`** (`PATCH` con `state: closed, state_reason: not_planned`),
   distinto de "completada" (`completed`). Se muestra como badge **"Descartada"**.
   Ventajas sobre borrar: lo hace el cliente **desde la app** con el token mínimo
   (la API REST cierra pero **no borra**), es **reversible** (reabrir), sale de la
   vista "Abiertas" y conserva el rastro. El borrado real exigiría GraphQL + token
   con permiso **admin** → descartado por desproporcionado.
4. **Imágenes optimizadas en el cliente:** antes de subir se comprimen por canvas
   (máx 1600px, WebP q0.8) en `src/lib/image-compress.ts` — screenshots pasan de
   MB a ~100-200 KB. GIF se excluye (preservar animación); ante fallo, sube el
   original. Sin dependencias ni trabajo en el servidor.
5. **Limpieza de imágenes del bucket — DIFERIDA.** No hay auto-borrado. Con
   compresión, el storage es un no-problema (158 KB de 1 GB al lanzar). Un cron
   que borrara imágenes de issues cerradas rompería el histórico visual y añade
   infra desproporcionada hoy. **Pendiente:** una acción de limpieza en una futura
   **página de admin** (on-demand, borrar objetos no referenciados por ninguna
   issue), a construir sólo si el storage crece de verdad.
6. **Fuera de v1:** asignados, fechas límite, kanban, milestones, notificaciones,
   webhooks de sync en tiempo real (el refetch de TanStack basta).

## Trade-offs aceptados

- **Dependencia de GitHub:** si GitHub cae o el **PAT expira** (los fine-grained
  obligan expiración, máx ~1 año), el módulo muestra un error claro y se recupera
  al renovar el token. No hay copia local — es el precio de cero-sync.
- **Latencia:** cada carga consulta la API de GitHub (~300-800 ms), suavizada por
  el caché de TanStack. No es local-instantáneo.
- **Autoría:** todos los issues aparecen creados por el dueño del token; la
  autoría real va en `Reportado por:`.
