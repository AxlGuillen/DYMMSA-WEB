# ADR-010: Reapertura y cambio manual de estado de cotizaciones

> **Estado:** Implementado 2026-06-10
> **Fase:** 6 — Mejoras
> **Archivos clave:** `src/app/api/quotations/[id]/status/route.ts`, `src/app/api/quotations/[id]/update/route.ts`, `src/components/quotations/QuotationDetail.tsx`, `src/lib/quotation-status.ts`, `src/hooks/useQuotations.ts` (`useChangeQuotationStatus`)
> **Relacionado:** [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]] · [[03-Modulos/Aprobacion-por-Token]]

---

## Contexto

Las cotizaciones avanzaban en un solo sentido
(`draft → sent_for_approval → approved/rejected → converted_to_order`). No había
forma de **regresar** una cotización para volver a trabajarla. Recrear una
cotización grande (cientos/miles de ítems) era inviable, y el flujo no contemplaba
casos reales: el cliente pidió cambios tras enviar a aprobación, o hay que ajustar
una orden ya generada.

---

## Decisión

Un **dropdown de estado** en `QuotationDetail` (patrón de `OrderDetail`) permite
mover la cotización manualmente entre los 4 estados no terminales. Backend:
`PATCH /api/quotations/[id]/status`.

### 1. Transiciones permitidas
Libre entre `draft` / `sent_for_approval` / `approved` / `rejected`.
`converted_to_order` **no** es destino manual (solo se alcanza al generar la orden).

### 2. Reabrir una cotización convertida exige ELIMINAR la orden
Si el estado actual es `converted_to_order`, la guarda consulta `orders` por
`quotation_id`; si existe **cualquier** orden vinculada → 400
("Elimina la orden vinculada…"). Se eligió exigir **eliminación** (no solo
cancelación) por dos razones:
- Eliminar la orden ya restaura el inventario (`restoreOrderInventory`), igual que
  cancelar → sin doble manejo de stock.
- Garantiza **≤1 orden por cotización** en todo momento → evita órdenes huérfanas y
  mantiene `by-quotation` (`maybeSingle`) sin ambigüedad.

### 3. El cambio de estado regenera `approval_token`
Cada `PATCH /status` setea un `approval_token` nuevo (`crypto.randomUUID()`). El link
de aprobación compartido previamente deja de matchear → `/approve/[token]` devuelve
404. Cierra el hueco de seguridad: al reabrir una cotización a `sent_for_approval`, el
**mismo link viejo** se reactivaba y el cliente podía re-decidir y pisar el trabajo.
Se eligió **regenerar el token** (Opción A) sobre añadir una columna `approval_open`
para "congelar" el link: cero cambios de schema.

### 4. Las decisiones del cliente se preservan en cualquier estado
`PATCH /update` ahora preserva `is_approved` en **todos** los estados editables (antes
solo en `approved`). Al reabrir una cotización y agregar ítems nuevos, los ya aprobados
se conservan; los nuevos quedan `null` (pendientes). La página `/approve/[token]`
pre-selecciona los `is_approved === true`, así que el cliente solo decide los nuevos.

### 5. Guardas de UX
- El dropdown se deshabilita si hay cambios sin guardar (`isDirty`) → evita perder
  ediciones en el `refresh()` posterior al cambio de estado.
- Si la cotización está convertida con orden vinculada, el dropdown se deshabilita con
  tooltip + hint + un aviso en el banner ("elimina la orden para reabrir").
- Backend valida todo igual (defensa en profundidad; la UI solo guía).

---

## Consecuencias

- Se puede retrabajar una cotización grande sin recrearla.
- `is_approved` sobrevive a reaperturas y ediciones → el cliente no re-aprueba todo.
- El link de aprobación viejo muere al reabrir → no hay aprobaciones con links obsoletos.
- **Efecto colateral aceptado:** como el token se regenera en *cada* cambio de estado,
  si una cotización está en `sent_for_approval` con el cliente mirando el link y un
  usuario interno toca el dropdown, ese link muere en ese momento. Es el comportamiento
  correcto (el estado cambió), pero conviene tenerlo presente.
- `converted_to_order` deja de ser estrictamente terminal: es reversible **tras eliminar
  la orden**.

---

## Tests

- `tests/api/quotations.test.ts`: target inválido (converted) → 400; 404; revertir
  `sent_for_approval → draft` sin tocar ítems; guarda con orden vinculada → 400; sin
  orden → 200; **regenera `approval_token`**; **update preserva `is_approved` en draft**.

---

## NO incluido

- Historial/auditoría de cambios de estado (quién/cuándo/por qué).
- Restringir el dropdown a solo retroceder (hoy permite saltar a `approved` manualmente;
  `orders/create` ya bloquea si no hay aprobados).
- Auto-reabrir la cotización al eliminar su orden (queda manual e intencional).
- Control por rol (cualquier usuario autenticado puede cambiar el estado).

---

**Ver también:** [[06-Changelog/2026-06]] · [[CLAUDE.md]] · [[00-Inicio/Glosario#Estados de cotización]]
