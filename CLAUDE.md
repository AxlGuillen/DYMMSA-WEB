# DYMMSA — Sistema de Cotizaciones y Gestión de Inventario

Aplicación web para automatizar cotizaciones de DYMMSA (distribuidor URREA en Morelia, México).
Flujo: subir Excel del cliente → cotizador editable → aprobación por link → orden → inventario. 

> 📚 Documentación completa en la bóveda Obsidian: `DYMMSA/00-Inicio/README.md`

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS + shadcn/ui |
| Estado | Zustand (draft cotización) + TanStack Query (server state) |
| BD + Auth | Supabase (PostgreSQL 17.6) + @supabase/ssr |
| Excel | SheetJS (parse) + ExcelJS (generate) |
| Deploy | Vercel + Bun |

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Base de datos

Supabase project: `wjlklwtvjewhtghlskbt` · us-west-2 · RLS habilitado en todas las tablas.

### Tablas y estados críticos

**`quotations`** — status CHECK:
```
draft | sent_for_approval | approved | rejected | converted_to_order
```
- `canEdit = isDraft || isSentForApproval || isApproved` (Fase 5.5: cotizaciones aprobadas y en revisión son editables — permite ajustar precio/cantidad/entrega mientras el cliente revisa)
- Ítems nuevos agregados en estado `approved` → `is_approved = null` (pendiente); el usuario DYMMSA los aprueba/rechaza manualmente con los botones ✓/✗ en `QuotationDetail`
- `approval_token UUID UNIQUE` — se usa en `/approve/[token]` sin auth

**`quotation_items`** — campos clave:
```
item_type: 'product' | 'separator'
is_approved: null (pendiente) | true | false
delivery_time: 'immediate' | '2_3_days' | '3_5_days' | '1_week' | '2_weeks' | 'indefinite'
sort_order: INTEGER  -- preserva orden del array al guardar
```

**`orders`** — status CHECK (migración `20260409055423`):
```
ordered | received | delivered | completed | cancelled
```

**`order_items`** — campos clave:
```
item_type: 'product' | 'separator'
urrea_status: 'pending' | 'supplied' | 'not_supplied'
delivery_time: (mismo enum que quotation_items)
sort_order: INTEGER  -- preserva orden desde cotización; manual = max+1
quantity_approved, quantity_in_stock, quantity_to_order, quantity_received
```
Constraint implícito: `quantity_in_stock + quantity_to_order = quantity_approved`

**`etm_products`** — `etm TEXT UNIQUE`, `model_code TEXT`, `brand TEXT DEFAULT 'URREA'`

**`store_inventory`** — `model_code TEXT UNIQUE`, `quantity INTEGER CHECK >= 0`

---

## Reglas de negocio críticas

Estas reglas generan bugs si se ignoran al escribir código:

| Regla | Detalle |
|-------|---------|
| **Separadores excluidos de todo** | `item_type='separator'` nunca se incluye en: totales, auto-learn, conteos, is_approved, Excel URREA |
| **Stock se deduce al CREAR la orden** | No al confirmar recepción. Cancelar restaura `quantity_in_stock`. |
| **Excel URREA** | Solo ítems: `item_type='product'` AND `brand='URREA'` AND `quantity_to_order > 0` |
| **Auto-learn** | Solo actualiza campos no vacíos. No asigna `brand='URREA'` si `model_code` está vacío. |
| **sort_order** | Al guardar cotización: `sort_order = index`. Al crear orden: re-asigna secuencialmente. Agregar ítem manual: `max(sort_order) + 1`. Siempre ordenar por `sort_order ASC`. |
| **Aprobación pública** | `/approve/[token]` sin auth. Si `status !== 'sent_for_approval'` → mostrar estado actual, no permitir re-aprobar. |
| **Rollback** | Si falla inserción de ítems en `save` o `create-order` → eliminar el registro padre (quotation/order). |
| **Errores descriptivos** | Los route handlers mapean `PostgrestError` con `explainPgError()` → identifican el ETM ofensor y devuelven 400 (no 500) cuando es violación de regla del usuario. `auto-learn` aislado en su propio try/catch → si falla, la cotización ya está salvada (warning, no error). Ver `DYMMSA/04-Decisiones-Tecnicas/ADR-009-Errores-Descriptivos.md`. |

---

## Convenciones de código

- **Todo en inglés:** código, variables, nombres de BD, API routes.
- **TypeScript estricto.** Types centralizados en `src/types/database.ts`.
- **Hooks = TanStack Query + fetch a API Routes propias.** No llamar Supabase directo desde el cliente.
- **API Routes:** usar `createClient()` de `@supabase/ssr` + verificar `auth.getUser()` al inicio.
- **Páginas:** Server Components por defecto; `"use client"` solo donde hay interactividad.
- **Zustand store:** `dymmsa-quotation-draft` en localStorage. Llamar `reset()` al guardar exitosamente.
- **Sin comentarios obvios.** Solo comentar WHY cuando no es evidente.

---

## Testing

Runner único: **Vitest** (`vitest.config.ts`), dos entornos — `node` (backend) y `jsdom` (componentes React). Los tests viven en `tests/` (raíz del repo, espeja `src/`):

```
tests/
├── helpers/     # supabase-mock.ts + setup.ts (injectSupabaseServer) + factories.ts + request.ts
├── lib/         # funciones puras de src/lib/* (node, 104 tests)
├── api/         # route handlers reales con Supabase mockeado (node)
└── components/  # componentes React (jsdom + Testing Library)
    └── helpers/ # render (QueryClientProvider), stores (resetStores), fixtures
```

- **Comando:** `bun run test` (226 tests). Watch: `bun run test:watch`. Coverage: `bun run test:coverage`.
- ⚠️ **Usar `bun run test`, NO `bun test`** — `bun test` invoca el runner integrado de Bun y falla al toparse con imports de `vitest`.
- **Backend = unit con mock de Supabase** (sin BD real). El mock reproduce el query builder chainable y registra llamadas para assertions de auth, validación, rollback y side effects de inventario.
- **Patrón backend:** `vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))` + `injectSupabaseServer(() => activeClient)` (helper que registra el `beforeEach`; la variable se intercambia por test). `/approve/[token]` mockea `@/lib/supabase/admin`.
- **Componentes:** jsdom + Testing Library. Hooks de TanStack se mockean a nivel de módulo (`vi.mock('@/hooks/*')` → `{ mutateAsync: vi.fn(), isPending: false }`); los stores Zustand se resetean con `resetStores()`. DnD (drag&drop) y flujos completos quedan para E2E.
- **Al agregar/cambiar lógica de negocio o un route handler, agregar o actualizar su test.**

> 📚 Detalle y rationale: `DYMMSA/04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing.md`

---

## CI/CD y Code Review

### GitHub Actions — Claude PR Reviewer

**Workflow:** `.github/workflows/claude.yml`

Instalado en `main` el 2026-05-17. Claude revisa automáticamente cada PR abierto o actualizado contra las reglas de negocio críticas del proyecto.

**Triggers:**
- Automático al abrir o actualizar un PR
- `@claude` en comentarios para preguntas on-demand

**Modelo:** Claude Sonnet (default de Claude Code, via OAuth — sin costo adicional de API)

**Tres niveles de revisión:**
- 🔴 **Bloqueante** — violación de reglas de negocio, rutas sin `requireAuth()`, lógica de totales fuera de `business-rules.ts`, TypeScript `any`
- 🟡 **Advertencia** — lógica duplicada que debería ir en `src/lib/`, `formatCurrency` local, imports directos de Supabase desde cliente
- 🟢 **Sugerencia** — consistencia con el codebase, reutilización de utilidades existentes

**Secret requerido:** `CLAUDE_CODE_OAUTH_TOKEN` (guardado en GitHub Secrets del repo)

---

## Estado del proyecto

**Fase actual:** 6 — Mejoras y Optimización (en curso)

| Fase | Estado | Módulo principal |
|------|--------|-----------------|
| 0 — Setup | ✅ | — |
| 1 — Auth | ✅ | `src/hooks/useAuth.ts` |
| 2 — Catálogo ETM | ✅ | `src/app/api/products/` |
| 3 — Cotizador básico | ✅ | `src/components/quoter/` |
| 4 — Inventario | ✅ | `src/app/api/inventory/` |
| 5 — Flujo completo | ✅ | `src/app/api/quotations/` + `src/app/api/orders/` |
| 5.5 — Flexibilidad post-aprobación | ✅ | `src/app/api/orders/[id]/items/` |
| 6 — Mejoras UX | 🔄 | — |

---

## 🤖 Auto-mejora: instrucciones para Claude

> Obligatorio. Ejecutar automáticamente al final de cada cambio significativo.

### Qué actualizar en la bóveda (`DYMMSA/`)

| Evento | Archivo a actualizar |
|--------|---------------------|
| Nueva o modificada **ruta API** | `DYMMSA/02-Arquitectura/API-Routes.md` |
| Nueva **tabla o columna** en Supabase | `DYMMSA/02-Arquitectura/Base-de-Datos.md` (verificar con MCP Supabase) + este CLAUDE.md |
| **Decisión técnica no obvia** | Crear `DYMMSA/04-Decisiones-Tecnicas/ADR-XXX-nombre.md` (último: ADR-007) |
| Nueva lógica de negocio o **route handler** | Agregar/actualizar su test en `tests/` (ver `ADR-007-Estrategia-Testing.md`) |
| **Fase completada** | Marcar ✅ en este CLAUDE.md + actualizar `DYMMSA/05-Fases/Fase-N.md` |
| **Nueva fase** | Crear `DYMMSA/05-Fases/Fase-N-Nombre.md` + agregar fila en tabla de arriba |
| Nuevo **enum o estado** | `DYMMSA/00-Inicio/Glosario.md` + tabla de BD en este CLAUDE.md |
| **Migración de BD** | `DYMMSA/06-Changelog/YYYY-MM.md` (fecha + migración + descripción + motivo) |
| Cambio en **flujo de negocio** | `DYMMSA/01-Negocio/Flujo-Operacional.md` |
| Cambio en **estructura de carpetas** | `DYMMSA/02-Arquitectura/Estructura-de-Carpetas.md` |

### Reglas

1. **No inventar schema.** Si hay duda, usar MCP Supabase (`list_tables`, `execute_sql`) antes de documentar.
2. **Fechas absolutas** en changelog (`YYYY-MM-DD`), nunca relativas.
3. **Links Obsidian** entre notas relacionadas: `[[Carpeta/Nota]]`.
4. **Este CLAUDE.md es la fuente de verdad operacional.** La bóveda es el detalle. Si hay conflicto, CLAUDE.md tiene prioridad — y debe corregirse también.

### Formato changelog

```markdown
## YYYY-MM-DD 

**[Categoría]:** Qué cambió.
- Detalle
**Motivo:** Por qué.
```

---

**Última actualización:** 2026-05-17  
**BD:** Supabase `wjlklwtvjewhtghlskbt` · PostgreSQL 17.6 · us-west-2  
**Filas (2026-04-25):** etm_products 564 · store_inventory 195 · quotations 9 · quotation_items 365 · orders 8 · order_items 182
