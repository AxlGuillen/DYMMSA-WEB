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
Cotización en estado "approved"
→ Click "Enviar a aprobación"
→ POST /api/quotations/[id]/send-for-approval
  Genera approval_token UUID
  Status → sent_for_approval
  
Comparte link:
/approve/[approval_token]
                                     Recibe link
                                     Abre /approve/[token]
                                     Ve preview de cotización
                                     Aprueba ✅ / Rechaza ❌ cada ítem
                                     (o usa "Aprobar todo")
                                     Click Submit
                                     POST /api/approve/[token]
                                     
Sistema actualiza:
- quotation_items.is_approved por ítem
- quotations.status → approved (si alguno ✅)
                     → rejected (si todos ❌)
                                     
DYMMSA ve resultado en dashboard
```

## Seguridad y acceso

- El `approval_token` es un UUID v4 generado server-side — prácticamente imposible de adivinar.
- La página `/approve/[token]` es pública (sin login) pero no indexable (sin metadatos de SEO).
- Si el token no existe en BD → 404.
- Si `status !== 'sent_for_approval'` → banner informativo con el estado actual (ya aprobada, rechazada, etc.) — no permite re-aprobar.
- Solo se exponen campos necesarios al cliente (nombre, descripción, precio, cantidad) — no se expone `created_by`, `approval_token` interno, etc.

## Aprobación parcial

Cada ítem tiene su propio estado independiente:
- `is_approved = null` → pendiente (estado inicial)
- `is_approved = true` → aprobado ✅
- `is_approved = false` → rechazado ❌

El cliente puede mezclar aprobaciones y rechazos. El botón "Aprobar todo" setea todos a `true`.

## Componentes

| Componente | Ruta | Tipo |
|-----------|------|------|
| `page.tsx` | `src/app/approve/[token]/page.tsx` | Server Component — carga cotización por token |
| `ApprovalClient` | `src/app/approve/[token]/ApprovalClient.tsx` | Client Component — UI interactiva de aprobación |

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/approve/[token]` | Obtener cotización por token |
| `POST` | `/api/approve/[token]` | Enviar decisiones `{ decisions: [{ id, is_approved }] }` |
