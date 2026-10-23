# MCP escrituras — Aprobación pública

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[02-Arquitectura/MCP-Escrituras/Cotizaciones]] · [[04-Decisiones-Tecnicas/ADR-011-Guardar-Avance-Aprobacion]]

## Resumen

`/approve/[token]` es la página **sin sesión** donde el cliente aprueba línea por línea. Escribe `quotation_items.is_approved` y, al enviar, `quotations.status` (`approved`/`rejected`) y `approved_at`. Lo hace con **service role** (`createAdminClient`, sin RLS): el token es la única llave. El MCP no la cubre ni debe: es la voz del cliente. El equivalente interno ("el cliente me dijo por teléfono…") se resuelve con la tool de [[02-Arquitectura/MCP-Escrituras/Cotizaciones]]. El mapeo encontró un **bug de ids viejos** que se vuelve más probable en cuanto el chat pueda editar cotizaciones en revisión.

## Rutas que escriben

### `POST /api/approve/[token]` — `src/app/api/approve/[token]/route.ts`
- **Auth / rol:** **ninguna**. `createAdminClient()` = service role, sin RLS; la cotización se identifica solo por `approval_token` (UUID UNIQUE).
- **Entrada:** `{ approvedIds?: string[] = [], finalize?: boolean = false }`, casteado sin zod. Solo valida que `approvedIds` sea un arreglo (si no, 400). **No valida que sean UUID**: un id con otra forma truena en Postgres (22P02) y la ruta responde 500 genérico.
- **Qué hace:**
  1. SELECT por token → 404 si no existe.
  2. Si `status !== 'sent_for_approval'` → 400 "Esta cotización ya fue procesada".
  3. Reset masivo: `is_approved = null` (guardar avance) o `false` (enviar) a los productos con `is_sold` null o true.
  4. Si hay ids: `is_approved = true` con `.in('id', approvedIds)` dentro de la cotización.
  5. `finalize=false` → responde `{ saved, finalized: false, approvedCount }` **sin tocar el status**: el link sigue vivo.
  6. `finalize=true` → UPDATE `status = approvedIds.length > 0 ? 'approved' : 'rejected'` y `approved_at = now` (o **null** si rechazó), con la guarda optimista `.eq('status', 'sent_for_approval')`. 0 filas → 409.
  7. Si quedó `approved`: lee las líneas aprobadas y llama `sendApprovalNotification()` con el total de lo aprobado (`calculateQuotationTotal(..., { onlyApproved: true })`), aislado en try/catch. El correo está **apagado** (`EMAIL_NOTIFICATIONS_ENABLED = false`, ADR-012).
- **Reglas y efectos secundarios:**
  - `is_sold=false` nunca se resetea ni es aprobable desde la página ("No disponible").
  - Separadores fuera del reset.
  - Concurrencia entre dos pestañas → 409 sin pisar.
  - No hay transacción entre el reset y la aprobación: si el segundo UPDATE falla, queda todo reseteado y responde 500.
  - ⚠️ **Bug de ids viejos.** `PATCH /api/quotations/[id]/update` borra y re-inserta las líneas: ids nuevos en cada guardado, **sin regenerar el token**. Si DYMMSA edita mientras el cliente tiene la página abierta (algo permitido: `sent_for_approval` es editable, Fase 5.5), el `approvedIds` del cliente ya no coincide con nada:
    - "Guardar avance" resetea a `null` todas las aprobaciones (incluidas las que `update` acababa de preservar) y aprueba 0 filas;
    - "Enviar" marca todas `false` y aun así deja la cotización **`approved`** (cuenta `approvedIds.length`, no las filas actualizadas) con 0 líneas aprobadas y `approved_at` sellado;
    - y además, entre el DELETE y el INSERT de `update`, la cotización tiene 0 ítems.

    Arreglo posible (fuera de esta fase): comparar las filas actualizadas contra `approvedIds` → 409 "la cotización cambió, recarga". Otra opción: que `update` regenere el token o lo invalide mientras está `sent_for_approval`.
  - ⚠️ **`approved_at` contradice CLAUDE.md.** CLAUDE.md dice "se preserva en cualquier fase posterior — nunca se borra" y "solo si aún no existe → conserva la original". Aquí un **rechazo lo pone en `null`** y una re-aprobación **lo re-sella con la fecha nueva**. Escenario: aprobada → reabierta a `sent_for_approval` con `/status` (lo preserva) → el cliente rechaza todo → se borra la fecha original. El 2026-07-09 se arregló solo en `/status`; `tests/api/approve.test.ts` ("finalizar sin aprobados: status rejected, approved_at null") fija el comportamiento actual, y ADR-011 §4 sigue diciendo "se limpia al salir de approved" (desfasado). Hoy no hay ninguna cotización `rejected` con `approved_at` en null (consulta del 2026-10-22), pero la regla está en conflicto.
  - ⚠️ El UPDATE `is_approved = true` **no filtra** por `item_type` ni `is_sold`. Una petición armada a mano (basta el token) puede aprobar un separador o una línea "no la vendemos". El impacto es bajo (`create-order` y los totales los vuelven a excluir) pero rompe "separadores excluidos de `is_approved`". Hoy hay 0 separadores con `is_approved` en la nube.
- **Dónde vive la lógica:** inline en la ruta; usa `calculateQuotationTotal` (business-rules) y `sendApprovalNotification` (`src/lib/email/`). Nada reutilizable por una tool, y no hace falta (ver Propuesta).
- **Quién la usa en la UI:** `ApprovalClient.tsx` (`postDecisions(finalize)`): "Guardar avance" sin confirmación y "Enviar" con AlertDialog. La página (`page.tsx`) lee la cotización **directo con el admin client**, no por la API.

### Referencia (lectura): `GET /api/approve/[token]`
- Sin auth, service role. Devuelve `id, customer_name, status, total_amount, created_at, quotation_items(*)`.
- **No la usa la UI**: `page.tsx` hace su propio SELECT; solo la llaman los tests.
- En `tests/mcp/coverage.test.ts` ya está excluida ("fuera: página pública sin sesión").

## Cobertura MCP actual
- Ninguna tool escribe aprobaciones.
- Lectura: `get_quotation` trae `is_approved` por línea, `total_approved` y `approved_at`. **No** expone `approval_token` ni el link. Tampoco hay manera de distinguir "el cliente guardó avance" de "nadie ha tocado la página": no existe un sello de cuándo guardó; solo se ve que hay líneas `true` con el estado aún `sent_for_approval`.
- Las instrucciones del servidor (`BUSINESS_RULES_MD`) ya avisan que cambiar el estado regenera el token.

## Casos de uso desde el chat
1. "¿Ya aprobó el cliente la de Andritz? ¿Qué le quitó?" → lectura (`get_quotation`); ya cubierto.
2. "El cliente me dijo por WhatsApp que aprueba todo menos la línea 5" → **interno**: `update` con `is_approved` por línea + `/status approved` (sella `approved_at` solo si no existe). Va por `save_quotation`, no por esta ruta.
3. "Pásame el link de aprobación" → `approval_token` + `appUrl()` (`src/lib/mcp/env.ts`); depende de la pregunta 7 de [[02-Arquitectura/MCP-Escrituras/Cotizaciones]].
4. "El cliente se equivocó, ábrele otra vez la aprobación" → `/status sent_for_approval`: token nuevo (link nuevo), y conserva `is_approved` (la página los pre-selecciona).
5. "Ya no le dejes aprobar" → `/status draft` o `rejected`: el token se regenera y el link viejo muere.
6. "Aprueba la cotización como si fuera el cliente desde su link" → **no**: es la ruta pública (ver Fuera).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Guardar avance del cliente (`finalize=false`) | alto (para el MCP) | Es la decisión del cliente, sin sesión; con ids viejos borra aprobaciones |
| Enviar decisión del cliente (`finalize=true`) | alto | Cambia el estado de forma irreversible desde la página (409 a la segunda); hoy puede dejar `approved` con 0 líneas |
| Registrar internamente lo que dijo el cliente (`is_approved` + `approved`) | medio | Vía la tool de Cotizaciones con resumen y `confirmar`; deja la decisión registrada por DYMMSA, no por el cliente |
| Reabrir la aprobación (nuevo link) | medio | `/status` regenera el token; el link anterior muere |

## Propuesta de tools
- **Ninguna tool nueva para esta ruta: 0 tools.**
- El equivalente interno vive en `save_quotation` ([[02-Arquitectura/MCP-Escrituras/Cotizaciones]]):
  - `cambios[].aprobacion: 'aprobada' | 'rechazada' | 'pendiente'` → `update` (`is_approved`);
  - `estado: 'approved' | 'sent_for_approval' | …` → `/status`, con `confirmar` porque regenera el token.
- Mejora de lectura opcional (sin tool nueva): `get_quotation` podría devolver `link_aprobacion` (solo admin) si se responde que sí a la pregunta 7 de Cotizaciones.
- **Requisito previo** para cualquier escritura que edite cotizaciones en `sent_for_approval` (la de la app o la del chat): arreglar el bug de ids viejos de esta ruta.

## Fuera a propósito
- `POST /api/approve/[token]`: es la decisión del **cliente**, sin sesión y con service role. Si el MCP la llamara (o reprodujera su lógica), DYMMSA aprobaría "como el cliente", con el token como única prueba, y la RLS no aplica. Lo interno va por `save_quotation`, que deja claro que lo registró DYMMSA.
- `GET /api/approve/[token]`: lectura pública; ya está excluida en `coverage.test.ts` y `get_quotation` cubre lo mismo con sesión.

## Preguntas abiertas
1. **Bug de ids viejos:** ¿se arregla antes de abrir escrituras de cotizaciones al chat? Opciones: (a) `/approve` responde 409 si algún id no existe; (b) `update` regenera el token mientras está `sent_for_approval`; (c) ambas.
2. **`approved_at` al rechazar o re-aprobar desde la página:** ¿se alinea con CLAUDE.md (nunca borrar; conservar la fecha original) o se corrige CLAUDE.md para decir que la página del cliente sí la mueve? Hay que actualizar ADR-011 §4 en cualquier caso.
3. ¿El POST debe filtrar `approvedIds` a productos aprobables (`item_type = 'product'` y `is_sold` distinto de `false`) y validar que sean UUID (hoy 22P02 → 500)?
4. Cuando DYMMSA registre una aprobación "de palabra" desde el chat, ¿debe quedar rastro de quién la registró (hoy `quotations` no tiene bitácora; `audit_events` solo cubre `payable`)?
