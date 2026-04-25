# Módulo: Autenticación

> **Stack:** [[02-Arquitectura/Stack#Backend & Base de datos|Supabase Auth + @supabase/ssr]]  
> **Archivos:** [[02-Arquitectura/Estructura-de-Carpetas#src/lib/supabase/|src/lib/supabase/]]

## Stack

- **Supabase Auth** con `@supabase/ssr` para manejo correcto de cookies en App Router.
- Dos clientes Supabase: `client.ts` (browser) y `server.ts` (server components / API routes).

## Rutas

| Ruta | Tipo | Descripción |
|------|------|-------------|
| `/login` | Pública | Formulario de login con email + password |
| `/dashboard/*` | Protegida | Requiere sesión activa |
| `/approve/[token]` | Pública | Sin auth — acceso por token UUID |

## Protección de rutas

El middleware de Next.js (`src/middleware.ts` o equivalente en layout) verifica la sesión con `createClient()` y redirige a `/login` si no hay usuario autenticado. Las rutas bajo `/dashboard/` están protegidas en el layout.

## Hooks

- `useAuth.ts` — expone `user`, `loading`, `signOut()`.
- `signOut()` muestra un dialog de confirmación (Navbar y Sidebar) antes de cerrar sesión.

## Archivos relevantes

- `src/lib/supabase/client.ts` — `createBrowserClient`
- `src/lib/supabase/server.ts` — `createClient` (async, para API routes y server components)
- `src/lib/supabase/admin.ts` — `createAdminClient` con service role (cuando es necesario bypassear RLS)
- `src/app/login/page.tsx` — UI de login
- `src/hooks/useAuth.ts` — hook de auth
