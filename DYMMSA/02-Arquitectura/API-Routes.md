# API Routes

> Todas las rutas bajo `/api/`. Auth = ✅ requiere sesión Supabase | ❌ pública.  
> Módulos: [[03-Modulos/Cotizador]] · [[03-Modulos/Aprobacion-por-Token]] · [[03-Modulos/Ordenes]] · [[03-Modulos/Catalogo-ETM]] · [[03-Modulos/Inventario]]

---

## Cotizaciones

> Módulo: [[03-Modulos/Cotizador]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/quotations` | ✅ | Lista paginada. Query: `page, pageSize, search (.or customer_name/name, saneado), status (whitelist o all)`. Devuelve `{ data: QuotationWithCount[] (con items_count), count, page, pageSize, totalPages }` |
| `GET` | `/api/quotations/stats` | ✅ | Conteo por status: `{ draft, sent_for_approval, approved, rejected, converted_to_order }` |
| `POST` | `/api/quotations/save` | ✅ | Crear cotización nueva + auto-learn etm_products. Body: `{ name, customer_name, items: QuotationItemRow[] }`. Cada ítem se guarda con `dymmsa_description` **resuelta server-side** (catálogo URREA > curada > null; snapshot congelado, ADR-013) |
| `GET` | `/api/quotations/[id]` | ✅ | Obtener cotización con sus ítems (`quotation_items(*)` ordenados por `sort_order`, `limit(5000)` contra truncamiento). 404 si no existe |
| `DELETE` | `/api/quotations/[id]` | ✅ | Eliminar cotización + sus ítems (cualquier estado) |
| `PATCH` | `/api/quotations/[id]/update` | ✅ | Editar cotización en estado `draft` o `approved`. Body: `{ name?, customer_name?, items?, status?, notes? }`. Re-resuelve `dymmsa_description` con jerarquía de catálogo (fallback al snapshot en BD si la UI no manda el campo, ADR-013) |
| `POST` | `/api/quotations/[id]/send-for-approval` | ✅ | Genera `approval_token` UUID + cambia status a `sent_for_approval` |
| `POST` | `/api/quotations/[id]/create-order` | ✅ | Crear orden desde cotización `approved`. Stock check + deducción inventario. Status → `converted_to_order` |
| `PATCH` | `/api/quotations/[id]/status` | ✅ | Cambio manual de estado entre `draft`/`sent_for_approval`/`approved`/`rejected`. Body: `{ status }`. Preserva `is_approved` y `approved_at`. Sella `approved_at` al marcar `approved` solo si aún no existe (conserva la fecha original del cliente); **nunca lo borra** → la fecha de aprobación se ve en cualquier fase posterior. `converted_to_order` no es destino manual (400). Revertir desde `converted_to_order` exige que la orden vinculada esté **eliminada** (si existe cualquier orden vinculada → 400) |
| `GET` | `/api/quotations/[id]/cut-candidates` | ✅ | Piezas DYMMSA de la cotización para **sembrar el corte rápido** (issue #71): misma forma que los `candidates` del cut-plan de orden (nominales `cut_*`, marca trim+upper), separadores e `is_sold=false` fuera |

---

## Aprobación (pública)

> Módulo: [[03-Modulos/Aprobacion-por-Token]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/approve/[token]` | ❌ | Obtener datos de cotización por approval_token (solo campos públicos) |
| `POST` | `/api/approve/[token]` | ❌ | Persistir decisiones. Body: `{ approvedIds: string[], finalize: boolean }`. `finalize=false` → **guardar avance** (aprobados=`true`, resto=`null` pendiente; **status NO cambia** → link sigue vivo). `finalize=true` → **enviar** (resto=`false`, status `approved`/`rejected` + `approved_at`). Solo si status `sent_for_approval`. Excluye `is_sold=false`. Eficiente: 2-3 queries. **Si finaliza en `approved`** → envía notificación por email a DYMMSA (Resend, `sendApprovalNotification`) en `try/catch` aislado: un fallo de correo nunca revierte la aprobación ni cambia el 200 ([[04-Decisiones-Tecnicas/ADR-012-Notificaciones-Email]]). **Guarda de concurrencia:** la transición de status usa `.eq('status','sent_for_approval')`; si otro request concurrente (misma liga en 2 pestañas/dispositivos) ya finalizó → 409 (no pisa el estado) |

---

## Órdenes

> Módulo: [[03-Modulos/Ordenes]] · Inventario: [[03-Modulos/Inventario]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/orders/create` | ✅ | Crear orden directa sin cotización (flujo legacy) |
| `POST` | `/api/orders/[id]/items` | ✅ | Agregar ítem a orden existente + stock check + deducción inventario |
| `PATCH` | `/api/orders/[id]/items/[itemId]` | ✅ | Editar precio de un ítem. Recalcula `total_amount` de la orden |
| `DELETE` | `/api/orders/[id]/items/[itemId]` | ✅ | Eliminar ítem + restaurar `quantity_in_stock` al inventario |
| `POST` | `/api/orders/[id]/confirm-reception` | ✅ | Confirmar recepción: actualiza `quantity_received` + `urrea_status`; a inventario entra solo el **excedente** por delta (idempotente, clamp en 0). Respuesta `{ success, inventory_updated, warnings[] }` (ADR-019) |
| `POST` | `/api/orders/[id]/cancel` | ✅ | Cancelar orden + restaurar `quantity_in_stock` al inventario. Status → `cancelled` |
| `POST` | `/api/orders/auto-learn` | ✅ | Auto-learn manual desde orden (legacy) |
| `GET` | `/api/orders/[id]/purchase-plan` | ✅ | Plan de compra mayoreo/menudeo (ADR-018): consolida por `catalogKey`, math STD + recomendación al vuelo, casa decisiones guardadas con staleness. Catálogo/settings degradan a defaults |
| `PUT` | `/api/orders/[id]/purchase-decisions` | ✅ | **Replace-all** del set de decisiones de la orden: normaliza code/brand, pre-flight del CHECK de cobertura, upsert `(order_id, model_code, brand)` ANTES del delete de removidas. 400 en órdenes `completed`/`cancelled` |
| `GET` | `/api/orders/[id]/cut-plan` | ✅ | Plan de corte (issue #59): `{ order, pieces, candidates, presentations, marginMm }`. Los `numeric` se **coercen a number aquí** (supabase-js los da como string). `candidates` = ítems DYMMSA de la orden (sin separadores) con las medidas nominales `cut_*` del producto para pre-llenar |
| `PUT` | `/api/orders/[id]/cut-plan` | ✅ | **Replace-all** de la lista de corte (el body es el estado deseado). Espejo del CHECK `cut_piece_shape` con mensajes claros (ADR-009). Sin llave natural para upsert → delete + insert con **restauración** de la lista previa si el insert falla. 400 en `completed`/`cancelled` |

---

## Proveedores (menudeo)

> Módulo: [[03-Modulos/Proveedores]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/suppliers` | ✅ | Lista paginada (search nombre/teléfonos/correo, sort whitelist, filtro `brandId`) con marcas embebidas y aplanadas |
| `POST` | `/api/suppliers` | ✅ | Crear proveedor + links de marcas (**rollback** del padre si fallan los links) |
| `PATCH` | `/api/suppliers/[id]` | ✅ | Updates sparse + `brandIds` con **replace por diff** (nunca hay ventana sin links) |
| `DELETE` | `/api/suppliers/[id]` | ✅ | Eliminar (links caen por CASCADE) |
| `GET` | `/api/brands` | ✅ | Marcas con conteo de proveedores que las usan |
| `POST` | `/api/brands` | ✅ | Crear marca (normalizada trim+upper; duplicada → 400) |
| `PATCH` | `/api/brands/[id]` | ✅ | Renombrar marca (normalizado) |
| `DELETE` | `/api/brands/[id]` | ✅ | **Bloqueado si está en uso** (400 con conteo; FK sin cascade como backstop) |

---

## Corte de material

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/material-presentations` | ✅ | Registra la presentación que ofreció el proveedor ("barras de 6 m de Ø30"). Upsert contra el UNIQUE NULLS NOT DISTINCT + refresca `last_used_at` — el catálogo del proveedor **se arma solo con el uso** (issue #59) |
| `GET` | `/api/material-presentations` | ✅ | Catálogo completo de medidas registradas, ordenado por último uso (issue #71: lo consumen el corte rápido y la página de control). `numeric` coercido a number |
| `DELETE` | `/api/material-presentations/[id]` | ✅ | Elimina una medida registrada (captura errónea — issue #71). Seguro: `cut_plan_pieces` no referencia presentaciones. 404 si no existe |

---

## Configuración

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/settings` | ✅ | Filas de `app_settings` como Record (filtro opcional `?keys=a,b`). Los callers mergean con defaults en código |
| `PATCH` | `/api/settings` | ✅ | Upsert por key con **whitelist estricta** (key desconocida → 400). Keys: `purchase_threshold_money` (> 0), `purchase_threshold_pct` ((0,1]) |

---

## Productos / Catálogo ETM

> Módulo: [[03-Modulos/Catalogo-ETM]] · ADR: [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/quotes/lookup` | ✅ | Lookup masivo de ETMs en `etm_products`. Body: `{ etmCodes: string[], modelCodes?: string[] }`. Devuelve `{ found, notFound, catalogDescriptions }` — `catalogDescriptions` mapea `code` normalizado → descripción oficial de `urrea_catalog` (union de codes de productos encontrados + `modelCodes` del Excel) para resolver la Descripción DYMMSA ([[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]]) |
| `GET` | `/api/products` | ✅ | Lista paginada de `etm_products`. Query: `page`, `pageSize` (máx 100), `search`, `sortBy` (whitelist: `etm`/`description_es`/`model_code`/`price`), `sortDir`. El término de búsqueda se sanea de `%,()` porque se interpola en el filtro `.or()` |
| `POST` | `/api/products` | ✅ | Crea un producto del catálogo ETM. ETM obligatorio; duplicado (`23505`) → 400 descriptivo |
| `PATCH` | `/api/products/[id]` | ✅ | Actualiza un producto. `is_sold` es **tri-estado**: ausente = no se toca, `null` explícito **sí se persiste** (sin cambios aplicables → 400) |
| `DELETE` | `/api/products/[id]` | ✅ | Elimina un producto del catálogo ETM |
| `POST` | `/api/products/import` | ✅ | Importación masiva de catálogo desde Excel. Upsert por ETM |
| `GET` | `/api/products/next-dymmsa-code` | ✅ | Retorna el siguiente código `DYMMSA-{n}` disponible |

> **Migración (2026-07-28, issue #55):** `useProducts` dejó de llamar a Supabase directo desde el cliente y pasa por estas rutas. Habilita el toggle rápido de `is_sold` desde la tabla (`useSetProductSold`, con update optimista + rollback).

---

## Inventario

> Módulo: [[03-Modulos/Inventario]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/inventory` | ✅ | Lista paginada. **Lee de la vista `store_inventory_with_brand`** (issue #53) para poder filtrar por marca ANTES de paginar. Query: `page, pageSize, search (ilike model_code), brand (marca exacta, `__none__` = sin marca, vacío = todas), stockFilter (all/**with_stock**/in_stock/low_stock/sin_stock), quantitySort (asc/desc)`. Cada fila incluye `brand` (puede ser `null`) |
| `GET` | `/api/inventory/stats` | ✅ | Conteos por rango de stock + marcas: `{ total, with_stock, in_stock, low_stock, sin_stock, brands: [{ brand, total, with_stock }] }`. Las marcas salen de la RPC `inventory_brand_counts()`; si falla se devuelve `[]` sin tumbar las métricas |
| `POST` | `/api/inventory` | ✅ | Crear producto. Body: `{ model_code, quantity, location? }`. Normaliza `quantity` a ≥ 0; `location` vacío → null |
| `PATCH` | `/api/inventory/[id]` | ✅ | Editar `model_code`/`quantity`/`location` (solo se toca lo que viene en el body) |
| `DELETE` | `/api/inventory/[id]` | ✅ | Eliminar producto |
| `POST` | `/api/inventory/import` | ✅ | Importar inventario desde Excel. Columnas `MODEL_CODE`, `QUANTITY` y opcional **`ubicacion`** (alias `ubicación`/`location`/`gaveta`). Upsert **no** pisa la ubicación existente si el archivo no la trae |

---

## Catálogo URREA

> Módulo: [[03-Modulos/Catalogo-URREA]] · Tabla aislada `urrea_catalog`

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/urrea-catalog` | ✅ | Lista paginada. Query: `page, pageSize, search (.or code/description), brand (filtro exacto normalizado), sortField (code/brand/description/std, whitelist), sortDir`. Devuelve `{ data, count, page, pageSize, totalPages }` |
| `GET` | `/api/urrea-catalog/stats` | ✅ | `{ total, brands: [{ brand, count }] }` (desglose por marca vía RPC `urrea_catalog_brand_counts`) |
| `POST` | `/api/urrea-catalog` | ✅ | Crear producto. Body: `{ code, brand?, description?, std? }`. `std` default 1; `brand` default `URREA` (normalizado trim+upper); `(code, brand)` duplicado → 400. `code` se **normaliza** (trim+upper — llave de cruce con `model_code`, ADR-013) |
| `POST` | `/api/urrea-catalog/lookup` | ✅ | Batch: `{ codes: string[] }` → `{ descriptions: Record<code, desc> }` (codes normalizados; omite filas sin descripción). Lo usan `ProductModal`/`ProductForm` para resolver la Descripción DYMMSA al editar `model_code`. ⚠️ Aún cruza solo por `code` (sin marca — issue #27) |
| `PATCH` | `/api/urrea-catalog/[id]` | ✅ | Editar `code`/`brand`/`description`/`std` (brand normalizado; `(code, brand)` duplicado → 400) |
| `DELETE` | `/api/urrea-catalog/[id]` | ✅ | Eliminar producto |
| `POST` | `/api/urrea-catalog/import` | ✅ | Importar desde Excel (`codigo, marca, descripcion, std`; sin `marca` → `URREA`). Modo `upsert` (onConflict `code,brand`) o `replace` (borra todo + inserta). `code`/`brand` normalizados (trim+upper) |

---

## Finanzas — Facturas por pagar

> Módulo: Finanzas fase 1 (issue #84) · Registro simbólico de egresos; la facturación oficial vive en Odoo. Matemática en `src/lib/payables.ts`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/payables` | ✅ | Lista paginada con proveedor embebido. Query: `page`, `pageSize (≤100)`, `search` (concepto, ilike saneado), `status (pending/paid/cancelled)`, `month (YYYY-MM, por VENCIMIENTO)`, `sortField (due_date/invoice_date/amount/created_at)`, `sortDir` |
| `POST` | `/api/payables` | ✅ | Registrar factura. Body: `{ supplier_id, concept, amount > 0, invoice_date, due_date, notes? }`. Proveedor obligatorio y existente (404 preciso). Siempre nace `pending` — el status del cliente se ignora |
| `PATCH` | `/api/payables/[id]` | ✅ | Updates sparse. Regla de pago: `status→'paid'` sin `paid_at` → default hoy; `status→'pending'/'cancelled'` limpia `paid_at`; `paid_at` solo también se acepta (corregir fecha de una pagada) |
| `DELETE` | `/api/payables/[id]` | ✅ | Eliminar factura |
| `GET` | `/api/payables/overview` | ✅ | Query: `month (YYYY-MM, default mes actual)`. Devuelve `{ month, summary, payables }` — todas las pendientes (las vencidas de meses previos cuentan) + pagadas del mes; resumen de `summarizeMonth()` |

---

## Finanzas — Ingresos (Odoo)

> Módulo: Finanzas fase 2 (issue #94, ADR-027) · La app **lee** Odoo, nunca lo espeja. Loaders en `src/lib/odoo/income.ts`, matemática en `src/lib/income.ts`, caché en `src/lib/odoo/income-cache.ts`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/finance/income` | ✅ | Query: `month (YYYY-MM, default mes actual)`. Devuelve `{ month, today, income, collections, fetchedAt, unavailable? }`. `income` = `{ collectedTotal/Count (pagos inbound de CLIENTE por fecha de cobro), receivableTotal/Count (abiertas, vencen hoy o después), overdueTotal/Count (abiertas vencidas), collectionsTruncated, receivablesTruncated, foreignCurrencies }`; `collections` = cobros del mes (`folio, customer, date, amount, currency, state`). **Odoo ausente o caído → 200 con `income: null`** y `unavailable.reason` (`not_configured` \| `odoo_error`); solo un error ajeno a Odoo da 500. Dos lecturas cacheadas 15 min (Data Cache, tag `finance-income`). `maxDuration = 60` |
| `POST` | `/api/finance/income/refresh` | ✅ | Query: `month`. Purga el tag con `revalidateTag(tag, { expire: 0 })` y responde con una lectura fresca (misma forma que el GET) |

---

## Horas (checador)

> Módulo: Horas (issue #93, ADR-026) · Parser y matemática en `src/lib/timesheet.ts`. **Admin** = `requireAdmin()` (401 sin sesión, 403 para member); la BD repite la regla con RLS + `is_admin()`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/profile` | ✅ | Perfil propio `{ id, display_name, role, clock_employee_id }` — lo que el cliente usa para decidir qué mostrar |
| `GET` | `/api/profiles` | Admin | Todos los perfiles |
| `PATCH` | `/api/profiles/[id]` | Admin | `display_name`, `role (admin/member)`, `clock_employee_id (entero ≥ 1 o null)`. No degrada al **último** admin (400); id de checador repetido (23505) → 400 |
| `GET` | `/api/time-entries` | ✅ | Query: `user (uuid, solo admin — un member lo IGNORA y recibe lo propio)`, `from`, `to` (ISO; default semana actual lunes→domingo). Devuelve `{ user, from, to, entries, week }` con `week = buildWeekView()` (7 días, totales derivados). **`week` es `null` salvo que `from..to` sea exactamente una semana lunes→domingo** (la UI siempre manda eso; un rango parcial no tiene total semanal). `time` normalizado a `HH:MM` |
| `POST` | `/api/time-entries` | Admin | Captura manual: `{ user_id, work_date, clock_in, clock_out?, note? }` → nace `source='manual'`, `source_clock_in = clock_in`. Duplicada → 400 |
| `PATCH` | `/api/time-entries/[id]` | Admin | `clock_in`, `clock_out` (vacío = abierta), `note`. **Solo un cambio de hora** sella `edited_by/edited_at` y escribe `original` (la primera vez): una nota sola no congela la fila para el import. **Jamás** toca `source_clock_in` |
| `DELETE` | `/api/time-entries/[id]` | Admin | Eliminar pareja; id inexistente → 404 |
| `POST` | `/api/time-entries/import` | Admin | `multipart/form-data` campo `file` (el `.xls` NGTeco; hoja `Employee Timecard` o la primera). Mapea `(id)` del reporte → `profiles.clock_employee_id`, llama a la RPC `import_time_entries`. Responde `{ period, inserted, updated, skipped_edited, unmapped: [{ clockId, name }], warnings }`. Los no mapeados **no bloquean**; re-subir es idempotente. Una pareja con salida anterior a la entrada se filtra con `warning` (el CHECK la rechazaría y la RPC transaccional tiraría el archivo entero); `23514` → 400. Máximo 5 MB |
| `GET` | `/api/time-entries/imports` | ✅ | Bitácora de cargas (52 más recientes) |

---

## Tareas (GitHub Issues)

> Módulo: [[03-Modulos/Tareas]] · Backend: GitHub Issues del repo (`GITHUB_REPO`), sin tabla en Supabase · ADR: [[04-Decisiones-Tecnicas/ADR-014-Modulo-Tareas-GitHub]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/tasks` | ✅ | Lista de tasks (issues). Query: `state (open/closed/all, default open)`, `priority (low/medium/high/highest)`, `page`. Excluye PRs. Devuelve `{ tasks, page }`. `state=closed` = histórico |
| `POST` | `/api/tasks` | ✅ | Crear task. Body: `{ title, description?, priority? }`. Antepone `Reportado por: <email>` al body; la prioridad se traduce a label `priority:*` |
| `GET` | `/api/tasks/[number]` | ✅ | Detalle: `{ task, comments }`. `number` inválido → 400 |
| `PATCH` | `/api/tasks/[number]` | ✅ | Editar `{ title?, description?, priority?, state?, stateReason? }`. Cerrar/reabrir vía `state`; al cerrar, `stateReason` = `completed` (default) o `not_planned` (**descartar** = falso positivo). En descripción/prioridad lee el issue actual para conservar el reporter original y los labels no-prioridad |
| `POST` | `/api/tasks/[number]/comments` | ✅ | Comentar. Body: `{ body }`. Antepone `Reportado por:` |
| `POST` | `/api/tasks/upload` | ✅ | Multipart `file` → sube al bucket `task-images` (público, 5 MB, PNG/JPG/GIF/WEBP) con service role → `{ url }` para embeber en el markdown |

> `handleGitHubError` traduce `GitHubError` a HTTP: 401 (token vencido) / 403 (permiso o rate limit) / 404 con mensajes claros. Env: `GITHUB_TOKEN`, `GITHUB_REPO`.

---

## Notas de implementación

- Todas las rutas protegidas usan `createClient()` de `@supabase/ssr` y verifican `auth.getUser()`.
- Las rutas públicas de aprobación acceden directamente por `approval_token` sin sesión.
- Los errores siguen el formato `{ message: string }` con status HTTP apropiado.
- El rollback en `save` y `create-order` elimina el registro padre si falla la inserción de ítems.

---

## MCP remoto (`/api/mcp`, OAuth 2.1)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/mcp` | **OAuth 2.1 de Supabase** (Bearer JWT con `client_id`) | Servidor MCP (Streamable HTTP, `mcp-handler` + `withMcpAuth`). 13 tools de lectura + `create_task` + resource `dymmsa://reglas-negocio`. Sin token → **401 con `resource_metadata`** (discovery). Ruta física: `src/app/api/[transport]/route.ts` (runtime nodejs, maxDuration 60) |
| `GET` | `/.well-known/oauth-protected-resource[/...]` | Pública | Metadata RFC 9728 (catch-all: responde también con sufijo `/api/mcp`). Anuncia `authorization_servers` = issuer OAuth de Supabase |
| `GET` | `/oauth/consent?authorization_id=` | Sesión (detrás del login) | Pantalla de consentimiento del OAuth Server de Supabase; server actions aprueban/deniegan (`auth.oauth.*`) y redirigen al cliente |

> **Cero service_role en el camino MCP** (ADR-023): cada llamada construye su cliente con
> el token del request (`clientForToken`, opción `accessToken`) → RLS aplica como en la app.
> `verifyToken` = `getUser` contra GoTrue + `client_id` en allowlist (`MCP_OAUTH_CLIENT_IDS`);
> un token de sesión web NO abre el conector. El proxy no intercepta `/api/mcp` ni
> `/.well-known/*`. Tools: [[04-Decisiones-Tecnicas/ADR-015-MCP-Interno]] · Auth:
> [[04-Decisiones-Tecnicas/ADR-023-MCP-OAuth]].

---

## Health check (`/api/health`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/health` | Pública | Estado de la app corriendo las queries reales de cada módulo (cotizaciones, órdenes, inventario, con latencia) + Storage + GitHub (token Tareas). `ok`/`degraded` → 200, `down` → 503. Respuestas gruesas (sin detalles internos) + cache edge 30s. Sin self-fetch a /api/* (exigen sesión → 401); se llama la lógica interna con el admin client. Contrato multi-proyecto: [[04-Decisiones-Tecnicas/ADR-016-Health-Check]] |
