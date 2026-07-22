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
# Módulo Tareas (GitHub Issues como backend, ADR-014)
GITHUB_TOKEN=   # fine-grained PAT: Issues Read/Write + Metadata Read, solo el repo
GITHUB_REPO=    # owner/repo, ej. AxlGuillen/DYMMSA-WEB
# MCP interno (ADR-015) — token compartido; sin él el endpoint rechaza todo
MCP_API_KEY=
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
- `approved_at TIMESTAMPTZ` — fecha/hora de aprobación; se sella al finalizar la aprobación (cliente) o al marcar `approved` manualmente (solo si aún no existe → conserva la original). **Se preserva en cualquier fase posterior** (convertida, reabierta, etc.) — nunca se borra. Se muestra en `QuotationDetail` siempre que exista, sin importar el estado actual.
- **Cambio manual de estado** (`PATCH /api/quotations/[id]/status`): el usuario puede mover la cotización entre `draft`/`sent_for_approval`/`approved`/`rejected` libremente desde el dropdown en `QuotationDetail` (preserva `is_approved` **y `approved_at`**). El dropdown se deshabilita si hay cambios sin guardar (`isDirty`). **Cada cambio de estado regenera `approval_token`** → el link de aprobación compartido previamente queda muerto (404). `converted_to_order` NO es destino manual. Para **reabrir** una cotización convertida, su orden vinculada debe estar **eliminada** (si existe cualquier orden vinculada → 400); eliminar la orden restaura el inventario y garantiza ≤1 orden por cotización.
- **`is_approved` se preserva en `update` en cualquier estado** (no solo `approved`): al reabrir una cotización y agregar ítems nuevos, los ya aprobados se conservan (la página `/approve/[token]` los pre-selecciona) y el cliente solo decide los nuevos.

**`quotation_items`** — campos clave:
```
item_type: 'product' | 'separator'
is_approved: null (pendiente) | true | false
is_sold: null (sin definir) | true (lo vendemos) | false (no lo vendemos)  -- snapshot de etm_products.is_sold
dymmsa_description: TEXT  -- snapshot del valor RESUELTO al guardar (catálogo URREA ?? curada ?? null; ADR-013)
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
Constraint implícito: `quantity_in_stock + quantity_to_order = quantity_approved`. `quantity_received` **puede superar** `quantity_to_order` (el CHECK se eliminó 2026-07-16; el excedente entra a inventario — ADR-019).

**`order_purchase_decisions`** — decisión mayoreo/menudeo **por orden y por GRUPO** (ADR-018; nunca verdad global del producto):
```
model_code, brand: TEXT  -- SIEMPRE normalizados trim+upper; UNIQUE(order_id, model_code, brand)
std_snapshot, needed_qty: INTEGER  -- snapshot al decidir → staleness si cambian
packages_wholesale, qty_retail: INTEGER  -- pedido mixto; CHECK paq×std+retail >= needed
```
FK a `orders` con CASCADE. `PUT /api/orders/[id]/purchase-decisions` es **replace-all** (upsert antes del delete de removidas).

**`app_settings`** — key-value (`key TEXT PK`, `value JSONB`). **Sin seeds**: defaults en código (`purchase-plan.ts`); fila ausente → default. PATCH con **whitelist estricta** por key (`/api/settings`). Keys actuales: `purchase_threshold_money` (100), `purchase_threshold_pct` (0.8).

**`etm_products`** — `etm TEXT UNIQUE`, `model_code TEXT`, `brand TEXT DEFAULT 'URREA'`, `is_sold BOOLEAN` (tri-estado; `null`=sin definir, `true`=lo vendemos, `false`=no lo vendemos — persistido por auto-learn), `dymmsa_description TEXT` (curada por DYMMSA; **vacía si hay match en `urrea_catalog`** — la oficial gana jerarquía y se resuelve en lectura, nunca se copia; ADR-013)

**`store_inventory`** — `model_code TEXT UNIQUE`, `quantity INTEGER CHECK >= 0`, `location TEXT` (ubicación física/gaveta, texto libre opcional; **se conserva aunque `quantity=0`** — metadato duradero, no transaccional; solo se oculta en el frontend sin stock). Import Excel acepta columna `ubicacion` (alias `ubicación`/`location`/`gaveta`, case-insensitive); en modo `upsert` **no** pisa la existente si el archivo no la trae.

**`urrea_catalog`** — catálogo de URREA/multimarca, sin FK (cruce **por valor** con `model_code`). Identidad = **`UNIQUE(code, brand)`** (el mismo código puede existir en varias marcas: URREA maneja varias líneas). `code TEXT` (equiv. a `model_code`, **siempre normalizado trim+upper** en import/POST/PATCH — es la llave de cruce de la Descripción DYMMSA, ADR-013), `brand TEXT NOT NULL DEFAULT 'URREA'` (**normalizado trim+upper** con `normalizeCatalogBrand()`; consistente con `etm_products.brand`: `URREA`/`SURTEK`/`FOY`...), `description TEXT` (descripción **oficial**, jerarquía mayor que la curada), `std INTEGER DEFAULT 1 CHECK > 0` (unidades por paquete), `created_at/updated_at` (trigger `moddatetime`). RPC `urrea_catalog_brand_counts()` (conteo por marca para el filtro). Módulo en sidebar **URREA → Catálogo** (`/dashboard/urrea/catalog`) con filtro por marca. Import por Excel (`codigo, marca, descripcion, std`; sin `marca` → `URREA`) en modo upsert (onConflict `code,brand`) o replace. **Sin columna de precio** (no se usa). La Descripción DYMMSA cruza por `(code, brand)` con `catalogKey()` (ver regla crítica).

**`suppliers` / `brands` / `supplier_brands`** — módulo de proveedores de menudeo (issue #21, standalone). `suppliers`: contacto (`name UNIQUE`, phone, whatsapp, email, address, notes). `brands`: catálogo global de marcas, `name UNIQUE` **normalizado trim+upper** (`normalizeBrandTag()` — sin default URREA) para cruce futuro **por valor** con marcas de productos; sembrada con las existentes. `supplier_brands`: M2M — `supplier_id` CASCADE, `brand_id` **sin cascade** (eliminar marca en uso se bloquea con 400 + conteo). POST de supplier con links hace **rollback** del padre si fallan; PATCH de marcas es **replace por diff**.

**Supabase Storage** — bucket **`task-images`** (migración `create_task_images_bucket`): público, 5 MB, PNG/JPG/GIF/WEBP. Primera y única integración de Storage; lo usa el módulo Tareas para adjuntar imágenes a la descripción de un issue. Subida vía service role (bypassa RLS); rutas UUID.

---

## Reglas de negocio críticas

Estas reglas generan bugs si se ignoran al escribir código:

| Regla | Detalle |
|-------|---------|
| **Separadores excluidos de todo** | `item_type='separator'` nunca se incluye en: totales, auto-learn, conteos, is_approved, Excel URREA |
| **Productos "no lo vendemos" (`is_sold=false`)** | Tri-estado (`null` sin definir / `true` sí / `false` no). Solo `false`: excluido de totales (`calculateQuotationTotal`), Excel URREA/órdenes (`create-order`), y **exento de validación** (`quotation-validation` no exige precio/cantidad/ETM). En `/approve/[token]` se muestra "No disponible" (read-only, no aprobable). Se **persiste a `etm_products` vía auto-learn** solo si es explícito (`true`/`false`); `null` nunca pisa el catálogo. Helper: `isNotSold()` en `business-rules.ts`. |
| **Descripción DYMMSA (jerarquía de catálogo)** | Resuelta en código: **catálogo (`urrea_catalog.description`) > curada (`etm_products.dymmsa_description`) > null** (celda vacía). El cruce con el catálogo es **estricto por `(model_code, brand)`** — el mismo código puede existir en varias marcas, así que un producto marcado URREA NO hereda la descripción de un código que solo existe bajo SURTEK. La oficial NUNCA se copia a `etm_products` (si está mal, se reimporta el catálogo); `quotation_items.dymmsa_description` es **snapshot del valor resuelto** al guardar (congelado — reimportar catálogo no reescribe cotizaciones). Auto-learn persiste solo la curada **cruda** de la UI. Llave de cruce SIEMPRE con **`catalogKey(code, brand)`** (normaliza ambos trim+upper; marca vacía → `DEFAULT_BRAND`='URREA'). Los mapas de catálogo (`fetchCatalogDescriptionMap`, `catalogDescriptions` del store, respuestas de `/lookup`) van indexados por esa llave, **no por código**. Helpers: `resolveDymmsaDescription()`/`catalogKey()` en `business-rules.ts`, `fetchCatalogDescriptionMap()` en `urrea-catalog.ts`. Ver ADR-013. |
| **Stock se deduce al CREAR la orden** | No al confirmar recepción. **Recepción (ADR-019):** solo el **excedente** (`receptionExcess()` = `max(0, recibido − pedido)`) entra a `store_inventory`, ajustado por **DELTA** contra lo persistido (re-confirmar es idempotente; corregir a la baja resta con clamp en 0 + warning). Recibir ≤ lo pedido NO mueve inventario. El excedente **nunca se factura ni se entrega**: total/Excel de entrega usan `receivedForCustomer()` = `min(recibido, pedido)`. Cancelar/eliminar restaura `in_stock + min(recibido, pedido)` — el excedente ya entró en la recepción, re-sumarlo lo duplicaría. Helpers en `business-rules.ts`. |
| **Excel URREA** | Se genera desde las **decisiones de mayoreo guardadas** (`order_purchase_decisions`): piezas = `packages_wholesale × std_snapshot` (múltiplos de STD). Criterio = **pertenencia a `urrea_catalog`** por `catalogKey(model_code, brand)` — cualquier línea del catálogo (URREA/SURTEK/FOY...), **ya NO `brand='URREA'`**. Sin decisiones guardadas → el botón manda al planificador; decisiones stale → AlertDialog de aviso. Separadores y `quantity_to_order=0` siguen fuera (nunca llegan al plan). |
| **Planificador de compra (mayoreo vs menudeo)** | ADR-018. La matemática corre sobre cantidades **consolidadas por `catalogKey(model_code, brand)`** (duplicados entre secciones se suman ANTES de decidir — 5+5 con STD=10 es paquete exacto). La decisión real es sobre el **resto** (`N mod STD`): mixto permitido (floor paquetes a URREA + resto a menudeo). Recomendación: dinero parado > umbral ($100, estricto) → menudeo el resto; % parado ≥ umbral (80%, inclusivo) → "revisar" (el usuario DEBE decidir, bloquea guardado); si no → redondear al paquete. Precio del grupo = **promedio ponderado** de líneas con precio > 0 (0 = sin capturar; precio de VENTA como proxy del costo). La recomendación es al vuelo por orden; solo se persiste la decisión del usuario (staleness si cambia N o el std del catálogo). Lo no-catálogo + restos a menudeo → export "compra local". Helpers en `src/lib/purchase-plan.ts` (NO en business-rules). |
| **Auto-learn** | Solo actualiza campos no vacíos. No asigna `brand='URREA'` si `model_code` está vacío. |
| **sort_order** | Al guardar cotización: `sort_order = index`. Al crear orden: re-asigna secuencialmente. Agregar ítem manual: `max(sort_order) + 1`. Siempre ordenar por `sort_order ASC`. |
| **Aprobación pública** | `/approve/[token]` sin auth. Si `status !== 'sent_for_approval'` → mostrar estado actual, no permitir re-aprobar. **Guardar avance** (`finalize=false`): persiste `is_approved` (aprobados=`true`, resto=`null`) **sin cambiar status** → el link sigue vivo y el cliente retoma después. **Enviar** (`finalize=true`): resto=`false`, status→`approved`/`rejected` + sella `approved_at`. Un popup confirma antes de enviar. Al quedar `approved` se **notifica a DYMMSA por correo** (Resend, aislado en try/catch → nunca revierte la aprobación; el total del correo se calcula de los **ítems aprobados**, no de `total_amount`; env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NOTIFICATION_EMAIL_TO`, `NEXT_PUBLIC_APP_URL`; ver ADR-012). |
| **Rollback** | Si falla inserción de ítems en `save` o `create-order` → eliminar el registro padre (quotation/order). |
| **Módulo Tareas = GitHub Issues** | `src/lib/github.ts` + `/api/tasks/*`. **No hay tabla**: los issues del repo (`GITHUB_REPO`) SON las tasks. Prioridad = label `priority:*`, estado = open/closed, reporter = línea `Reportado por:` en el body. La API de issues incluye PRs → excluir con `isPullRequest`. Errores vía `GitHubError`/`handleGitHubError` (401 token vencido, 403, 404). Imágenes → bucket `task-images`. Novedades liga `#N` → `/dashboard/tasks/N`. Ver ADR-014. |
| **MCP interno = lectura + escrituras** | `src/lib/mcp/` + `POST /api/mcp` (ruta `src/app/api/[transport]/route.ts`, mcp-handler, SSE deshabilitado). Auth: Bearer `MCP_API_KEY` (tiempo constante; **sin la env var rechaza todo**). Los tools usan el **admin client** (service role). **Escrituras aprobadas como dirección (decisión 2026-07-12, ADR-015):** primera = `create_task` (GitHub Issue; reporter fijo `"Asistente (MCP)"`). Las siguientes se agregan por nivel de riesgo, cada una acotada, con tests y documentada en ADR-015 — las que toquen el núcleo transaccional (inventario, cotizaciones, órdenes) se diseñan con el usuario antes de implementar. Reutilizan `business-rules.ts`/`github.ts`; respuestas ya resueltas (descripción DYMMSA, totales, ubicación oculta sin stock). |
| **Errores descriptivos** | Los route handlers mapean `PostgrestError` con `explainPgError()` → identifican el ETM ofensor y devuelven 400 (no 500) cuando es violación de regla del usuario. `auto-learn` aislado en su propio try/catch → si falla, la cotización ya está salvada (warning, no error). Ver `DYMMSA/04-Decisiones-Tecnicas/ADR-009-Errores-Descriptivos.md`. |

---

## Convenciones de código

- **Todo en inglés:** código, variables, nombres de BD, API routes.
- **TypeScript estricto.** Types centralizados en `src/types/database.ts`.
- **Hooks = TanStack Query + fetch a API Routes propias.** No llamar Supabase directo desde el cliente — ni lecturas ni CRUD. Wrapper compartido `fetchJson`/`ApiError` en `src/lib/fetch-json.ts`. Excepción legítima: `useAuth`/`login` usan el browser client para la sesión. **Migrados (2026-06-19):** cotizaciones (incl. lista/stats/detalle), inventario, catálogo URREA. **Pendientes (aún con lecturas directas):** `useOrders`, `useDashboard`, `useProducts` → migrar a su `GET /api/*` cuando se toquen.
- **API Routes:** usar `createClient()` de `@supabase/ssr` + verificar `auth.getUser()` al inicio.
- **Páginas:** Server Components por defecto; `"use client"` solo donde hay interactividad.
- **Zustand store:** `dymmsa-quotation-draft` en localStorage. Llamar `reset()` al guardar exitosamente. Otras keys persistidas: `dymmsa-columns` (columnas ocultas por tabla, issue #18 — vía `useVisibleColumns` + `ColumnPicker`), `dymmsa-sidebar-collapsed`, `dymmsa-sound`, `dymmsa-discrete-mode`.
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
├── mcp/         # tools MCP (node; el mock se inyecta por parámetro, sin vi.mock)
└── components/  # componentes React (jsdom + Testing Library)
    └── helpers/ # render (QueryClientProvider), stores (resetStores), fixtures
```

- **Comando:** `bun run test` (474 tests). Watch: `bun run test:watch`. Coverage: `bun run test:coverage`.
- **Verificación completa: `bun run check`** (tsc + eslint + vitest) — el mismo comando que corre el CI (`.github/workflows/ci.yml`) en cada PR. **El lint se mantiene en CERO findings**: si un warning es inevitable (ej. `react-hooks/incompatible-library` de react-hook-form), se suprime con `eslint-disable` + comentario del porqué; nunca se deja ruido permanente.
- ⚠️ **Usar `bun run test`, NO `bun test`** — `bun test` invoca el runner integrado de Bun y falla al toparse con imports de `vitest`.
- **Backend = unit con mock de Supabase** (sin BD real). El mock reproduce el query builder chainable y registra llamadas para assertions de auth, validación, rollback y side effects de inventario.
- **Patrón backend:** `vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))` + `injectSupabaseServer(() => activeClient)` (helper que registra el `beforeEach`; la variable se intercambia por test). `/approve/[token]` mockea `@/lib/supabase/admin`.
- **Componentes:** jsdom + Testing Library. Hooks de TanStack se mockean a nivel de módulo (`vi.mock('@/hooks/*')` → `{ mutateAsync: vi.fn(), isPending: false }`); los stores Zustand se resetean con `resetStores()`. DnD (drag&drop) y flujos completos quedan para E2E.
- **Al agregar/cambiar lógica de negocio o un route handler, agregar o actualizar su test.**

### Integración + E2E contra Supabase local (ADR-021, fuera del CI)

Complemento a la batería mockeada: corren contra un **Supabase local real** (CLI + Docker), así que validan lo que el mock finge (constraints, RLS/GRANT, transaccionalidad, flujos encadenados, login/upload). **NO** entran en `bun run check`/CI (necesitan el stack local).

```bash
bunx supabase start          # levanta el stack local (Docker) — una vez
bun run test:integration     # tests/integration/ — route handlers vs BD real
bun run test:e2e             # tests/e2e/ — Playwright (cotizador + página de aprobación)
bun run verify               # pre-push: check + integration + e2e (con el stack arriba)
bunx supabase stop           # apaga el stack (libera RAM); db reset lo reconstruye
```

- **Baseline solo-local**: `supabase/migrations/00000000000000_baseline.sql` (desde `schema.sql` + extensión `moddatetime` + bucket `task-images` + `GRANT`s a anon/authenticated/service_role). **La nube sigue siendo la fuente de verdad vía MCP**; refrescar el baseline al cambiar el schema.
- **Seed** (`supabase/seed.sql`): usuario de prueba (`test@dymmsa.local`/`testpassword123`) + fixtures deterministas. Nunca datos reales.
- **Integración**: reusa `injectSupabaseServer`/`injectSupabaseAdmin` pero devuelve un cliente **real autenticado** (no mock). `resetDb()` (pg) aísla por test. Env/llaves demo en `.env.test.example`.
- **Playwright**: dev server propio en `:3100` con env local (no interfiere con `bun run dev` ni con producción).

> 📚 Detalle y rationale: `DYMMSA/04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing.md` + `ADR-021-Testing-E2E-Supabase-Local.md`

---

## CI/CD y Code Review

### GitHub Actions — Claude PR Reviewer

**Workflow:** `.github/workflows/claude.yml`

Instalado en `main` el 2026-05-17. Claude revisa automáticamente cada PR abierto o actualizado contra las reglas de negocio críticas del proyecto.

**Triggers:**
- Automático al abrir o actualizar un PR
- `@claude` en comentarios para preguntas on-demand

**Modelo:** Claude Opus 4.8 con `--effort high` (fijado en `claude_args` del workflow, via OAuth — sin costo adicional de API). Opciones de effort: `low`/`medium`/`high`/`xhigh`/`max`.

**Tres niveles de revisión:**
- 🔴 **Bloqueante** — violación de reglas de negocio, rutas sin `requireAuth()`, lógica de totales fuera de `business-rules.ts`, TypeScript `any`
- 🟡 **Advertencia** — lógica duplicada que debería ir en `src/lib/`, `formatCurrency` local, imports directos de Supabase desde cliente
- 🟢 **Sugerencia** — consistencia con el codebase, reutilización de utilidades existentes

**Reglas de negocio = fuente única (no duplicar en el workflow).** El prompt del revisor NO carga su propia copia de las reglas: tiene las tools `Read`/`Grep` y **lee las reglas críticas de este `CLAUDE.md` + `src/lib/business-rules.ts`** en cada revisión (con un índice de nombres como orientación). Así el revisor nunca queda desincronizado. Si agregas/cambias una regla crítica, edítala **aquí** (narrativa) y en `business-rules.ts` (ejecutable) — el revisor se actualiza solo.

**PR template:** `.github/pull_request_template.md` — optimizado para que el revisor de IA reciba contexto estructurado (por qué / qué / reglas de negocio tocadas / cómo se probó / riesgo-rollback). Pre-llena el cuerpo de cada PR; incluye `Closes #N` para cerrar la tarea al mergear.

**El template lo llena un workflow, no el usuario.** `.github/workflows/pr-describe.yml` rellena la descripción automáticamente al abrir un PR: Claude-en-CI lee el diff + los commits + la plantilla y escribe el cuerpo — **solo si está vacío o sin llenar** (nunca pisa lo que un humano ya redactó). El template es el contrato de qué reportar quien hizo los commits, no un formulario manual. Fallback / re-disparo a mano: comentar `@claude llena la descripción de este PR siguiendo el template` en el reviewer (`claude.yml` tiene `gh pr edit` permitido). Nota: `pr-describe.yml` es claude-code-action, así que —igual que el reviewer— se auto-salta en el PR que modifica su propio archivo y empieza a operar una vez en `main`.

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
| 7 — MCP interno | 🔄 lectura ✅ · `create_task` ✅ · más escrituras aprobadas (por nivel de riesgo) | `src/lib/mcp/` + `/api/mcp` |

---

## 🤖 Auto-mejora: instrucciones para Claude

> Obligatorio. Ejecutar automáticamente al final de cada cambio significativo.

### Qué actualizar en la bóveda (`DYMMSA/`)

| Evento | Archivo a actualizar |
|--------|---------------------|
| Nueva o modificada **ruta API** | `DYMMSA/02-Arquitectura/API-Routes.md` |
| Nueva **tabla o columna** en Supabase | `DYMMSA/02-Arquitectura/Base-de-Datos.md` (verificar con MCP Supabase) + este CLAUDE.md |
| **Decisión técnica no obvia** | Crear `DYMMSA/04-Decisiones-Tecnicas/ADR-XXX-nombre.md` (último: ADR-015) |
| Nueva lógica de negocio o **route handler** | Agregar/actualizar su test en `tests/` (ver `ADR-007-Estrategia-Testing.md`) |
| **Fase completada** | Marcar ✅ en este CLAUDE.md + actualizar `DYMMSA/05-Fases/Fase-N.md` |
| **Nueva fase** | Crear `DYMMSA/05-Fases/Fase-N-Nombre.md` + agregar fila en tabla de arriba |
| Nuevo **enum o estado** | `DYMMSA/00-Inicio/Glosario.md` + tabla de BD en este CLAUDE.md |
| **Migración de BD** | `DYMMSA/06-Changelog/YYYY-MM.md` (fecha + migración + descripción + motivo) + **regenerar `supabase/schema.sql`** y agregar la fila en `supabase/migrations-log.md` — el snapshot del schema vive en git y se actualiza en el MISMO commit que la migración |
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

**Última actualización:** 2026-07-16  
**BD:** Supabase `wjlklwtvjewhtghlskbt` · PostgreSQL 17.6 · us-west-2  
**Filas (2026-04-25):** etm_products 564 · store_inventory 195 · quotations 9 · quotation_items 365 · orders 8 · order_items 182
