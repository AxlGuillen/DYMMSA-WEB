# ADR-015 — MCP interno (lectura + primera escritura)

**Fecha:** 2026-07-10 · **Actualizado:** 2026-07-12 (Fase 2)
**Estado:** Aceptado · Fase 1 (lectura) ✅ · Fase 2 (`create_task`) ✅
**Relacionado:** [[ADR-007-Estrategia-Testing]] · [[ADR-009-Errores-Descriptivos]] · [[ADR-013-Descripcion-DYMMSA]] · [[ADR-014-Modulo-Tareas-GitHub]]

## Contexto

Queremos conectar Claude (Claude Code, Cowork, Claude Desktop) con los datos de la
plataforma para consultas en lenguaje natural: "¿qué cotizaciones esperan aprobación?",
"¿tenemos stock del 6954 y en qué gaveta?", "resume las órdenes pendientes con URREA".

## Decisión

Un **servidor MCP dentro de la misma app Next.js**, expuesto por Streamable HTTP en
`POST /api/mcp`, usando `mcp-handler` (adaptador de Vercel) + `@modelcontextprotocol/sdk`.

### Arquitectura

```
Cliente MCP (Claude Code / Cowork / Desktop)
   │  Streamable HTTP + Authorization: Bearer <MCP_API_KEY>
   ▼
src/app/api/[transport]/route.ts     ← auth ANTES de tocar el handler
   ▼
src/lib/mcp/server.ts                ← registro de tools (schemas Zod)
   ▼
src/lib/mcp/tools/*                  ← funciones puras (reciben el cliente Supabase)
   ▼
src/lib/* (business-rules, github, urrea-catalog) + Supabase admin client
```

Decisiones clave:

1. **Misma app, no proceso aparte.** Reutiliza toda la lógica de `src/lib`
   (totales, jerarquía de Descripción DYMMSA, `isNotSold`, cliente GitHub) sin
   duplicarla, y se despliega con el mismo push a Vercel.
2. **Los tools NO llaman a las rutas `/api/*` por fetch** (un cliente MCP no tiene
   sesión de Supabase). Usan el **admin client** (service role) y la autorización es
   la capa propia del MCP.
3. **Auth: token compartido** (`MCP_API_KEY`, Bearer) con comparación en tiempo
   constante. Sin la env var configurada el endpoint rechaza TODO — nunca degrada a
   sin-auth (crítico: el service role bypassa RLS). Somos pocos usuarios; un token por
   usuario u OAuth (necesario para conectores custom de claude.ai web) queda para
   una fase posterior.
4. **Escrituras aprobadas como dirección, incorporadas por nivel de riesgo.**
   Fase 1 fue 100% lectura. La Fase 2 (2026-07-12) abrió la escritura con
   `create_task`, elegida por ser la de menor riesgo — una task es un GitHub Issue
   (se cierra/borra trivialmente) y no toca el núcleo transaccional. **El mismo día
   el usuario decidió que el MCP tendrá herramientas de escritura como capacidad
   permanente**: ya no se requiere autorización caso por caso, pero cada tool nueva
   se agrega acotada, con tests, documentada aquí, y las que muten el núcleo
   transaccional (inventario, cotizaciones, órdenes) se diseñan con el usuario
   antes de implementarse.
5. **Ruta catch-all `[transport]`** la exige `mcp-handler`; con `basePath: '/api'` el
   endpoint queda en `/api/mcp`. SSE deshabilitado (`disableSse`) → no requiere Redis.
   Las rutas API estáticas existentes siempre ganan sobre el segmento dinámico.
6. **Respuestas resueltas y compactas**: los tools devuelven valores finales
   (Descripción DYMMSA ya resuelta con jerarquía, totales de `business-rules.ts`,
   ubicación oculta sin stock) para que el LLM no re-derive reglas de negocio.
   Además se expone el resource `dymmsa://reglas-negocio` con las reglas críticas.

### Tools (Fase 1 — lectura)

| Tool | Módulo |
|---|---|
| `get_business_summary` | Transversal (KPIs de todos los módulos) |
| `list_quotations` / `get_quotation` / `get_quotation_stats` | Cotizaciones |
| `list_orders` / `get_order` / `get_order_by_quotation` | Órdenes |
| `search_inventory` / `get_inventory_stats` | Inventario |
| `search_products` | Catálogo ETM (descripción resuelta, ADR-013) |
| `search_urrea_catalog` | Catálogo URREA (exacto normalizado → parcial) |
| `list_tasks` / `get_task` | Tareas (GitHub Issues, ADR-014) |

### Tools (Fase 2 — escritura)

| Tool | Módulo | Notas |
|---|---|---|
| `create_task` | Tareas (GitHub Issues) | Crea un issue. Espeja `POST /api/tasks` pero con reporter fijo `"Asistente (MCP)"` (el MCP no tiene sesión de usuario). `title` obligatorio; `description` y `priority` (`low\|medium\|high\|highest`) opcionales. Devuelve la task creada (#N + URL). |

La confirmación humana previa a la escritura recae en el **cliente MCP** (Claude pide
permiso antes de invocar la tool); el servidor solo valida y ejecuta. `create_task`
reutiliza `buildIssueBody`/`priorityToLabel` de `github.ts` — misma lógica que la ruta HTTP.

**Decisión 2026-07-12 — escrituras como capacidad permanente.** El MCP tendrá más
tools de escritura sin autorización caso por caso. Criterios para cada una: (a) acotada
a una operación concreta, (b) con tests, (c) documentada en esta tabla, (d) si muta el
núcleo transaccional (inventario, cotizaciones, órdenes) el diseño se acuerda con el
usuario antes de implementar. Orden natural de incorporación: por nivel de riesgo
(tasks → cotizaciones no destructivas → órdenes/inventario).

### Manejo de errores

`ToolError` (esperado: no encontrado, entrada inválida, error de BD con contexto) y
`GitHubError` devuelven su mensaje al cliente MCP con `isError: true`; cualquier otro
error se loguea y responde genérico — mismo espíritu que ADR-009.

### Conexión de clientes

```bash
claude mcp add --transport http dymmsa https://<dominio>/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

En Claude Desktop / Cowork: conector custom con la misma URL y header.

## Testing

`tests/mcp/` (proyecto `unit` de Vitest). Los tools reciben el cliente por parámetro →
se testean inyectando `createMockSupabase()` directo, sin `vi.mock`. GitHub se mockea
con `vi.spyOn(fetch)` como en `tests/api/tasks.test.ts`. Cubierto: auth (401,
sin-env-rechaza-todo), mapeos, filtros, reglas (totales excluyen separadores y
no-vendibles, ubicación oculta sin stock, jerarquía de descripción) y errores.

## Consecuencias

- ✅ Claude puede consultar todo el negocio con 13 tools de lectura + contexto de reglas.
- ✅ Claude puede **crear tareas** por lenguaje natural (`create_task`) — la primera
  escritura, deliberadamente la de menor riesgo.
- ✅ Cero duplicación de lógica; los tools son otra "vista" sobre `src/lib`.
- ⚠️ El token compartido es una sola llave para todo: rotarla si se filtra
  (cambiar `MCP_API_KEY` en Vercel) y jamás commitearla.
- ⚠️ `list_tasks`/`get_task`/`create_task` comparten el rate limit del PAT de GitHub.
- ⚠️ Las tasks creadas por el MCP quedan como reportadas por `"Asistente (MCP)"`
  (no por un humano) — es la marca para distinguirlas.
- 🔜 Pendiente (fases futuras): siguientes escrituras por nivel de riesgo (comentar/
  cerrar tasks, luego cotizaciones no destructivas, al final órdenes/inventario),
  OAuth para claude.ai web, auditoría de llamadas.
