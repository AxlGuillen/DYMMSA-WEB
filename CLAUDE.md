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
- `approved_at TIMESTAMPTZ` — fecha/hora de aprobación; se sella al finalizar la aprobación (cliente) o al marcar `approved` manualmente; se muestra en `QuotationDetail`
- **Cambio manual de estado** (`PATCH /api/quotations/[id]/status`): el usuario puede mover la cotización entre `draft`/`sent_for_approval`/`approved`/`rejected` libremente desde el dropdown en `QuotationDetail` (preserva `is_approved`). El dropdown se deshabilita si hay cambios sin guardar (`isDirty`). **Cada cambio de estado regenera `approval_token`** → el link de aprobación compartido previamente queda muerto (404). `converted_to_order` NO es destino manual. Para **reabrir** una cotización convertida, su orden vinculada debe estar **eliminada** (si existe cualquier orden vinculada → 400); eliminar la orden restaura el inventario y garantiza ≤1 orden por cotización.
- **`is_approved` se preserva en `update` en cualquier estado** (no solo `approved`): al reabrir una cotización y agregar ítems nuevos, los ya aprobados se conservan (la página `/approve/[token]` los pre-selecciona) y el cliente solo decide los nuevos.

**`quotation_items`** — campos clave:
```
item_type: 'product' | 'separator'
is_approved: null (pendiente) | true | false
is_sold: null (sin definir) | true (lo vendemos) | false (no lo vendemos)  -- snapshot de etm_products.is_sold
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
location: TEXT  -- snapshot de store_inventory.location al crear la orden (gaveta)
```
Constraint implícito: `quantity_in_stock + quantity_to_order = quantity_approved`

**`etm_products`** — `etm TEXT UNIQUE`, `model_code TEXT`, `brand TEXT DEFAULT 'URREA'`, `is_sold BOOLEAN` (tri-estado; `null`=sin definir, `true`=lo vendemos, `false`=no lo vendemos — persistido por auto-learn)

**`store_inventory`** — `model_code TEXT UNIQUE`, `quantity INTEGER CHECK >= 0`, `location TEXT` (ubicación física/gaveta, texto libre opcional; **se conserva aunque `quantity=0`** — metadato duradero, no transaccional; solo se oculta en el frontend sin stock). Import Excel acepta columna `ubicacion` (alias `ubicación`/`location`/`gaveta`, case-insensitive); en modo `upsert` **no** pisa la existente si el archivo no la trae.

**`urrea_catalog`** — catálogo de URREA, **tabla aislada** (sin FK ni relaciones con el resto por ahora; no usada por flujos de cotización/orden). `code TEXT UNIQUE` (equiv. a `model_code`), `description TEXT`, `std INTEGER DEFAULT 1 CHECK > 0` (unidades por paquete), `price NUMERIC(12,2)`, `created_at/updated_at` (trigger `moddatetime`). Módulo en sidebar **URREA → Catálogo** (`/dashboard/urrea/catalog`). Import por Excel (`codigo, descripcion, std, precio`) en modo upsert (onConflict `code`) o replace.

---

## Reglas de negocio críticas

Estas reglas generan bugs si se ignoran al escribir código:

| Regla | Detalle |
|-------|---------|
| **Separadores excluidos de todo** | `item_type='separator'` nunca se incluye en: totales, auto-learn, conteos, is_approved, Excel URREA |
| **Productos "no lo vendemos" (`is_sold=false`)** | Tri-estado (`null` sin definir / `true` sí / `false` no). Solo `false`: excluido de totales (`calculateQuotationTotal`), Excel URREA/órdenes (`create-order`), y **exento de validación** (`quotation-validation` no exige precio/cantidad/ETM). En `/approve/[token]` se muestra "No disponible" (read-only, no aprobable). Se **persiste a `etm_products` vía auto-learn** solo si es explícito (`true`/`false`); `null` nunca pisa el catálogo. Helper: `isNotSold()` en `business-rules.ts`. |
| **Stock se deduce al CREAR la orden** | No al confirmar recepción. Cancelar restaura `quantity_in_stock`. |
| **Excel URREA** | Solo ítems: `item_type='product'` AND `brand='URREA'` AND `quantity_to_order > 0` |
| **Auto-learn** | Solo actualiza campos no vacíos. No asigna `brand='URREA'` si `model_code` está vacío. |
| **sort_order** | Al guardar cotización: `sort_order = index`. Al crear orden: re-asigna secuencialmente. Agregar ítem manual: `max(sort_order) + 1`. Siempre ordenar por `sort_order ASC`. |
| **Aprobación pública** | `/approve/[token]` sin auth. Si `status !== 'sent_for_approval'` → mostrar estado actual, no permitir re-aprobar. **Guardar avance** (`finalize=false`): persiste `is_approved` (aprobados=`true`, resto=`null`) **sin cambiar status** → el link sigue vivo y el cliente retoma después. **Enviar** (`finalize=true`): resto=`false`, status→`approved`/`rejected` + sella `approved_at`. Un popup confirma antes de enviar. Al quedar `approved` se **notifica a DYMMSA por correo** (Resend, aislado en try/catch → nunca revierte la aprobación; el total del correo se calcula de los **ítems aprobados**, no de `total_amount`; env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NOTIFICATION_EMAIL_TO`, `NEXT_PUBLIC_APP_URL`; ver ADR-012). |
| **Rollback** | Si falla inserción de ítems en `save` o `create-order` → eliminar el registro padre (quotation/order). |
| **Errores descriptivos** | Los route handlers mapean `PostgrestError` con `explainPgError()` → identifican el ETM ofensor y devuelven 400 (no 500) cuando es violación de regla del usuario. `auto-learn` aislado en su propio try/catch → si falla, la cotización ya está salvada (warning, no error). Ver `DYMMSA/04-Decisiones-Tecnicas/ADR-009-Errores-Descriptivos.md`. |

---

## Convenciones de código

- **Todo en inglés:** código, variables, nombres de BD, API routes.
- **TypeScript estricto.** Types centralizados en `src/types/database.ts`.
- **Hooks = TanStack Query + fetch a API Routes propias.** No llamar Supabase directo desde el cliente — ni lecturas ni CRUD. Wrapper compartido `fetchJson`/`ApiError` en `src/lib/fetch-json.ts`. Excepción legítima: `useAuth`/`login` usan el browser client para la sesión. **Migrados (2026-06-19):** cotizaciones (incl. lista/stats/detalle), inventario, catálogo URREA. **Pendientes (aún con lecturas directas):** `useOrders`, `useDashboard`, `useProducts` → migrar a su `GET /api/*` cuando se toquen.
- **API Routes:** usar `createClient()` de `@supabase/ssr` + verificar `auth.getUser()` al inicio.
- **Páginas:** Server Components por defecto; `"use client"` solo donde hay interactividad.
- **Zustand store:** `dymmsa-quotation-draft` en localStorage. Llamar `reset()` al guardar exitosamente.
- **Iconos:** importar desde `@/components/icons` (animados, `@animateicons/react`), **no** de `lucide-react` directo. El adaptador (`src/components/icons.tsx`) reexpone los nombres de lucide mapeados a su versión animada — o a una **relacionada** si la librería (248 iconos curados) no tiene el exacto — y traduce las clases `size-N`/`h-N` al prop `size`. Agregar un icono nuevo = añadir su export ahí.
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
| **Decisión técnica no obvia** | Crear `DYMMSA/04-Decisiones-Tecnicas/ADR-XXX-nombre.md` (último: ADR-011) |
| Nueva lógica de negocio o **route handler** | Agregar/actualizar su test en `tests/` (ver `ADR-007-Estrategia-Testing.md`) |
| **Fase completada** | Marcar ✅ en este CLAUDE.md + actualizar `DYMMSA/05-Fases/Fase-N.md` |
| **Nueva fase** | Crear `DYMMSA/05-Fases/Fase-N-Nombre.md` + agregar fila en tabla de arriba |
| Nuevo **enum o estado** | `DYMMSA/00-Inicio/Glosario.md` + tabla de BD en este CLAUDE.md |
| **Migración de BD** | `DYMMSA/06-Changelog/YYYY-MM.md` (fecha + migración + descripción + motivo) |
| **Cambio visible para el usuario** (feature/fix que el usuario nota) | `CHANGELOG.md` (raíz) en lenguaje simple — lo renderiza la página `/dashboard/changelog`. Formato: `## YYYY-MM-DD` → `### Nuevo\|Mejorado\|Corregido` → `- entrada`. La bóveda `06-Changelog/` sigue siendo el detalle técnico. |
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

**Última actualización:** 2026-06-10  
**BD:** Supabase `wjlklwtvjewhtghlskbt` · PostgreSQL 17.6 · us-west-2  
**Filas (2026-04-25):** etm_products 564 · store_inventory 195 · quotations 9 · quotation_items 365 · orders 8 · order_items 182
