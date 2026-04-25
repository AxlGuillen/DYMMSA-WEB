# ADR-004: Cotizaciones aprobadas editables (Fase 5.5)

> **Implementado en:** [[03-Modulos/Cotizador]] (QuotationEditor), [[03-Modulos/Aprobacion-por-Token]] (canEdit logic)  
> **Decisión de negocio:** [[01-Negocio/Decisiones-de-Negocio#Por qué cotizaciones aprobadas son editables]]  
> **Fase:** [[05-Fases/Fase-5.5-Flexibilidad]]

**Fecha:** 2026-04-xx  
**Estado:** Implementado ✅

---

## Contexto

Después de implementar el flujo completo (Fase 5), se detectó que el flujo real de DYMMSA es más informal que el modelado:

- El cliente a veces aprueba verbalmente productos adicionales por WhatsApp, fuera de la cotización formal.
- DYMMSA necesita ajustar precios post-aprobación por acuerdo verbal.
- Restringir edición solo a `draft` bloqueaba estos casos de uso válidos.

## Decisión

Permitir edición en cotizaciones con `status = 'approved'` además de `draft`.

**Cambios:**

1. **`PATCH /api/quotations/[id]/update`** acepta `status = 'approved'`.
2. Al re-insertar ítems en una cotización aprobada, los ítems existentes **preservan su `is_approved` original**.
3. Ítems nuevos agregados por DYMMSA (no por el cliente) entran con `is_approved = true` — representan "aprobación interna" de DYMMSA.
4. **`QuotationDetail`**: `canEdit = isDraft || isApproved` controla visibilidad de todos los controles de edición.
5. El botón "Enviar a aprobación" solo aparece en `draft` — no en `approved`.

## Riesgo aceptado

Un usuario podría agregar ítems aprobados internamente sin que el cliente los haya visto. DYMMSA entiende esto y acepta la responsabilidad operacional — es consistente con su flujo de trabajo real.

## Alternativas consideradas

- **Crear una nueva cotización "adendum":** demasiada fricción. DYMMSA no quiere manejar múltiples cotizaciones por el mismo pedido.
- **Volver a `draft` y re-enviar a aprobación:** el cliente ya aprobó — forzar otro ciclo de aprobación por ajustes menores es contraproducente.
