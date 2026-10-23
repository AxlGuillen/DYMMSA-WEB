# MCP — Auditoría del conector «Odoo DYMMSA»

> Issue #155 · Auditoría contra la rúbrica R1–R12 · 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[04-Decisiones-Tecnicas/ADR-025-Bloque-Odoo-MCP]] · [[04-Decisiones-Tecnicas/ADR-034-MCP-Reglas-de-Crecimiento]] · [[04-Decisiones-Tecnicas/ADR-039-Clientes-y-Estado-de-Cuenta]] · [[04-Decisiones-Tecnicas/ADR-040-Escrituras-Acotadas-en-Odoo]]

## Resumen

Se auditaron las **19 tools `odoo_*`** del bloque `odoo` del manifiesto (15 de lectura y 4 de #144), que pasan al conector **«Odoo DYMMSA»** (`/api/odoo/mcp`). Para cada una se leyó el registro (`src/lib/mcp/server.ts`, desde «Block B»), su implementación (`src/lib/mcp/tools/odoo/*.ts`) y la forma real de su respuesta.

**Medición de hoy**, con el mismo método de `tests/mcp/manifest.test.ts` (nombre + título + descripción + esquema JSON + `_meta`, sin anotaciones):
- **Tools:** 19, que suman 6,932 caracteres de descripción y **18,019 de `tools/list`**.
- **Instrucciones que hoy son de Odoo:** el bloque B mide 1,372 caracteres, la regla de oro y la de confirmar 463, las notas de crédito 324 y las dos viñetas de Odoo en `BUSINESS_RULES_MD` 565. En total, unos **2,700**.

**Propuesta:** **15 tools**, de las que 14 ve el modelo, porque `odoo_save_product` solo la llama la vista. Su `tools/list` mediría unos **16,300 caracteres** y las instrucciones propias unos **2,800** (de ellos, unos 600 solo los recibe el admin).
- **Qué sale:** se fusionan 6 tools en 3, se retiran 2 que ya cubre la primitiva y se parte `odoo_save_quotation` en guardar y confirmar.
- **Qué gana sobre todo:** claridad. Hoy tres tools contestan «¿quién nos debe?» con dos cifras distintas, una tool tiene tres formas de salida según sus parámetros, y 13 de 15 lecturas no tienen verbo en el nombre.

## 1. Hallazgos transversales

1. **Los nombres no tienen verbo (R4), y separar el conector es el momento barato de corregirlo.**
   - 13 de las 15 lecturas tienen la forma `odoo_<objeto>_<sustantivo>`: `invoices_summary`, `customer_profile`, `rep_audit`, `stock_check`, `fleet_status`… (`server.ts:742-966`). Solo las escrituras siguen `verbo_objeto`.
   - Separar el conector **ya rompe los nombres calificados**: en Claude Code las tools pasan de `mcp__dymmsa__odoo_x` a `mcp__<conector-odoo>__odoo_x`, y en claude.ai el permiso por tool («Always allow») es por conector, así que vuelve a pedirse. Renombrar en el mismo cambio no agrega un costo nuevo, salvo en el código y en las rutinas que citen nombres.
   - En el código, cada nombre aparece en `server.ts`, `manifest.ts` y uno o dos tests. `odoo_save_product` aparece además en la vista (`src/mcp-views/odoo-quotation/main.ts:144`).
   - **El prefijo `odoo_` se queda.** Con los dos conectores prendidos en el mismo chat, el modelo elige por nombre y descripción. Sin prefijo, `save_quotation` de DYMMSA-WEB (propuesta en [[02-Arquitectura/MCP-Escrituras/Cotizaciones]]) y la de Odoo se llamarían igual (hallazgo 9 de la matriz). El prefijo también sostiene la regla de bloque del test (`manifest.test.ts:73-74`).
2. **Tres tools contestan «¿quién nos debe?» con cifras distintas (R3).**
   - `odoo_overdue_invoices` suma las facturas abiertas, **bruto por factura** (`accounting.ts:217-237` y `246-288`).
   - `odoo_receivables_ranking` usa el **saldo contable neto** de Odoo (`total_due`, `total_overdue`; `receivables.ts:26-36`).
   - `odoo_customer_profile` trae las dos cifras: la cartera neta en `sales.ts:133` y las vencidas brutas en `sales.ts:145-150`. `CARTERA_NOTA` (`receivables.ts:35`) existe justamente para que el modelo no las cuadre.
   - La pantalla Clientes decidió la cifra bruta (ADR-039: «no se usa `total_due`»). El ranking es la única vista que usa la neta como dato principal.
3. **Una tool cambia de forma según sus parámetros (R1).**
   - `odoo_overdue_invoices` (`accounting.ts:240-241`) devuelve tres formas:
     - sin parámetros, la cartera vencida;
     - con fechas o `incluir`, el estado de cuenta global;
     - con `cliente`, el estado de cuenta de un cliente.
   - Hasta el default cambia: sin parámetros trae **solo vencidas** (`accounting.ts:243`), y con cualquier parámetro trae **`ambas`** (`accounting.ts:161`).
   - El mismo concepto se llama distinto en cada modo: `mas_vencidas` contra `primeras` (`:279` y `:236`), `facturas_vencidas` contra `facturas`, `monto_pendiente` contra `saldo`.
   - `odoo_save_quotation` mezcla crear, editar y **confirmar**, y confirmar es un ciclo de vida con otras entradas y otro efecto (`quotations.ts:803-805`; `confirmar` en `:112`).
4. **Las anotaciones no son fieles (R8).**
   - Las 15 lecturas usan `readOnly = { readOnlyHint: true, openWorldHint: false }` (`server.ts:64`).
   - Las 3 escrituras visibles declaran `{ readOnlyHint: false, openWorldHint: false }` (`server.ts:994`, `1008`, `1021`), sin `destructiveHint` ni `idempotentHint`. Por default eso significa «destructivas y no idempotentes», y las tres **son idempotentes por diseño**:
     - las cotizaciones, por el marcador `origin` (`write-catalog.ts:16`);
     - la factura, porque devuelve `ya_existe` (`draft-invoice.ts:265`);
     - los productos, porque devuelve `ya_existian` (`products-write.ts:207`).
   - Los mensajes de resultado incierto **piden repetir la misma llamada** (`client.ts:28-32`), lo que contradice `idempotentHint: false`.
   - **`openWorldHint` → `true` en todo el conector:**
     - Odoo es un sistema de terceros que el servidor no controla: otras personas lo editan, el PAC y el SAT escriben mensajes en `l10n_mx_edi.document.message`, y confirmar dispara efectos propios de Odoo (la entrega OFI/OUT, el chatter).
     - Además, el texto que trae (notas al pie, nombres de línea, mensajes del SAT) no lo escribió DYMMSA-WEB.
     - El `false` de hoy se copió de la constante de la app, cuyo dominio sí es cerrado.
5. **Los parámetros mezclan idiomas y no llevan restricciones reales (R5).**
   - **Idioma:** hay `date_from`, `date_to`, `group_by` y `limit` junto a `cliente`, `vence_desde`, `incluir` e `incluir_ligadas` (`server.ts:784-788`, `803-805`, `818-821`, `905-906`, `920-923`).
   - **Fechas:** solo dicen el formato en `describe` (`server.ts:786-787`, `803`). La validación llega tarde, en `assertDateRange` (`dates.ts:8-15`), y el modo estado de cuenta revisa además que la fecha exista; los demás modos no.
   - **`odoo_query.model`** es texto libre (`server.ts:748`), cuando podría ser un `enum` de `ODOO_CATALOG` que además documentaría el catálogo.
   - **Llaves desconocidas:** los esquemas de lectura son `z.object` (el SDK descarta en silencio las llaves que no existen). Por ejemplo, `odoo_invoices_summary({ cliente: 'GE' })` devolvería **el total de todos los clientes** sin avisar. Las escrituras sí usan `z.strictObject` + `parseInput` (`quotations.ts:116-117`, `214-221`).
6. **Las búsquedas por nombre no pasan por `requireSingleMatch`, y «no encontrado» no es error (R5, R7).**
   - `odoo_customer_profile` (`sales.ts:66-87`):
     - busca con `ilike` **sin `escapeLike`**, con límite de 5 y sin preferir la coincidencia exacta: «GE» choca con cualquier nombre que contenga «ge»;
     - devuelve **éxito** con `encontrado: false`.
   - `findByFolio` (`documents.ts:42-73`) también responde con éxito y `encontrado: false` (`documents.ts:88-90`, `payments.ts:55-57`).
   - El resolvedor de las escrituras ya hace lo correcto: acepta nombre, RFC o `#id`, prefiere lo exacto, usa `requireSingleMatch` y reporta los archivados (`resolve.ts:73-101`). Es el que debe usar la lectura.
7. **Las respuestas traen valores sin resolver (R6).**
   - Los `grupos` de los resúmenes salen con llaves y valores crudos de Odoo, como `{ payment_state: 'not_paid', amount_total, amount_residual, count }` (`accounting.ts:312-318`, `sales.ts:40-46`, `93-106`).
   - El detalle de factura y de venta devuelve `estado: 'posted'`, `estado_pago: 'not_paid'` y `estado_facturacion: 'to invoice'` (`documents.ts:113-114`, `187-188`). El detalle de pago sí los traduce (`payments.ts:22-28`, `95`).
   - `odoo_customer_profile.cliente` sale con llaves en inglés (`name`, `vat`, `country_id`; `sales.ts:132`).
   - `sale.order.date_order` llega en UTC (`documents.ts:184`). Los rangos de ventas cortan el día en UTC (`sales.ts:36-37`), así que una venta del 31 de julio a las 20:00 de Morelia cae en agosto.
8. **Se suman montos de distintas monedas sin avisar (R6, ADR-027 §7).**
   - Los resúmenes, la cartera sin parámetros y el expediente suman `amount_total` y `amount_residual` sin agrupar por moneda (`accounting.ts:275`, `331-332`; `sales.ts:52`, `141-142`).
   - Solo el modo estado de cuenta reporta `monedas_sin_convertir` (`accounting.ts:186-187`, `211`).
9. **Cada tool envuelve su respuesta distinto (R6).**
   - El aviso se llama `nota` (a veces string, a veces `undefined` y a veces `null`), `mensaje` o `nota_vehiculos`.
   - `llamadas` (`links.ts:125`, `receivables.ts:87`) es una métrica interna que no le sirve al modelo.
   - En `odoo_query`, `count` son las filas devueltas y no el total (`accounting.ts:66`), y su proyección por default son **todos** los campos del catálogo: 21 en `account.move`, `narration` incluida.
   - `incluir_ligadas` no tiene tope y puede devolver cientos de facturas (`links.ts:124`).
   - Ninguna tool usa `structuredContent` ni `outputSchema`: `ToolResult` solo tiene texto (`server.ts:41`, `53`).
10. **Las lecturas no tienen plazo (R7, R11).**
    - Solo las escrituras usan `startDeadline` (`quotations.ts:789`, `products-write.ts:195`, `draft-invoice.ts:241`). Ninguna lectura usa `withinBudget()` (`budget.ts:4-13`), que las rutas sí aplican.
    - Los barridos encadenan hasta 11 llamadas (`links.ts:13-14`, `receivables.ts:12-13`), cada una con 25 s de timeout (`client.ts:160`), así que pueden pasar el `maxDuration` de 60 s. En ese caso el modelo recibe un 504 opaco en lugar de un error que pueda corregir.
11. **Las primitivas pueden saltarse reglas que las curadas sí aplican (R3).**
    - `odoo_query` y `odoo_aggregate` llegan a `account.move` y `sale.order` sin las reglas de las curadas: notas de crédito aparte, solo publicadas, solo confirmadas, día local.
    - Su descripción dice «para preguntas que las curadas no cubran» (`server.ts:746`), pero no dice qué se pierde al usarlas.
    - `odoo_employee_directory` y `odoo_fleet_status` (`operations.ts:53-113`) son exactamente una llamada de la primitiva sobre `hr.employee` y `fleet.*` (`catalog.ts:66-77`).
12. **Las descripciones y los títulos se repiten o empujan pasos (R9).**
    - «(externo)» o «sistema externo» se repite en 12 descripciones.
    - El flujo cotizar → guardar está a la vez en las descripciones (`server.ts:976`, `992`) y en las instrucciones (`server.ts:128`).
    - El `siguiente_paso` de confirmar empuja a facturar (`quotations.ts:775`) aunque nadie lo haya pedido.
    - Tres títulos no llevan «(Odoo)» (`server.ts:744`, `763`, `933`).
13. **`odoo_create_draft_invoice` escribe sin mostrar antes qué facturaría (R10).**
    - Su descripción dice «tras decir cuál y recibir el sí» (`server.ts:1019`), pero Claude no puede decir el cliente ni el total: solo los conoce la tool, y los lee al escribir (`draft-invoice.ts:247-263`).
    - El riesgo es medio: el borrador no consume folio y se borra en Odoo, pero el asistente no puede borrarlo.
14. **Lo que la separación tiene que resolver.**
    - **`get_month_closing` se queda en DYMMSA-WEB** y sigue leyendo Odoo del lado del servidor (`income-cache.ts`), así que ese conector sigue necesitando `ODOO_*`. ADR-034 descartó partir el conector porque «el cierre del mes cruza ambos lados». El cruce no pasa por las tools de Odoo, así que esa objeción ya no aplica.
    - **`coverage.test.ts:30-32`** cubre `/api/clients*` con `odoo_overdue_invoices`: debe mirar los manifiestos de los dos conectores, con los nombres nuevos.
    - **El test del manifiesto y el consentimiento** suponen un solo servidor con dos bloques: `manifest.test.ts:73-87`, `consentSummary` (`consent.ts:20-22`) y `BUSINESS_RULES_MD`, que mezcla reglas de los dos (`server.ts:94-95`).
    - **Las lecturas de Odoo no usan el token del usuario** (ADR-025 §6). En el conector nuevo, el OAuth solo da la identidad, el rol para la lista y `requireLiveAdmin` (`shared.ts:61-68`).
15. **Para #154, la vista previa ya tiene con qué buscar la clave SAT.**
    - Las escrituras leen con proyecciones fijas fuera de `ODOO_CATALOG` (ADR-040), y `products-write.ts:146-154` ya consulta `product.unspsc.code`. Sugerir la clave en la vista previa **no exige tocar el catálogo ni agregar una tool**.
    - El presupuesto de #154 («19 de 20») deja de ser el límite al separar el conector.

## 2. Tabla por tool actual

Entre paréntesis va lo que cada tool mide hoy en `tools/list` (en caracteres).

| tool | qué hace | reglas que incumple | veredicto | detalle |
|---|---|---|---|---|
| `odoo_query` (1,286) | Lee registros de cualquier modelo del catálogo (`search_read`, máx 50) | R3, R4, R5, R6, R8 | renombrar → `odoo_search_records` y ajustar | `model` como `enum` del catálogo; proyección corta por modelo (`fields` para el resto); `truncado` y `siguiente_offset` en vez de `count`; la descripción dice qué reglas no aplica. Conserva el vocabulario de Odoo (excepción declarada a R5) |
| `odoo_aggregate` (1,027) | Totales agrupados que calcula Odoo (`read_group`) | R3, R4, R5, R8 | renombrar → `odoo_aggregate_records` y ajustar | `metrics` con regex `campo:sum\|avg\|min\|max\|count` en el esquema; `model` como `enum`. Se le avisa que no separa notas de crédito |
| `odoo_overdue_invoices` (847) | Cartera vencida global o estado de cuenta (global o de un cliente), según los parámetros | R1, R3, R4, R5, R6, R8 | partir: lo global se fusiona con `odoo_receivables_ranking` en `odoo_list_receivables`, y lo de un cliente con `odoo_customer_profile` en `odoo_get_customer` | Tres formas de salida y dos defaults (hallazgo 3). Sin parámetros suma monedas sin avisar |
| `odoo_invoices_summary` (788) | Facturado y pendiente de un periodo, agrupado, con notas de crédito aparte | R4, R5, R6, R8 | renombrar → `odoo_summarize_invoices` y ajustar | Parámetros en español (`desde`, `hasta`, `agrupar_por`) y `cliente` opcional con `requireSingleMatch`. `grupos` con estados traducidos y separados por moneda. Esquema estricto |
| `odoo_sales_summary` (719) | Ventas de un periodo agrupadas; por default solo confirmadas | R4, R5, R6, R8 | renombrar → `odoo_summarize_sales` y ajustar | Lo mismo que la anterior, más el corte del día en hora de Morelia (no en UTC) |
| `odoo_customer_profile` (903) | Expediente de un cliente: contacto, cartera neta, ventas, facturación, vencidas y notas de crédito | R3, R4, R5, R6, R7, R8 | fusionar con el modo cliente de `odoo_overdue_invoices` en `odoo_get_customer` | Búsqueda sin exacto primero ni `requireSingleMatch`; «no encontrado» = éxito. Cartera neta y bruta mezcladas en la misma respuesta (hallazgos 2 y 6) |
| `odoo_receivables_ranking` (840) | Clientes con saldo ordenados por vencido y por días de pago (DSO), con la cifra neta de Odoo | R3, R4, R6, R8, R11 | fusionar con `odoo_overdue_invoices` en `odoo_list_receivables` (`ordenar: dias_pago`) | Hasta 11 llamadas (unos 12 s) para leer todos los partners; el DSO cabe en una sola lectura de los clientes que ya tienen saldo. `llamadas` es ruido |
| `odoo_invoice_detail` (758) | Factura por folio: encabezado, vínculo con la venta, CFDI y líneas | R4, R6, R7, R8 | fusionar con `odoo_sale_detail` y `odoo_payment_detail` en `odoo_get_document` | Estados crudos; «no encontrado» = éxito |
| `odoo_sale_detail` (699) | Venta o cotización por folio: facturas ligadas y líneas pedido/entregado/facturado | R4, R6, R7, R8 | fusionar → `odoo_get_document` | Estados y fecha en UTC sin traducir. Con un folio de cotización se parece a `odoo_preview_quotation` en modo revisar, y la descripción debe separarlas |
| `odoo_payment_detail` (586) | Pago por folio: REP, estado SAT y facturas que paga | R4, R7, R8 | fusionar → `odoo_get_document` | Es la única de las tres que traduce estados |
| `odoo_rep_audit` (661) | Barrido de pagos de un periodo por su complemento de pago (REP) | R4, R5, R8 | renombrar → `odoo_audit_payment_complements` | Parámetros en español; sin cambios de lógica |
| `odoo_invoice_link_check` (1,084) | Barrido de facturas de un periodo sin orden de venta ligada (huérfanas y vínculos rotos) | R4, R5, R6, R8, R9 | renombrar → `odoo_audit_invoice_links` y ajustar | Tope por lista con conteo (`incluir_ligadas` hoy no lo tiene); fuera `llamadas`; descripción de 529 caracteres → ~400 |
| `odoo_stock_check` (542) | Existencias del almacén de Odoo por producto, sumando ubicaciones | R4, R8 | renombrar → `odoo_search_stock` | Conserva la aclaración de que no es `search_inventory` (tienda de DYMMSA-WEB) |
| `odoo_employee_directory` (349) | Directorio laboral de `hr.employee` | R3, R4, R11 | retirar | Es `odoo_search_records({ model: 'hr.employee' })`. Se cubre con una línea en las instrucciones |
| `odoo_fleet_status` (325) | Vehículos y últimos servicios de la flotilla | R3, R4, R11 | retirar | Son dos `odoo_search_records` (`fleet.vehicle` y `fleet.vehicle.log.services`). Igual que la anterior |
| `odoo_preview_quotation` (2,486) | Solo lee: vista previa de crear, editar o revisar una cotización, y firma la `clave` | R8 | ajustar (#154 y anotaciones) | `categoria_sat` por línea y `sugerencias_sat` en los productos nuevos (sección 3). El patrón HMAC es correcto (R10: alto). `lineas_como_entrada` ya es la referencia corta de R6 |
| `odoo_save_quotation` (2,419) | Escribe lo que mostró la vista previa: crear, editar o **confirmar** | R1, R4, R8 | partir: `odoo_save_quotation` (crear o editar) y `odoo_confirm_quotation` (confirmar) | Confirmar es ciclo de vida: crea la entrega y solo se deshace en Odoo. Lleva otras entradas (folio y clave, sin `lineas`) y otra confirmación (`al_confirmar`). Declarar `destructive: true` e `idempotent: true` |
| `odoo_save_product` (1,092) | Solo desde el botón de la vista: da de alta los bienes nuevos | R8 | mantener (ajustar anotaciones; #154) | `destructive: false` e `idempotent: true`. Acepta la clave SAT elegida en la vista si está entre las firmadas. Ocupa `tools/list` aunque el host no se la muestre al modelo (`visibility: ['app']`) |
| `odoo_create_draft_invoice` (608) | Factura completa en borrador de una venta confirmada | R8, R10 | ajustar (patrón medio y anotaciones) | Sin `confirmar`, devuelve el resumen (cliente, total a facturar, líneas facturables, entregas y `sin_clave_sat`) y no escribe; con `confirmar: true`, crea el borrador. `destructive: false` e `idempotent: true`. El nombre se queda: es la excepción con nombre de ADR-040, y «draft» es una señal de seguridad en el diálogo de permiso |

**Conteo:** 7 se renombran (2 de ellas solo de nombre), 6 se fusionan en 3, 2 se retiran, 1 se parte en 2 y 3 se ajustan conservando su nombre.

## 3. Catálogo objetivo del conector «Odoo DYMMSA»

Columnas:
- **L/E:** lectura (L) o escritura (E).
- **Anotaciones:** RO = `readOnlyHint`, D = `destructiveHint`, I = `idempotentHint`, OW = `openWorldHint`. En las lecturas, D e I no aplican (la spec los ignora con RO = true).
- **Confirmación:** el patrón del proyecto (bajo, medio o alto).

| # | Tool | L/E | Anotaciones | Confirmación | Origen | Qué responde |
|---|---|---|---|---|---|---|
| 1 | `odoo_get_document` | L | RO ✓ · OW ✓ | — | Fusión de `odoo_invoice_detail`, `odoo_sale_detail` y `odoo_payment_detail` | Un documento por `folio`. El prefijo elige el modelo: `S` → venta o cotización, `PAY` → pago, el resto → factura o nota de crédito. `tipo` (`factura` \| `venta` \| `pago`) opcional para forzarlo. Envoltura común: `{ tipo, encabezado, lineas, vinculos, timbrado, truncado, nota }`. La factura agrega los REP que la cubren (+1 llamada) |
| 2 | `odoo_get_customer` | L | RO ✓ · OW ✓ | — | Fusión de `odoo_customer_profile` y el modo `cliente` de `odoo_overdue_invoices` | Expediente de un cliente (nombre, RFC o `#id`; exacto primero, `requireSingleMatch`): contacto, estado de cuenta bruto por vencimiento (`vence_desde`, `vence_hasta`, `incluir`; default = el de la pantalla Clientes), notas de crédito aparte, `cartera_contable` neta con su nota (deuda, vencido, DSO), ventas y facturación. Hasta 50 facturas con `truncado` |
| 3 | `odoo_list_receivables` | L | RO ✓ · OW ✓ | — | Fusión del modo global de `odoo_overdue_invoices` y `odoo_receivables_ranking` | Toda la cartera, **bruta por factura** (como Clientes): totales, `por_cliente` (vencido, por vencer, total y `dias_promedio_de_pago`), facturas más antiguas y notas de crédito aparte. `ordenar` (`vencido` \| `total` \| `dias_pago`), `limite`. 2 llamadas |
| 4 | `odoo_summarize_invoices` | L | RO ✓ · OW ✓ | — | `odoo_invoices_summary` renombrada | Facturado y pendiente de un periodo (`desde`, `hasta`, `agrupar_por`, `cliente` opcional), con notas de crédito del periodo aparte, separado por moneda |
| 5 | `odoo_summarize_sales` | L | RO ✓ · OW ✓ | — | `odoo_sales_summary` renombrada | Ventas de un periodo (`incluir`: `confirmadas` \| `todas`; `cliente` opcional), con el día en hora de Morelia |
| 6 | `odoo_audit_invoice_links` | L | RO ✓ · OW ✓ | — | `odoo_invoice_link_check` renombrada | Facturas del periodo huérfanas o con el vínculo roto; tope de 50 por lista con conteo |
| 7 | `odoo_audit_payment_complements` | L | RO ✓ · OW ✓ | — | `odoo_rep_audit` renombrada | Pagos del periodo sin REP, o con un REP fallido o no válido ante el SAT |
| 8 | `odoo_search_stock` | L | RO ✓ · OW ✓ | — | `odoo_stock_check` renombrada | Existencias del almacén de Odoo por producto (no es la tienda) |
| 9 | `odoo_search_records` | L | RO ✓ · OW ✓ | — | `odoo_query` renombrada | Primitiva para la cola larga: directorio de empleados, flotilla, productos, filtros que las curadas no tienen |
| 10 | `odoo_aggregate_records` | L | RO ✓ · OW ✓ | — | `odoo_aggregate` renombrada | Primitiva de totales agrupados |
| 11 | `odoo_preview_quotation` | L (vista MCP Apps) | RO ✓ · OW ✓ | firma la clave del patrón alto | se mantiene, más #154 | Vista previa de crear, editar o revisar, con `clave` (30 min). En los productos nuevos: `sugerencias_sat` y `categoria_sat` |
| 12 | `odoo_save_quotation` | E | RO ✗ · D ✓ · I ✓ · OW ✓ | **alto** (clave HMAC de la vista previa) | se mantiene sin `confirmar` | Crea en borrador o edita lo que mostró la vista previa |
| 13 | `odoo_confirm_quotation` | E | RO ✗ · D ✓ · I ✓ · OW ✓ | **alto** (clave `confirmar` de la vista previa en modo revisar) | **nueva**: sale de `odoo_save_quotation` | Confirma la cotización como venta (`folio`, `clave`). Esquema mínimo: no carga el de líneas |
| 14 | `odoo_create_draft_invoice` | E | RO ✗ · D ✗ · I ✓ · OW ✓ | **medio** (sin `confirmar`: resumen; con `confirmar: true`: escribe) | se mantiene y se ajusta | Factura completa en borrador de una venta confirmada |
| 15 | `odoo_save_product` | E (solo `visibility: ['app']`) | RO ✗ · D ✗ · I ✓ · OW ✓ | **botón** de la vista + autorización en `_meta` | se mantiene, más #154 | Alta de bienes nuevos con la clave SAT elegida |

**Total: 15 tools** (11 de lectura y 4 de escritura); el modelo ve 14.

**Tamaño estimado de `tools/list`:** unos **16,300 caracteres**, medidos como en `manifest.test.ts`. Hoy son 18,019.
- **Lo que ve el modelo:** unos 15,200, sin `odoo_save_product`.
- **Con las cuatro anotaciones explícitas:** unos 17,600, porque suman alrededor de 85 caracteres por tool.
- **Descripciones:** unos 5,800 (hoy 6,932).
- **Si se agrega `outputSchema` a todas:** sumaría entre 300 y 800 caracteres por tool. Se propone `structuredContent` siempre y `outputSchema` solo en la tool con vista (sección 5).

**Cómo entra #154 sin tool nueva:**
- **Sugerir.** En `odoo_preview_quotation`, para cada producto nuevo sin `clave_sat`, **una sola** llamada a `product.unspsc.code` (`code`, `name`) con un dominio OR de `ilike` sobre las palabras de su descripción, ordenada en memoria. Devuelve `sugerencias_sat: [{ clave, nombre }]`, máx 3. Cuesta unos 1.1 s y solo cuando hay productos nuevos sin clave.
- **Pedir por nombre.** La línea acepta `categoria_sat` (texto): «dale de alta con la categoría de pinturas en aerosol» → el servidor la resuelve.
  - Con una coincidencia, la propone como clave y avisa «confírmala».
  - Con varias, las deja en `sugerencias_sat`.
  - Con ninguna, avisa.
  - `clave_sat` (8 dígitos) sigue igual, y **`01010101` sigue prohibida**.
- **Elegir en la vista.** La vista muestra un selector con las sugeridas, y la autorización del botón **firma por producto el conjunto de claves permitidas**: la que traía, las sugeridas o vacía. Así el admin elige sin pedir otra vista previa, y `odoo_save_product` rechaza una clave que no esté firmada. Así se cumple «nunca inventarla».
- **Productos que ya existen sin clave:** haría falta una séptima operación (`product.product.write` solo con `unspsc_code_id`), que no cabe en ADR-040 tal como está.
  - Si se aprueba, va dentro de `odoo_save_product` (`save_` = crea o edita), con el mismo botón y la misma autorización, **sin tool nueva**.
  - Queda como pregunta abierta.
- **Opcional:** agregar `product.unspsc.code` (`code`, `name`) al catálogo de lectura, para responder «¿qué clave SAT llevan las brochas?» con `odoo_search_records`. ADR-040 lo descartó para no ampliar `odoo_query` a los members, pero hoy solo se conecta el admin. Es consulta, no asignación, así que no solapa con la vista previa.

## 4. Instrucciones del servidor Odoo

**Qué deben decir.** Propuesta de texto (2,785 caracteres para el admin; el member no recibe la sección de cotizar y facturar, unos 600):

```
# Odoo DYMMSA — facturación oficial
Odoo Online de DYMMSA (distribuidor URREA en Morelia): facturas, pagos, timbrado CFDI y complementos de pago (REP), clientes y cartera, ventas, productos y existencias del ALMACÉN de Odoo. Es externo a la app DYMMSA-WEB (cotizaciones de URREA, órdenes, inventario de la tienda, gastos), que es otro conector.

## Dos mundos
- No hay vínculo entre registros de DYMMSA-WEB y de Odoo: una cotización, cliente o producto de la app no es uno de Odoo aunque coincidan nombre, monto o código. No los cruces ni sumes.
- Si el usuario pide llevar algo de la app a Odoo, arma las líneas con lo que muestre el otro conector y pásalas por la vista previa: el puente es el usuario, nunca una suposición.
- Tienda = search_inventory (DYMMSA-WEB); almacén = odoo_search_stock. Cierre del mes (cobrado − pagado) = get_month_closing (DYMMSA-WEB).

## Qué usar
- Un folio (F…, S…, PAY…): odoo_get_document. Un cliente: odoo_get_customer. Toda la cartera o «¿a quién cobro primero?»: odoo_list_receivables.
- Totales de un periodo: odoo_summarize_invoices / odoo_summarize_sales. Revisiones: odoo_audit_invoice_links, odoo_audit_payment_complements.
- Primitivas (odoo_search_records, odoo_aggregate_records): solo si nada de lo anterior responde (empleados, flotilla, productos, filtros raros). En cartera, facturación y ventas usa las curadas: aplican las reglas de abajo.
- Odoo acepta una petición a la vez: no lances varias tools en paralelo.

## Reglas de las cifras
- Nota de crédito sin aplicar = saldo a favor del cliente, no deuda: va aparte (notas_credito*) y nunca se resta del vencido ni del por cobrar. No hagas ese neteo.
- Cartera = facturas abiertas, brutas por factura (como la pantalla Clientes). cartera_contable es el saldo neto de Odoo: no lo cuadres contra la bruta.
- Factura↔venta: vale ordenes_ligadas; el origen es texto libre y no prueba el vínculo. El PO del cliente vive en las notas al pie.
- Cada monto en su moneda (MXN por default; hay USD): nunca conviertas; si viene monedas_sin_convertir, dilo. «Hoy» = Ciudad de México.

## Cotizar y facturar (administradores)
odoo_preview_quotation (solo lee) → muestra el resumen y espera el sí → odoo_save_quotation. Para confirmar: vista previa con solo el folio, muestra al_confirmar, sí → odoo_confirm_quotation. Facturar: odoo_create_draft_invoice sin confirmar (resumen) → sí → con confirmar: true. «Haz esta cotización en Odoo» es este flujo, nunca el navegador. Productos nuevos solo con el botón de la vista (no llames odoo_save_product); la clave SAT se elige de las sugeridas o queda vacía, nunca se inventa. Nunca se publica, timbra, envía, crea clientes ni toca pagos.

Antes de escribir di qué harás (folio, cliente, monto) y espera el sí; con varias coincidencias pregunta cuál.
```

**Qué cambia respecto de hoy:**
- **La regla de oro, reformulada.** Hoy dice «los dos bloques son mundos separados». Pasa a «dos conectores, sin vínculo», y agrega lo que hoy falta: cómo actuar cuando el usuario **pide** llevar algo de un lado al otro (pregunta abierta 8).
- **Las notas de crédito** se quedan casi literales, y se les suma la diferencia entre bruto y neto (hallazgo 2).
- **El flujo cotizar → facturar** suma `odoo_confirm_quotation` y el paso de resumen de la factura.
- **Las primitivas** pasan de «cola larga» a «cuándo sí y qué pierdes», y absorben el directorio y la flotilla.
- **Una línea nueva sobre la cola de Odoo:** que el modelo no dispare tools en paralelo. La cola es por instancia, y el límite de Odoo Online es de una petición a la vez.

**Qué ya no va en el conector Odoo:**
- El mapa del bloque A y las reglas de negocio de la app (separadores, `is_sold`, stock, planificador, corte, nómina…).
- «Prefijo `odoo_*`, títulos (Odoo)»: es metainformación que el modelo ya ve en la lista.
- «Las únicas escrituras del MCP son las que cada bloque marca»: ya no hay bloques.

**Qué sale de las instrucciones de DYMMSA-WEB:**
- El bloque B (unos 1,370 caracteres), el párrafo de notas de crédito (324) y las dos viñetas de Odoo de `BUSINESS_RULES_MD` (565).
- Queda una sola línea: «Odoo es otro conector; `get_month_closing` ya trae los ingresos de Odoo, con las notas de crédito aparte».
- Eso libera unos 2,100 caracteres del tope de 8,000.

## 5. Convenciones propuestas para el conector

1. **Nombres:**
   - **Forma:** `odoo_<verbo>_<objeto>` en snake_case, estables desde la separación (se renombra una sola vez).
   - **Verbos con significado fijo:**
     - `get_`: uno, por folio, nombre o id;
     - `list_` / `search_`: colección (`search_` cuando el texto de búsqueda es obligatorio);
     - `summarize_`: totales de un periodo con las reglas del negocio;
     - `aggregate_`: agregados genéricos sin reglas;
     - `audit_`: barrido de un periodo que devuelve solo lo que está mal;
     - `preview_`: lectura que firma la clave del paso siguiente;
     - `save_`: crea o edita;
     - `confirm_`: ciclo de vida;
     - `create_draft_`: excepción con nombre de ADR-040.
   - **Títulos:** todos terminan en «(Odoo)».
2. **Parámetros:**
   - **En español:** `folio`, `cliente`, `desde`, `hasta`, `agrupar_por`, `incluir`, `ordenar`, `limite`. Alinear `limite`/`limit` con lo que decida la auditoría de DYMMSA-WEB.
   - **Excepción declarada:** las dos primitivas conservan el vocabulario de Odoo (`model`, `domain`, `fields`, `order`, `group_by`, `metrics`) porque pasan directo a su API.
   - **Restricciones reales:** fechas con regex `YYYY-MM-DD` en el esquema y existencia revisada (`isRealDate`); `enum` en todo lo que es una lista cerrada.
   - **Esquemas estrictos en lectura y escritura:** una llave desconocida es error, no se descarta.
3. **Clientes y documentos:**
   - Un solo resolvedor de cliente para leer y escribir: nombre, RFC o `#id`; exacto primero, luego `ilike` escapado y `requireSingleMatch`; los archivados se reportan. Es `resolvePartnerForWrite` generalizado.
   - Folios: exacto primero; un parcial se sugiere, nunca se usa.
4. **Respuestas:**
   - Llaves en español y valores de selección traducidos con un solo `labels.ts`: `payment_state`, `state` de factura, venta y pago, `invoice_status`.
   - Fechas y horas en `America/Mexico_City`.
   - Envoltura común: `truncado: boolean`, `nota?`, `monedas_sin_convertir?` (siempre que se sume) y `siguiente_paso?` (solo en escrituras, sin empujar pasos que nadie pidió).
   - Sin `llamadas`, y sin ids técnicos salvo los que una escritura necesita (`producto_id`, `linea_id`).
   - `structuredContent` siempre (el mismo JSON que el texto) y `outputSchema` solo en `odoo_preview_quotation`, la que consume la vista.
5. **Errores:**
   - «No encontrado» y «ambiguo» son `isError: true`, con los candidatos y un ejemplo válido («usa el folio completo, p. ej. F00167»).
   - Las lecturas de más de 3 llamadas corren bajo `withinBudget()` y, al vencer, responden un error accionable («acota el periodo o filtra por cliente»).
6. **Anotaciones:**
   - Las cuatro explícitas en cada tool, y `openWorldHint: true` en todo el conector (sistema de terceros).
   - En una escritura, `idempotentHint: true` siempre que «repetir la misma llamada» sea la instrucción de recuperación.
7. **Confirmación:**
   - **Alto:** la vista previa con clave HMAC, para crear, editar y confirmar.
   - **Medio:** `confirmar: true`, para la factura en borrador.
   - **Botón de la vista:** para el alta de productos.
   - claude.ai no tiene elicitation: se recomienda dejar las tres escrituras visibles en «Needs approval» en el conector.
8. **Cifras:** nunca convertir moneda; las notas de crédito siempre aparte; bruto por factura en cartera y la cifra neta solo como `cartera_contable` con su nota.
9. **Presupuesto propio (`TOOL_BUDGET` del conector Odoo):**
   - 16 tools (15 más una de holgura);
   - 1,000 caracteres por descripción y 8,000 en total;
   - `tools/list` ≤ 20,000;
   - instrucciones ≤ 3,500 por rol.
10. **Cola:** cada tool documenta en su código cuántas llamadas hace a Odoo. Más de 8 solo en un barrido documentado, y con plazo.

## 6. Tareas de evaluación (R12)

| # | Tarea (frase real) | Secuencia esperada | Qué prueba |
|---|---|---|---|
| 1 | «¿Quién nos debe más y desde cuándo? Dame el estado de cuenta del primero.» | `odoo_list_receivables` → `odoo_get_customer(cliente = el primero)` | Que la lista y el expediente den la misma cifra bruta |
| 2 | «¿A quién le cobro primero esta semana y quién paga más lento?» | `odoo_list_receivables(ordenar: vencido)` → `odoo_list_receivables(ordenar: dias_pago)`, o una sola con `limite` alto | El ranking fusionado; que no aparezca la cifra neta como si fuera otra deuda |
| 3 | «Estado de cuenta de Andritz: lo vencido y lo que vence este mes.» | `odoo_get_customer(cliente: 'Andritz')` | El default igual al de la pantalla Clientes; notas de crédito aparte |
| 4 | «Haz esta cotización en Odoo para GE Power: 6 aerosoles 31211507 a $56.03 y 2 brochas de 4" (no existen en Odoo).» | `odoo_preview_quotation` → la vista sugiere la clave SAT de las brochas, el admin elige y da clic → `odoo_save_product` (botón) → `odoo_preview_quotation` (mismos datos) → «sí» → `odoo_save_quotation` | El flujo alto, #154 y que el modelo no llame `odoo_save_product` |
| 5 | «Dale de alta con la categoría de pinturas en aerosol.» (seguimiento de la anterior) | `odoo_preview_quotation(… categoria_sat: 'pinturas en aerosol')` → vista → botón | Criterio 1 de #154 sin tool nueva |
| 6 | «Cámbiale el precio a la línea 3 de la S00915 a $120 y quita la nota del final.» | `odoo_preview_quotation(folio)` (revisar → `lineas_como_entrada`) → `odoo_preview_quotation(folio, lineas)` → «sí» → `odoo_save_quotation` | La edición por `linea_id` y que la clave ate el `write_date` |
| 7 | «Confirma la S00912 como venta.» | `odoo_preview_quotation(folio)` (muestra `al_confirmar`) → «sí» → `odoo_confirm_quotation(folio, clave)` | Que la tool partida reciba solo folio y clave; anotaciones D ✓ e I ✓ |
| 8 | «Haz la factura de la S00912.» | `odoo_create_draft_invoice(folio)` (resumen: cliente, total, `sin_clave_sat`) → «sí» → `odoo_create_draft_invoice(folio, confirmar: true)` | El patrón medio; repetirla devuelve `ya_existia` |
| 9 | «¿Ya se entregó y facturó todo lo de la S00247? Si falta facturar, factúrala.» | `odoo_get_document('S00247')` → si hay `por_facturar` > 0, la secuencia de la tarea 8 | El documento unificado de venta; que no facture si no se pidió |
| 10 | «¿Qué pagos de septiembre se quedaron sin REP? Abre el primero.» | `odoo_audit_payment_complements(desde, hasta)` → `odoo_get_document('PAY…')` | El barrido y el detalle de pago unificado |
| 11 | «¿Qué facturas del mes no están ligadas a su venta? Abre la de FieldCore.» | `odoo_audit_invoice_links(desde, hasta)` → `odoo_get_document('F…')` | Vínculo real frente al origen; el tope por lista |
| 12 | «Facturas de GE de agosto con su estado de pago, y el total por estado.» | `odoo_summarize_invoices(cliente: 'GE', desde, hasta, agrupar_por: estado_pago)` → `odoo_search_records(account.move, …)` para la lista | Que el total salga de la curada (con su filtro nuevo) y la lista de la primitiva; que `cliente` desconocido no se descarte |
| 13 | «¿Cuántas puntas de cobre hay en el almacén de Odoo y cuántas en la tienda?» (los dos conectores prendidos) | `odoo_search_stock('punta de cobre')` y `search_inventory` (DYMMSA-WEB) | Dos inventarios sin sumarlos ni cruzarlos |
| 14 | «¿Cómo cierra el mes?» (los dos conectores prendidos) | `get_month_closing` (DYMMSA-WEB); ninguna tool de Odoo | Caso negativo: el cierre no se arma con primitivas de Odoo |
| 15 | «¿Cuál es el correo de trabajo de Diego y qué camioneta tiene asignada?» | `odoo_search_records(hr.employee)` → `odoo_search_records(fleet.vehicle, domain driver_id ilike)` | Que retirar el directorio y la flotilla no deje la pregunta sin respuesta |

## 7. Preguntas abiertas

1. ¿Se renombra todo en la separación (el único momento barato) o se conservan los 19 nombres actuales?
2. ¿Se retiran `odoo_employee_directory` y `odoo_fleet_status`? ¿Alguna rutina programada los usa?
3. Cartera: ¿la lista usa la cifra bruta por factura, como Clientes, y la neta de Odoo solo como `cartera_contable` en el expediente?
4. ¿`openWorldHint: true` en todo el conector? Falta verificar en claude.ai que no cambie el permiso por default de las lecturas.
5. ¿`odoo_create_draft_invoice` pasa al patrón medio (`confirmar: true`)?
6. #154: ¿la autorización del botón firma las claves sugeridas para elegir en la vista sin otra vista previa? ¿Se aprueba la séptima operación (`product.product.write`, solo `unspsc_code_id`) para los productos que ya existen sin clave?
7. ¿`product.unspsc.code` entra al catálogo de lectura, ahora que solo se conecta el admin?
8. Puente app → Odoo: ¿el asistente puede armar la vista previa de Odoo con las líneas de una cotización de DYMMSA-WEB cuando el usuario lo pide? Es la decisión 9 de ADR-040.
9. ¿`action_confirm` notifica a los seguidores del chatter (el cliente, si ya se le envió la cotización)? Hay que verificarlo antes de fijar las anotaciones y el texto de `al_confirmar`.
10. ¿`structuredContent` y `outputSchema` se deciden igual para los dos conectores?
11. ¿Hoy hay facturas o ventas en USD en Odoo? Eso decide si los resúmenes deben separar por moneda desde el primer PR.
12. ¿Las rutinas de claude.ai que citan `odoo_invoice_link_check` u `odoo_rep_audit` se reescriben con los nombres nuevos en el mismo cambio?
