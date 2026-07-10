# Fase 7 — MCP interno

Conectar Claude (Code / Cowork / Desktop) con la plataforma vía un servidor MCP
propio. Decisiones y arquitectura en [[04-Decisiones-Tecnicas/ADR-015-MCP-Interno]].

## Estado

| Sub-fase | Alcance | Estado |
|---|---|---|
| 7.0 — Infraestructura | Endpoint `/api/mcp` (Streamable HTTP), auth Bearer (`MCP_API_KEY`), conexión verificada | ✅ 2026-07-10 |
| 7.1 — Lectura total | 13 tools de lectura sobre todos los módulos + resource `dymmsa://reglas-negocio` | ✅ 2026-07-10 |
| 7.2 — Escrituras | **Pendiente de definición** — el alcance de capacidades de escritura se decidirá con atención aparte | ⏸️ |
| 7.3 — Hardening | OAuth (claude.ai web), auditoría de llamadas, rate limiting | ⏸️ |

## Archivos

- `src/app/api/[transport]/route.ts` — endpoint (auth antes del handler)
- `src/lib/mcp/auth.ts` — token compartido, comparación en tiempo constante
- `src/lib/mcp/server.ts` — registro de tools (Zod) + resource de reglas
- `src/lib/mcp/tools/` — quotations, orders, inventory, products, urrea, tasks, summary
- `tests/mcp/` — 30 tests (auth, mapeos, reglas de negocio, errores)

## Cómo conectar

```bash
claude mcp add --transport http dymmsa https://<dominio>/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```
