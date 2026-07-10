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
| `POST` | `/api/orders/[id]/confirm-reception` | ✅ | Confirmar recepción: actualiza `quantity_received` + `urrea_status` + SUMA a inventario |
| `POST` | `/api/orders/[id]/cancel` | ✅ | Cancelar orden + restaurar `quantity_in_stock` al inventario. Status → `cancelled` |
| `POST` | `/api/orders/auto-learn` | ✅ | Auto-learn manual desde orden (legacy) |

---

## Productos / Catálogo ETM

> Módulo: [[03-Modulos/Catalogo-ETM]] · ADR: [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/quotes/lookup` | ✅ | Lookup masivo de ETMs en `etm_products`. Body: `{ etmCodes: string[], modelCodes?: string[] }`. Devuelve `{ found, notFound, catalogDescriptions }` — `catalogDescriptions` mapea `code` normalizado → descripción oficial de `urrea_catalog` (union de codes de productos encontrados + `modelCodes` del Excel) para resolver la Descripción DYMMSA ([[04-Decisiones-Tecnicas/ADR-013-Descripcion-DYMMSA]]) |
| `POST` | `/api/products/import` | ✅ | Importación masiva de catálogo desde Excel. Upsert por ETM |
| `GET` | `/api/products/next-dymmsa-code` | ✅ | Retorna el siguiente código `DYMMSA-{n}` disponible |

---

## Inventario

> Módulo: [[03-Modulos/Inventario]]

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/inventory` | ✅ | Lista paginada. Query: `page, pageSize, search (ilike model_code), stockFilter (all/in_stock/low_stock/sin_stock), quantitySort (asc/desc)`. Devuelve `{ data, count, page, pageSize, totalPages }` |
| `GET` | `/api/inventory/stats` | ✅ | Conteos por rango de stock: `{ total, in_stock, low_stock, sin_stock }` |
| `POST` | `/api/inventory` | ✅ | Crear producto. Body: `{ model_code, quantity, location? }`. Normaliza `quantity` a ≥ 0; `location` vacío → null |
| `PATCH` | `/api/inventory/[id]` | ✅ | Editar `model_code`/`quantity`/`location` (solo se toca lo que viene en el body) |
| `DELETE` | `/api/inventory/[id]` | ✅ | Eliminar producto |
| `POST` | `/api/inventory/import` | ✅ | Importar inventario desde Excel. Columnas `MODEL_CODE`, `QUANTITY` y opcional **`ubicacion`** (alias `ubicación`/`location`/`gaveta`). Upsert **no** pisa la ubicación existente si el archivo no la trae |

---

## Catálogo URREA

> Módulo: [[03-Modulos/Catalogo-URREA]] · Tabla aislada `urrea_catalog`

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/urrea-catalog` | ✅ | Lista paginada. Query: `page, pageSize, search (.or code/description), sortField (code/description/std, whitelist), sortDir`. Devuelve `{ data, count, page, pageSize, totalPages }` |
| `GET` | `/api/urrea-catalog/stats` | ✅ | Total de productos: `{ total }` |
| `POST` | `/api/urrea-catalog` | ✅ | Crear producto. Body: `{ code, description?, std? }`. `std` default 1; `code` duplicado → 400. `code` se **normaliza** (trim+upper — llave de cruce con `model_code`, ADR-013) |
| `POST` | `/api/urrea-catalog/lookup` | ✅ | Batch: `{ codes: string[] }` → `{ descriptions: Record<code, desc> }` (codes normalizados; omite filas sin descripción). Lo usan `ProductModal`/`ProductForm` para resolver la Descripción DYMMSA al editar `model_code` |
| `PATCH` | `/api/urrea-catalog/[id]` | ✅ | Editar `code`/`description`/`std` |
| `DELETE` | `/api/urrea-catalog/[id]` | ✅ | Eliminar producto |
| `POST` | `/api/urrea-catalog/import` | ✅ | Importar desde Excel (`codigo, descripcion, std`). Modo `upsert` (onConflict `code`) o `replace` (borra todo + inserta). `code` normalizado (trim+upper) |

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
