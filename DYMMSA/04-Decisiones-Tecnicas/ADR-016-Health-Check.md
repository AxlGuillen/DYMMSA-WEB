# ADR-016 — Health check público (`/api/health`)

**Fecha:** 2026-07-10
**Estado:** Aceptado · Implementado
**Relacionado:** [[ADR-014-Modulo-Tareas-GitHub]] · [[ADR-015-MCP-Interno]]

## Contexto

Queremos saber de forma automática que la aplicación funciona — no solo que el deploy
responde, sino que los **módulos de negocio operan por dentro** — consultando **un solo
endpoint**, y que el patrón sea **reutilizable en todos los proyectos** del equipo.

## Decisión

Un único endpoint **público** `GET /api/health` (`src/app/api/health/route.ts`,
lógica en `src/lib/health.ts`).

**Principio:** que el endpoint responda ya prueba que el deploy vive (no se auto-verifica
con self-fetch a páginas). Lo que aporta el body son **pruebas internas por módulo**:
ejecuta las mismas queries que sirven a la app — reutilizando las funciones compartidas
de los tools MCP (`listQuotations`, `listOrders`, `searchInventory`) — directo con el
admin client. No se hace self-fetch a `/api/quotations` etc. porque esas rutas exigen
sesión de Supabase y responderían 401; la llamada interna prueba lo mismo y más
(conexión, service role, schema, relaciones embebidas como `quotation_items(count)`).

### Contrato (estándar multi-proyecto)

```json
{
  "status": "ok | degraded | down",
  "app": "dymmsa-web",
  "version": "<sha corto del deploy o null>",
  "timestamp": "...",
  "checks": {
    "quotations": { "status": "ok", "latency_ms": 45 },
    "orders":     { "status": "ok", "latency_ms": 44 },
    "inventory":  { "status": "ok", "latency_ms": 43 },
    "storage":    { "status": "ok", "latency_ms": 30 },
    "github":     { "status": "ok | skip" }
  }
}
```

- **HTTP:** `ok`/`degraded` → 200 · `down` → 503 (cualquier monitor lo evalúa sin parsear).
- **`down`** si algún módulo de negocio (cotizaciones/órdenes/inventario) no puede operar.
  **`degraded`** por dependencias secundarias (Storage/imágenes, GitHub/Tareas). **`skip`**
  (dependencia no configurada, ej. GitHub en local) no penaliza.
- Cada check aislado en try/catch con timeout de 5 s — una dependencia caída no
  tumba a las demás ni al endpoint.

### Checks

| Check | Prueba | Peso |
|---|---|---|
| `quotations` | `listQuotations(pageSize:1)` — query real con embed de conteo | down |
| `orders` | `listOrders(pageSize:1)` | down |
| `inventory` | `searchInventory(pageSize:1)` | down |
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

`tests/lib/health.test.ts`: los checks de módulos se prueban con el mock de Supabase
del proyecto (las funciones reciben el cliente por parámetro), GitHub con fetch stub.
Cubre: latencia, fail sin detalle interno (respuesta gruesa), skip sin config, y la
agregación ok/degraded/down con checks aislados.

## Consecuencias

- ✅ Una URL (`https://dymmsa-web.vercel.app/api/health`) responde el estado completo,
  probando las queries reales de cada módulo.
- ✅ Contrato replicable: otro proyecto implementa el mismo shape y un solo monitor
  vigila a todos.
- ✅ Cero duplicación: los checks reutilizan las funciones de `src/lib/mcp/tools`.
- 🔜 Pendiente: vigilante externo con alerta como tarea; tool MCP `get_system_health`.
