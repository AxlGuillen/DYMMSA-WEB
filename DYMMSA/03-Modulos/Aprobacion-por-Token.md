# Módulo: Aprobación por Token

> **Pipeline:** [[03-Modulos/Cotizador|Cotizador]] → Aprobación → [[03-Modulos/Ordenes|Órdenes]]  
> **Tablas:** [[02-Arquitectura/Base-de-Datos#quotations|quotations]], [[02-Arquitectura/Base-de-Datos#quotation_items|quotation_items]]  
> **Decisión:** [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]] · **Por qué token público:** [[01-Negocio/Decisiones-de-Negocio#Por qué token público sin login para el cliente]]

## Propósito

Permitir que el cliente externo apruebe o rechace ítems de una cotización sin necesidad de crear una cuenta en el sistema.

## Flujo

```
DYMMSA                               Cliente
──────                               ───────
Cotización en estado "draft"
→ Click "Enviar a aprobación"
  (si hay cambios sin guardar, primero PATCH /update)
→ POST /api/quotations/[id]/send-for-approval
  Exige status = draft (si no → 400)
  Status → sent_for_approval
  El approval_token ya existe: default de la BD
  (gen_random_uuid) y se regenera en cada cambio
  manual de estado (PATCH /status)

Comparte link:
/approve/[approval_token]
                                     Recibe link
                                     Abre /approve/[token]
                                     Ve preview de cotización
                                     Aprueba ✅ cada ítem
                                     (o "Aprobar todos" / "Aprobar N visibles")
                                     POST /api/approve/[token]
                                     { approvedIds, finalize }

finalize=false → "Guardar avance":
- aprobados → is_approved = true, resto → null
- status NO cambia → el link sigue vivo y el cliente retoma después

finalize=true → "Enviar" (con popup de confirmación):
- aprobados → true, resto → false
- quotations.status → approved (si approvedIds trae alguno) + sella approved_at
                     → rejected (si no aprobó ninguno)
- Solo procede si status = sent_for_approval (si no → 400; dos envíos a la vez → 409)

DYMMSA ve el resultado al abrir o recargar la cotización
(lista y detalle). El aviso por correo de ADR-012 está APAGADO
(EMAIL_NOTIFICATIONS_ENABLED = false): no llega ningún correo.
```

Los ítems `is_sold = false` ("No disponible") nunca se tocan: quedan fuera del reset y no son aprobables.

## Seguridad y acceso

- El `approval_token` es un UUID v4 generado server-side — prácticamente imposible de adivinar.
- La página `/approve/[token]` es pública (sin login) pero no indexable (sin metadatos de SEO).
- Si el token no existe en BD → 404.
- Si `status !== 'sent_for_approval'` → banner informativo con el estado actual (ya aprobada, rechazada, etc.) — no permite re-aprobar.
- **Ojo, la página manda la fila completa:** `page.tsx` lee `select('*, quotation_items(*)')` y se la pasa a `ApprovalClient`, así que viaja al navegador del cliente todo lo de `quotations` y `quotation_items` (incluidos `created_by`, `notes` y `original_file_url`), aunque la pantalla solo pinte nombre, descripción, precio y cantidad. Pendiente acotar el `select` (revisión de bugs de Cotizaciones, 2026-10-17).
- **Reapertura / cambio de estado** (Fase 6, [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]]): cada cambio manual de estado (`PATCH /api/quotations/[id]/status`) **regenera `approval_token`**. El link compartido antes deja de matchear → 404. Así, si se reabre una cotización a `draft`/`sent_for_approval` para retrabajarla, el cliente no puede aprobar con un link viejo.

## Reapertura y aprobaciones preservadas

Al reabrir una cotización (vía dropdown de estado) y volver a enviarla:
- `is_approved` se **preserva** en todos los estados (`PATCH /update`); los ítems ya
  aprobados conservan su decisión, los nuevos quedan `null` (pendientes).
- La página pre-selecciona los `is_approved === true` (`ApprovalClient` L63-68), por lo que
  el cliente **solo decide los ítems nuevos**, no re-aprueba todo.
- El embed de `quotation_items` en `page.tsx` usa `.limit(5000)` (evita truncar cotizaciones grandes).

## Aprobación parcial

Cada ítem tiene su propio estado independiente:
- `is_approved = null` → pendiente (estado inicial)
- `is_approved = true` → aprobado ✅
- `is_approved = false` → rechazado ❌

El cliente puede mezclar aprobaciones y rechazos. El botón "Aprobar todos" setea todos a `true`.

## UI: rediseño glass, filtros y dock sticky (issue #24)

Rediseño **tema-aware** (glass; se adapta a claro/oscuro del dispositivo del cliente, sin forzar dark):

- **Dock flotante sticky** (`ApprovalDock`) con anillo de progreso circular (aprobados/total, %) + "Total aprobado" + botones **Guardar avance** y **Enviar aprobación** — siempre visible al hacer scroll. Reemplaza el submit-bar no-sticky y las cards de contador. El progreso del dock es **global** (el filtro es solo navegación).
- **Filtros** (`ApprovalFilters`, barra sticky bajo el header): por **marca** y por **proyecto/sección** (derivada de los separadores; los ítems previos al primer separador caen en "General"). Helpers puros en `src/lib/approval-filters.ts`. Un separador se oculta si su sección no tiene ítems visibles bajo el filtro.
- **"Aprobar todos" contextual**: con un filtro activo se re-etiqueta a **"Aprobar N visibles"** y aprueba solo lo filtrado. `approvedIds` enviado al API sigue siendo el global → la ruta `POST /api/approve/[token]` **no cambia**.
- **Tiles de resumen** (`SummaryTiles`): Cliente / Productos / Subtotal est.
- **Splash de intro** (`SplashIntro`): el logo vuela del centro al header; **solo la primera vez por sesión** (sessionStorage) y respeta `prefers-reduced-motion`.

Lógica de negocio **intacta**: separadores como filas de sección, ítems `is_sold=false` como "No disponible", guardar avance vs enviar, popup de confirmación, banner de retomar, pantalla de éxito, banners de ya-procesada.

## Componentes

| Componente | Ruta | Tipo |
|-----------|------|------|
| `page.tsx` | `src/app/approve/[token]/page.tsx` | Server Component — carga cotización por token |
| `ApprovalClient` | `src/app/approve/[token]/ApprovalClient.tsx` | Client Component — orquesta la UI de aprobación |
| `ApprovalFilters` · `ApprovalDock` · `SummaryTiles` · `SuccessScreen` · `SplashIntro` | `src/app/approve/[token]/` | Subcomponentes del rediseño (issue #24) |
| `approval-filters.ts` | `src/lib/approval-filters.ts` | Helpers puros de secciones/marcas/filtrado |

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/approve/[token]` | Obtener cotización por token (la página la lee directo en su Server Component) |
| `POST` | `/api/approve/[token]` | Guardar avance o enviar: `{ approvedIds?: string[], finalize?: boolean }` (`finalize` default `false`) |
