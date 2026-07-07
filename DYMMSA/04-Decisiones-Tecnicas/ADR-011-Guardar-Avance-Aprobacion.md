# ADR-011: Guardar avance en la aprobación (sin schema nuevo para el progreso)

> **Estado:** Implementado 2026-07-07
> **Fase:** 6 — Mejoras
> **Archivos clave:** `src/app/api/approve/[token]/route.ts`, `src/app/approve/[token]/ApprovalClient.tsx`, `src/app/api/quotations/[id]/status/route.ts`, `src/components/quotations/QuotationDetail.tsx`
> **Relacionado:** [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]] · [[04-Decisiones-Tecnicas/ADR-010-Reapertura-Cotizaciones]] · [[03-Modulos/Aprobacion-por-Token]]

---

## Contexto

En cotizaciones muy grandes (cientos/miles de ítems) el cliente no puede revisar
todo de una sentada. El flujo previo obligaba a **enviar la aprobación completa** en
una sola sesión; si cerraba la pestaña, perdía el avance. Necesitábamos dejarlo
**guardar su progreso sin finalizar**.

---

## Decisión

### 1. Reutilizar `is_approved` como store del progreso — **sin schema nuevo**
El estado por ítem ya vive en `quotation_items.is_approved` (tri-estado
`null`/`true`/`false`) y el `GET /approve/[token]` ya lo devuelve; `ApprovalClient`
ya reconstruye las decisiones desde ahí. Entonces "guardar avance" = persistir
`is_approved` **sin cambiar `quotations.status`**. No hizo falta ninguna columna
para el progreso.

### 2. Separar persistir de finalizar (un endpoint, un flag)
`POST /approve/[token]` recibe `{ approvedIds, finalize }`:
- `finalize=false` (**guardar avance**): reset de productos a `null` (pendiente) +
  aprobar los `approvedIds`. **El status NO cambia** → el `approval_token` no se
  regenera y el link sigue vivo para retomar.
- `finalize=true` (**enviar**): reset a `false` (rechazo) + aprobar; status →
  `approved`/`rejected`.

El **`null` al guardar vs `false` al finalizar** es clave: así el equipo DYMMSA ve
"Pendiente" en lo que el cliente aún no revisa (no "Rechazado").

### 3. Eficiencia: 2-3 queries en vez de N
Antes se hacía un `update` por ítem (Promise.all de N). Ahora son dos updates fijos
(reset masivo + aprobar `in(approvedIds)`), independientes del tamaño — importante
justo por el caso que motiva el feature. Se excluye `is_sold=false` (`No disponible`).

### 4. `approved_at` (sí requiere columna) + confirmación
- Nueva columna `quotations.approved_at timestamptz` (nullable). Se sella al
  **finalizar** en `approved`, y también al marcar `approved` desde el cambio manual
  de estado (se limpia al salir de `approved`). Se muestra en `QuotationDetail`.
- El envío definitivo pide **confirmación** en un `AlertDialog` (resumen de N ítems +
  total). "Guardar avance" no confirma (es no destructivo).

---

## Alternativas descartadas

- **Columna/estado nuevo para el progreso** (p. ej. `approval_in_progress`): innecesario
  y peligroso — cambiar el status regenera el `approval_token` y mataría el link. Mantener
  `sent_for_approval` + `is_approved` es más simple y no rompe el enlace.
- **Auto-guardado**: se optó por **botón manual** (más simple y seguro en un endpoint
  público). Queda como posible mejora futura (debounced).
- **Rechazo explícito por ítem** (3 estados en la UI del cliente): se mantuvo binario
  (aprobar / no aprobar) para menos fricción.

---

## Consecuencias

- Guardar avance es idempotente y barato; el cliente retoma con el mismo link y ve un
  banner "Tienes avance guardado: X de N".
- El único cambio de schema es `approved_at` (para mostrar la fecha), no para el progreso.
