# ADR-016 — Health check público (`/api/health`)

**Fecha:** 2026-07-10
**Estado:** Aceptado · Implementado
**Relacionado:** [[ADR-014-Modulo-Tareas-GitHub]] · [[ADR-015-MCP-Interno]]

## Contexto

Queremos saber de forma automática que la aplicación funciona — frontend, backend
y (hasta donde alcanza) infraestructura — consultando **un solo endpoint**, y que el
patrón sea **reutilizable en todos los proyectos** del equipo.

## Decisión

Un único endpoint **público** `GET /api/health` (`src/app/api/health/route.ts`,
lógica en `src/lib/health.ts`).

### Contrato (estándar multi-proyecto)

```json
{
  "status": "ok | degraded | down",
  "app": "dymmsa-web",
  "version": "<sha corto del deploy o null>",
  "timestamp": "...",
  "checks": {
    "database": { "status": "ok", "latency_ms": 45 },
    "storage":  { "status": "ok" },
    "github":   { "status": "ok | skip" },
    "pages":    { "status": "ok", "pages": { "/login": "ok", "/": "ok", "/dashboard": "ok" } }
  }
}
```

- **HTTP:** `ok`/`degraded` → 200 · `down` → 503 (cualquier monitor lo evalúa sin parsear).
- **`down`** solo por fallas que impiden operar: BD o páginas clave. **`degraded`** por
  dependencias secundarias (Storage/imágenes, GitHub/Tareas). **`skip`** (dependencia no
  configurada, ej. GitHub en local) no penaliza.
- Cada check aislado en try/catch con timeout de 5 s — una dependencia caída no
  tumba a las demás ni al endpoint.

### Checks

| Check | Prueba | Peso |
|---|---|---|
| `database` | Query real vía admin client + latencia | down |
| `pages` | Self-fetch: `/login`=200, `/` y `/dashboard` redirigen. **Un 200 en `/dashboard` sin sesión = fail** (guard de auth roto — detectarlo es un feature) | down |
| `storage` | Listar bucket `task-images` | degraded |
| `github` | `GET /rate_limit` con el PAT (no gasta cuota; detecta token vencido) | degraded |

### Por qué público (y sus dos guardas)

Los uptime monitors gratuitos no mandan headers, y "¿está viva la app?" no es
secreto. Guardas:

1. **Respuestas gruesas:** solo `ok/fail/skip` — nunca mensajes de error internos ni
   nombres de env vars. El porqué de un fail va al **server log** (`console.error`).
2. **Cache de 30 s en el edge** (`s-maxage=30, stale-while-revalidate=30`): un burst
   de hits ejecuta los checks una sola vez — el endpoint no es amplificador de carga.

### Límite honesto

El endpoint vive en el mismo deploy que la app: prueba *qué* funciona por dentro, pero
no puede avisar cuando **no responde en absoluto**. Para eso hace falta un vigilante
externo (cron de GitHub Actions / UptimeRobot apuntando aquí) — **fase pendiente**;
la idea registrada es que la alerta cree un issue `priority:highest` → aparece como
tarea del módulo Tareas automáticamente.

## Testing

`tests/lib/health.test.ts` (12 tests): checks individuales con stubs inyectados
(db, fetch), expectativas de páginas (incluido el caso "dashboard 200 sin sesión =
fail"), y agregación ok/degraded/down.

## Consecuencias

- ✅ Una URL (`https://dymmsa-web.vercel.app/api/health`) responde el estado completo.
- ✅ Contrato replicable: otro proyecto implementa el mismo shape y un solo monitor
  vigila a todos.
- 🔜 Pendiente: vigilante externo con alerta como tarea; tool MCP `get_system_health`.
