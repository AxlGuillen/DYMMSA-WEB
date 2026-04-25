# Stack Tecnológico

> Estructura de archivos: [[02-Arquitectura/Estructura-de-Carpetas]] · Esquema de BD: [[02-Arquitectura/Base-de-Datos]]

## Frontend

| Tecnología | Versión | Rol | Por qué |
|-----------|---------|-----|---------|
| **Next.js** | 16 (App Router) | Framework principal | SSR + API Routes en un solo proyecto; App Router para layouts anidados y Server Components |
| **TypeScript** | - | Lenguaje | Type safety en BD types, API payloads y componentes |
| **Tailwind CSS** | - | Estilos | Utilidad-first, sin CSS custom innecesario |
| **shadcn/ui** | - | Componentes UI | Componentes accesibles, sin overhead de librería pesada; se copian al repo |
| **Zustand** | - | Estado global | Estado del draft de cotización (ligero, sin boilerplate de Redux) — ver [[03-Modulos/Cotizador#Estado Zustand + localStorage]] |
| **TanStack Query** | - | Data fetching | Cache automático, loading/error states, invalidation por mutación — usado en todos los hooks de `src/hooks/` |

## Backend & Base de datos

| Tecnología | Rol | Por qué |
|-----------|-----|---------|
| **Supabase** | PostgreSQL + Auth + RLS | Backend completo sin servidor propio; RLS garantiza seguridad a nivel de BD |
| **Next.js API Routes** | Lógica de negocio server-side | Co-localización con el frontend; acceso seguro a Supabase con service role |
| **@supabase/ssr** | Auth server-side | Cookies correctas en App Router |

## Procesamiento de datos

| Librería | Rol |
|---------|-----|
| **SheetJS (xlsx)** | Parsear Excel del cliente (multi-hoja, detección columnas) |
| **ExcelJS** | Generar Excel URREA output (`.xlsx`) |

## Infraestructura

| Servicio | Rol |
|---------|-----|
| **Vercel** | Deploy del frontend Next.js |
| **Supabase Cloud** | BD + Auth · Region: us-west-2 · PostgreSQL 17.6 |
| **Bun** | Package manager + runtime (más rápido que npm/yarn) |
| **GitHub** | Control de versiones |

## Variables de entorno requeridas

```bash
NEXT_PUBLIC_SUPABASE_URL=       # URL pública del proyecto Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Clave anon (cliente)
# La service_role key se usa solo server-side via createClient() de @supabase/ssr
```
