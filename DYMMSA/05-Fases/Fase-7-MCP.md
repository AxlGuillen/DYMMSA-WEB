# Fase 7 — MCP interno

Conectar Claude (Code / Cowork / Desktop / **web y móvil**) con la plataforma vía un
servidor MCP propio. Decisiones y arquitectura en
[[04-Decisiones-Tecnicas/ADR-015-MCP-Interno]] (tools/escrituras) y
[[04-Decisiones-Tecnicas/ADR-023-MCP-OAuth]] (auth OAuth 2.1 de Supabase).

## Estado

| Sub-fase | Alcance | Estado |
|---|---|---|
| 7.0 — Infraestructura | Endpoint `/api/mcp` (Streamable HTTP), auth Bearer (`MCP_API_KEY`), conexión verificada | ✅ 2026-07-10 |
| 7.1 — Lectura total | 13 tools de lectura sobre todos los módulos + resource `dymmsa://reglas-negocio` | ✅ 2026-07-10 |
| 7.2 — Escrituras | Dirección aprobada (2026-07-12): el MCP tendrá escrituras, incorporadas por nivel de riesgo. Primera: `create_task` (GitHub Issue, reporter `"Asistente (MCP)"`). Siguientes: comentar/cerrar tasks → cotizaciones no destructivas → órdenes/inventario (estas últimas se diseñan con el usuario) | 🔄 2026-07-12 |
| 7.3 — OAuth 2.1 (conectores) | Migración a OAuth nativo de Supabase (ADR-023): `withMcpAuth` + `verifyToken` (GoTrue + allowlist `client_id`), cliente por-request con RLS (**cero service_role**), metadata RFC 9728, pantalla de consentimiento `/oauth/consent`, health con 3 checks OAuth. `MCP_API_KEY` eliminado. | ✅ 2026-07-31 (código; faltan pasos de dashboard) |
| 7.4 — Hardening | Auditoría de llamadas, rate limiting | ⏸️ |

## Archivos

- `src/app/api/[transport]/route.ts` — endpoint (`createMcpHandler` + `withMcpAuth`; instructions = reglas de negocio)
- `src/lib/mcp/oauth.ts` — `verifyToken` (puertas GoTrue + client_id/allowlist) y caché de identidad
- `src/lib/mcp/supabase.ts` — `clientForToken` (accessToken → RLS) / `verifierClient` (ANON key)
- `src/lib/mcp/context.ts` — `contextFrom(authInfo)` → db por request + identidad
- `src/lib/mcp/env.ts` — `appUrl()` (APP_URL → VERCEL_PROJECT_PRODUCTION_URL → localhost) + `allowedClientIds()`
- `src/lib/mcp/routes.ts` — MCP_PATH, PROTECTED_RESOURCE_PATH, mcpResourceUrl, supabaseAuthIssuer
- `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` — metadata RFC 9728
- `src/app/oauth/consent/` — consentimiento (detrás del login; conserva `?next=`)
- `src/lib/mcp/server.ts` — registro de tools (Zod, `readOnlyHint`) + resource de reglas
- `src/lib/mcp/tools/` — quotations, orders, inventory, products, urrea, tasks, summary
- `tests/mcp/` — oauth (puertas + caché + aislamiento), context, mapeos, reglas, `create_task`

## Cómo conectar

- **Claude web/móvil:** Configuración → Conectores → Agregar conector personalizado →
  URL `https://dymmsa-web.vercel.app/api/mcp` + Client ID/Secret (Advanced settings).
- **Claude Code:**

```bash
claude mcp add --transport http dymmsa https://dymmsa-web.vercel.app/api/mcp
# sin header: el flujo OAuth se dispara solo (login + consentimiento)
```

Pasos de dashboard pendientes de la migración (una vez): ver "Pasos manuales" en
[[04-Decisiones-Tecnicas/ADR-023-MCP-OAuth]].
