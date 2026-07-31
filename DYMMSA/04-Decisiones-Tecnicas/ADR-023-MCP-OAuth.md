# ADR-023 — MCP remoto con OAuth 2.1 nativo de Supabase

**Fecha:** 2026-07-31
**Estado:** Aceptado
**Relacionado:** [[ADR-015-MCP-Interno]] (supersede su capa de auth) · [[ADR-016-Health-Check]]

## Contexto

El MCP interno (ADR-015) autenticaba con un token compartido (`MCP_API_KEY`) y ejecutaba
todo con `service_role`. Funcionaba para Claude Code local, pero **no puede ser conector
personalizado en Claude web/móvil**: los conectores exigen OAuth 2.1 con discovery
RFC 9728. Se migró al patrón validado de punta a punta en el proyecto admin-home.

## Decisión

**MCP remoto por HTTP autenticado con el servidor OAuth 2.1 nativo de Supabase.**

1. **OAuth de Supabase, NO Auth0/terceros.** El `sub` del token de Supabase es el UUID
   del usuario → `auth.uid()` resuelve y RLS aplica sin tocar políticas. (El `sub` de
   Auth0 es `auth0|abc` → `auth.uid()` daría null y cero filas en silencio.)
2. **CERO `service_role` en el camino MCP.** Cada llamada construye su cliente con el
   token del request (`clientForToken`, opción `accessToken` de supabase-js). El MCP ve
   exactamente lo que ve la app. `verifierClient` (aparte, con ANON key) solo hace
   `auth.getUser(token)` — supabase-js reemplaza `.auth` por un proxy que lanza cuando
   se pasa `accessToken`, por eso son dos clientes.
3. **`verifyToken` cierra dos puertas** (no tres): `getUser(token)` contra GoTrue
   (autoritativo — revocación y expiración) → claim `client_id` presente (un token de
   sesión web NO abre el conector) y en el allowlist (`MCP_OAUTH_CLIENT_IDS`).
   **La puerta de tenant es N/A a propósito:** dymmsa es una sola empresa con proyecto
   Supabase propio, sin signup — ser usuario del proyecto ES ser staff. Si el proyecto
   se comparte o aparece multi-tenancy, esa es la puerta a agregar (ver admin-home).
4. **Caché de identidad indexada por hash SHA-256 del token** (TTL 60 s, máx 16,
   promesas — no cachea errores). Por construcción una entrada jamás sirve a otro token;
   test lo fija. **No hay caché de datos** que indexar: los tools consultan en vivo.
5. **`MCP_API_KEY` eliminado, sin dual-auth.** El token compartido no trae identidad →
   no puede construir `clientForToken`; mantenerlo obligaba a conservar service_role.
6. **RLS quedó intacta.** Las políticas son `TO authenticated USING (true)` en las 14
   tablas: el token OAuth pasa como cualquier sesión de la app. Sin aislamiento por
   usuario — igual que la app; si algún día se quiere, son políticas nuevas (solo 3
   tablas tienen `created_by`).
7. **Tools sin cambios de firma** (`fn(db, input)`): solo cambió quién fabrica el `db`
   (`contextFrom(extra.authInfo)` por llamada). `create_task` se conserva (ADR-015
   Fase 2): escribe en GitHub con el PAT del server, no en Supabase. Todas las demás
   llevan `annotations: { readOnlyHint: true }`.

## Flujo

```
Claude → POST /api/mcp (sin token) → 401 + WWW-Authenticate: resource_metadata=…
      → GET /.well-known/oauth-protected-resource → authorization_servers: [supabase/auth/v1]
      → OAuth con Supabase → redirige a /oauth/consent?authorization_id=…
      → (proxy: sin sesión → /login?next=…, conservando la query)
      → usuario autoriza (approveAuthorization) → Claude canjea código→token
      → POST /api/mcp con Bearer → verifyToken → clientForToken → tools con RLS
```

## Trampas incorporadas (costaron horas en admin-home)

1. Cliente OAuth con **Token Endpoint Auth Method = `client_secret_post`** (con `basic`,
   Supabase rechaza el canje 400 dentro de Supabase — invisible en logs de la app).
2. ~~overrides de mcp-handler~~ — N/A aquí: la SDK ya está pinneada a `1.26.0`, el peer
   exacto. (Si algún día se sube la SDK, ver el `overrides` de admin-home.)
3. `maxDuration` **literal** en el route handler (Next lo analiza estáticamente).
4. El proxy **excluye** `/api/mcp`, `/.well-known/*` y `/api/health` del matcher — un
   redirect a /login reemplazaría el 401 que los clientes necesitan para descubrir OAuth.
   `/oauth/consent` SÍ queda detrás del login.
5. El proxy y el login **conservan la query** (`?next=` con el `authorization_id`);
   `next` solo acepta rutas relativas (guard de open-redirect).
6. `src/lib/mcp/env.ts` valida `APP_URL` **al importarse** con error accionable; opcional
   con cascada `APP_URL → VERCEL_PROJECT_PRODUCTION_URL → localhost` (solo el origen).
7. `supabase-js` subido a `^2.110` — `auth.oauth.{getAuthorizationDetails,
   approveAuthorization, denyAuthorization}` no existen en 2.91.

## Módulo

- `src/lib/mcp/routes.ts` — MCP_PATH, PROTECTED_RESOURCE_PATH, mcpResourceUrl, supabaseAuthIssuer
- `src/lib/mcp/env.ts` — appUrl() + allowedClientIds(), validación al importar
- `src/lib/mcp/supabase.ts` — clientForToken / verifierClient (ANON key, jamás service_role)
- `src/lib/mcp/oauth.ts` — verifyToken + caché de identidad
- `src/lib/mcp/context.ts` — contextFrom(authInfo) → { db, userId, email, clientId }
- `src/app/api/[transport]/route.ts` — createMcpHandler + withMcpAuth (instructions = reglas de negocio)
- `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` — metadata RFC 9728 (catch-all)
- `src/app/oauth/consent/{page.tsx,actions.ts}` — consentimiento (detrás del login)
- Health: 3 checks nuevos (`oauth_server`, `protected_resource`, `mcp_unauthenticated` —
  este último atrapa fail-open y 401 mudos) → `degraded`, no `down`.

## Pasos manuales (dashboard, no código)

1. Supabase → Authentication → OAuth Server: ON, Authorization Path `/oauth/consent`, DCR OFF.
2. OAuth Apps: cliente `Claude`, redirect URIs exactos `https://claude.ai/api/mcp/auth_callback`
   y `https://claude.com/api/mcp/auth_callback`, auth method `client_secret_post`.
3. Vercel: `MCP_OAUTH_CLIENT_IDS` = Client ID; borrar `MCP_API_KEY` al validar.
4. Claude web: conector con Client ID + Secret. Claude Code: re-agregar sin header (OAuth).

## Testing

`tests/mcp/oauth.test.ts` (puertas + caché: TTL, revocación, no-cachear-errores, y el
test de aislamiento "la identidad de un token jamás se sirve a otro"),
`tests/mcp/context.test.ts`, health con fetch-router para los 3 checks nuevos (incluye
el caso fail-open: un 200 sin token reporta fail). Verificado en vivo (dev):
metadata en ambas variantes del catch-all, 401 con `resource_metadata`, health
detectando el toggle OAuth apagado (404 del discovery), y el redirect
consent→login conservando `authorization_id`.

## Consecuencias

- ✅ Conector personalizado en Claude web/móvil, revocable desde Supabase.
- ✅ El MCP deja de tener una llave que bypasea RLS; ve lo que ve la app.
- ✅ Identidad real por usuario en cada llamada (userId/email en el contexto).
- ⚠️ El servidor OAuth de Supabase está en beta (toggle del dashboard) — el health lo vigila.
- ⚠️ Sin el deploy no hay MCP (ya era cierto); el conector de Claude Code debe re-agregarse.
