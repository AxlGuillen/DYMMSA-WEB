# ADR-039 — Clientes: la cartera de Odoo y el estado de cuenta, leídos y nunca copiados

**Fecha:** 2026-10-15
**Estado:** Aceptado
**Relacionado:** [[ADR-025-Bloque-Odoo-MCP]] · [[ADR-027-Ingresos-desde-Odoo]] · [[ADR-034-MCP-Reglas-de-Crecimiento]] · issue #145

## Contexto

En la reunión del 2026-10-15 se pidió sacar rápido un **corte por cliente en un rango de fechas** con las facturas por pagar (vencidas o por vencer), para mandárselo al cliente como documento estructurado. La facturación oficial vive en Odoo (ADR-025); Finanzas ya lee de ahí lo abierto (ADR-027).

Decisiones del usuario (2026-10-15):

- **Rango:** fechas en la app ("vence desde / hasta") y un filtro vencidas / por vencer / ambas. Por el MCP, el periodo va en el prompt. Default: todo lo vencido + el mes en curso.
- **Alcance:** el flujo completo de clientes: lista de clientes de Odoo y un detalle con contacto, cartera, estado de cuenta, ventas y pagos recientes. Sección propia en el sidebar.
- **Exportar:** Excel + versión imprimible **sin datos sensibles** (solo nombre, folios, fechas y montos).
- **Pantalla:** sí muestra teléfono, correo y RFC (uso interno). La usa **todo el equipo** con sesión.

## Decisión

1. **Se lee, no se copia.** Dos lecturas cacheadas en `income-cache.ts` (15 min):
   - `res.partner` con `customer_rank > 0` (`fetchCustomers`, `src/lib/odoo/customers.ts`): páginas de 100 porque `days_sales_outstanding` se computa por registro (review PR #117), tope 5 páginas.
   - Las facturas y notas de crédito abiertas: **la misma lectura de Finanzas** (`cachedOpenCustomerMoves`). `OdooOpenInvoice` gana `customerId`, sacado del many2one crudo con `many2oneId()` (normalizar deja solo el nombre). La llave del caché subió a `open-moves-v2` porque cambió la forma de la fila.
   - Las ventas y pagos recientes del detalle (`fetchCustomerActivity`, 10 de cada uno) se cachean por cliente.
   - `POST /api/clients/refresh` purga los dos tags: el de clientes y el de Finanzas, que comparten lo abierto.
2. **Una sola matemática** en `src/lib/customers.ts` (pura, reloj inyectado), que usan las pantallas, el Excel y el MCP:
   - El rango es por **fecha de vencimiento**; sin vencimiento se usa la de factura, y una factura sin ninguna fecha **nunca se esconde**.
   - Vencida = vencimiento `<` hoy: vencer hoy es "por vencer" (la misma regla que `overdueDomain` y `splitReceivables`).
   - Se suman **saldos** (`amount_residual`), brutos. Las notas de crédito van aparte y **no se restan** (#102).
   - No se usa `total_due` de Odoo: es neto de notas de crédito y daría dos cifras distintas para lo mismo (#102). `days_sales_outstanding` sí se muestra, como "Días de cobro".
   - Un cliente facturado que no vino en la lista de clientes **igual tiene fila** (con el nombre de la factura): el dinero nunca se esconde porque una lista vino incompleta.
3. **El rango vive en la URL** (`from`, `to`, `filter`): la lista y el detalle lo comparten y un link reabre la misma vista. Un parámetro ausente toma el default; uno vacío abre ese límite. Las fechas se validan con `isRealDate()`.
4. **Privacidad del documento.** `generateStatementExcel` y el bloque de impresión solo llevan nombre, periodo, fecha de corte, folios, fechas y montos. El contacto (`print:hidden`) y el RFC se quedan en la pantalla. Con el modo discreto, la pantalla enmascara pero lo impreso lleva el monto real: un estado de cuenta con "$•,•••" no sirve.
5. **Acceso:** `requireAuth` en las tres rutas, todo el equipo. Odoo se lee con la llave del servidor, así que no hay RLS que aplique; es la misma postura que los ingresos de Finanzas.
6. **Si Odoo falta o falla**, las rutas responden 200 con `reason` (`not_configured` / `odoo_error`) y la pantalla lo dice; nunca 500 (ADR-027).
7. **MCP: se extiende una tool en vez de agregar otra.** La app está en 36/36 y Odoo en 15/16 (ADR-034). `odoo_overdue_invoices` gana `cliente`, `vence_desde`, `vence_hasta` e `incluir` (`vencidas | por_vencer | ambas`, default `vencidas`). Sin ellos responde como antes; con cualquiera, da el estado de cuenta con la misma lib y **una sola** lectura de Odoo. El cliente se busca con `fold` (sin acentos ni mayúsculas), primero exacto y luego parcial, y con `requireSingleMatch`: un nombre ambiguo es error, nunca adivinanza. `fold` se mudó a `mcp/shared.ts` (lo usaba Nómina). Para caber en `TOOL_BUDGET` (tools/list 40,000 e instrucciones 7,500), la descripción quedó corta y las fechas sin `describe` propio.

**Revisión adversarial (2026-10-16, 3 revisores + verificadores):**

- **Moneda.** Los saldos se suman sin convertir, como en Finanzas (ADR-027 §7), pero ahora se dice. `StatementLine` y `CreditNoteLine` llevan `currency`; estado de cuenta, filas y totales traen `currencies`, la lista de monedas distintas de MXN. La pantalla pone una insignia por línea y un aviso en las tarjetas. El Excel lleva la columna Moneda y una fila de aviso, y la impresión también avisa. El MCP agrega `moneda` por línea y `monedas_sin_convertir`.
- **MCP sin cliente:** ahora también reporta `notas_credito_sin_aplicar`, incluidos los clientes que solo tienen notas de crédito, y redondea con `customersTotals`. Si se pasan fechas sin `incluir`, el default es `ambas`: una ventana futura con "solo vencidas" daría un cero engañoso. La etiqueta de un nombre ambiguo lleva el id (`Andritz (#24)`). Un `cliente` en blanco da error.
- **Filtro de fechas:** cada input guarda un borrador. Solo llega a la URL una fecha real ≥ 2000-01-01, porque al teclear el año pasa por 0002, 0020…. Un "desde" posterior a "hasta" se queda en el input con un mensaje en vez de regresarse sin avisar.
- **Fechas y avisos:**
  - La fecha de una venta se convierte a la hora de México (`date_order` es UTC).
  - Si la lectura de Odoo vino truncada, el Excel y la impresión lo dicen.
  - El pie de la app ya no se imprime.
  - "Actualizar" en Finanzas también deja viejas las consultas de Clientes. Las llaves compartidas viven en `src/hooks/odoo-query-keys.ts`, para no tener un import circular.
  - `formatMoney()` en `format.ts` es el formato único de pesos, y `useCurrency` lo enmascara.
- **Refutado:** agrupar por el `partner_id` crudo no parte a ningún cliente en la instancia real.

**Review del PR #148 (sin bloqueantes):**

- `GET /api/clients/[id]` ya no carga la lista entera de clientes para resolver uno. `fetchCustomer` lee un solo partner por id, con `customer_rank > 0`, en el mismo caché que su actividad (`activity-v2`). En frío, la lista costaba hasta 5 páginas con `days_sales_outstanding` calculado por registro.
- En el MCP, `incluir` vale `ambas` por defecto. Con solo `cliente`, la ventana es la misma que en la pantalla (todo lo vencido + este mes), así que "el estado de cuenta de X" responde igual por el chat que en la app. Con cliente, `limit` no recorta y se lista todo; ahora la descripción lo dice.
- Las líneas sin fecha se ordenan al final, en `statementLines` y en `primeras`.
- JSDoc de `sanitizeFilename`/`formatMoney` en su lugar.

## Alternativas descartadas

- **Copiar clientes y facturas a una tabla:** dos verdades y una sincronización que mantener. ADR-027 ya eligió leer.
- **Usar `total_due` / `total_overdue` de Odoo:** son netos de notas de crédito y no se filtran por rango.
- **Una tool `odoo_customer_statement` nueva:** no hay cupo, y la pregunta es la misma de `odoo_overdue_invoices` con un rango.
- **Una librería de PDF:** `window.print()` con clases `print:` ya da un PDF desde el navegador, sin dependencia.

## Pruebas

- `tests/lib/customers.test.ts`: default de rango (fin de mes, bisiesto, diciembre), parseo y errores, ida y vuelta de `rangeQuery`, líneas (sin notas de crédito, orden, hoy = por vencer, extremos inclusivos, sin fechas), textos, totales redondeados, notas de crédito sin rango y el resumen por cliente.
- `tests/lib/statement-excel.test.ts`: encabezado, filas, formato de pesos, pie y que ninguna celda traiga RFC o contacto.
- `tests/api/clients.test.ts`: 401, 400 de rango, degradación a 200, camino feliz, cliente facturado fuera de la lista, 404 y la purga de los dos tags.
- `tests/mcp/odoo-accounting.test.ts`: el modo estado de cuenta (una llamada, acentos, default vencidas, rango, ambiguo, fechas inválidas, sin cliente con `limit`).
- `tests/components/customers.test.tsx`: filtros, rango en la URL, contacto vs. Excel, lo impreso, modo discreto, 404 y anti-drift de los dos tours.
