# ADR-025 — Bloque Odoo en el MCP (lectura de facturación)

**Fecha:** 2026-08-11
**Estado:** Aceptado (Fases 1–5 implementadas)
**Issue:** #65 · **Relacionado:** [[ADR-023-MCP-OAuth]] (el MCP anfitrión), [[ADR-014-Tareas-GitHub]] (precedente de tercero aislado)

## Contexto

DYMMSA lleva su facturación oficial en **Odoo Online** (plan Custom, hoy 19.0 Enterprise). El objetivo es darle a Claude acceso de LECTURA a esos datos vía el MCP existente para revisiones automáticas (cartera vencida, cuadres por periodo, montos atípicos) — **sin** relacionar Odoo con DYMMSA-WEB ni escribir jamás en Odoo.

Verificado antes de construir (comentarios de la issue #65): plan Custom con API incluida y gratuita (sin costo por llamada); rate limit de Odoo Online ~1 req/s **sin llamadas paralelas** (429 al excederse); y `/jsonrpc`/`/xmlrpc` **deprecados** — mueren en Odoo Online 21.1 (invierno 2027), así que el cliente usa la **External JSON-2 API** (`POST /json/2/<model>/<method>`, `Authorization: bearer <api-key>`) desde el día uno.

## Decisión

1. **Tercero aislado** en `src/lib/odoo/` (patrón `github.ts`): `client.ts` (transporte + `OdooError`), `env.ts`, `catalog.ts`, `normalize.ts`. Las tools MCP viven en `src/lib/mcp/tools/odoo/` y llevan **prefijo `odoo_`** + descripciones que dicen explícitamente que consultan el sistema EXTERNO de facturación.
2. **Cola serializada obligatoria**: el singleton `callOdoo` garantiza UNA request en vuelo con espaciado mínimo (1.1 s) — si el LLM dispara varias tools a la vez, se forman. Backoff ante 429 (Retry-After o 2 s, UN reintento). Producción jamás crea callers propios: la cola solo protege si es compartida.
3. **El catálogo es la frontera de seguridad** (`catalog.ts`): las primitivas genéricas solo aceptan modelos allowlisted y campos whitelisted — también en filtros, agrupaciones y **cada columna del `order`**. El **traversal por relación en dominios está vedado** (`partner_id.vat` filtraría por un campo oculto: oracle de inferencia, verificado en vivo — review PR #66); el caso legítimo lo cubre el ilike sobre el display del many2one. **Nómina/salarios nunca entran al catálogo** aunque la API key (de admin) pueda leerlos.
4. **Estrategia híbrida**: 2 primitivas (`odoo_query`, `odoo_aggregate`) para la cola larga de preguntas + tools curadas por módulo para las frecuentes. Agregar un módulo de Odoo = entradas al catálogo + (opcional) tools curadas.
5. **El server digiere, el modelo interpreta**: respuestas JSON compactas — agregados calculados POR Odoo (`read_group`), many2one → nombre, `false` → null, `__domain` fuera. Nunca registros crudos masivos al contexto.
6. **Identidad**: las tools Odoo corren con la API key del server (env), no con el token OAuth del usuario — cualquier usuario del conector ve lo mismo. Correcto para una empresa de un solo equipo (misma lógica del ADR-023); documentado como límite consciente.
7. **Env opcional**: sin `ODOO_URL`/`ODOO_API_KEY` el resto del MCP opera y las tools `odoo_*` responden error accionable; el health reporta `skip`. Con env, el check `odoo` (search_count barato) → `degraded` si la key murió.

## Fases (dictamen en la issue #65)

| Fase | Módulos | Estado |
|---|---|---|
| 1 | Contabilidad (`account.move`, `account.payment`) + toda la infraestructura | ✅ 2026-08-11 |
| 2 | Contactos + Ventas (`res.partner`, `sale.order`) | ✅ 2026-08-11 |
| 3 | Inventario (`product.product`, `stock.quant`) — desambiguado de `search_inventory` (tienda) | ✅ 2026-08-11 |
| 4 | Empleados (`hr.employee`, whitelist mínima SIN nómina) + Flotilla (`fleet.vehicle` + bitácora) | ✅ 2026-08-11 |
| 5 | Líneas de documento (`account.move.line`, `sale.order.line`) + timbrado CFDI | ✅ 2026-08-13 |
| 6 | Complementos de pago REP (`l10n_mx_edi.document`) + desglose pago→facturas | ✅ 2026-08-20 |

## Tools Fase 1

- `odoo_query` — search_read genérico sobre el catálogo (máx 50, normalizado, avisa truncado)
- `odoo_aggregate` — read_group genérico (métricas `campo:sum|avg|min|max|count`; el `:count` está verificado contra la instancia real)
- `odoo_overdue_invoices` — cartera vencida: total, por cliente (desc), más vencidas con días de atraso (2 llamadas exactas)
- `odoo_invoices_summary` — facturación por periodo agrupada por estado_pago | cliente | mes

## Tools Fase 2

- `odoo_sales_summary` — ventas por periodo agrupadas por estado | cliente | vendedor | mes; default solo confirmadas (las draft/sent de Odoo son cotizaciones)
- `odoo_customer_profile` — expediente de un cliente en 4 llamadas: contacto (con RFC), ventas por estado (total solo confirmadas), facturación con pendiente y sus vencidas con días de atraso; con ≥2 coincidencias devuelve la lista para precisar

## Tools Fases 3 y 4

- `odoo_stock_check` — existencias del ALMACÉN DE ODOO por nombre/código (1 llamada: read_group de stock.quant suma ubicaciones); lista solo lo con existencia (máx 20) + conteo `en_cero`. Descripción con ⚠️ explícito: NO es `search_inventory` (tienda DYMMSA-WEB).
- `odoo_employee_directory` — directorio LABORAL (nombre, puesto, depto, contacto). Nómina/personales fuera por whitelist; test lo fija (`wage`/`contract_id`/`birthday` rechazados).
- `odoo_fleet_status` — vehículos (placas, conductor, odómetro, estado) + últimos servicios; bitácora vacía se reporta explícita.

## Tools Fase 5

- `odoo_invoice_detail` — factura por folio: encabezado, **timbrado CFDI digerido** (UUID, "timbrada", "vigente ante el SAT") y líneas de producto. Nació de la exploración de límites: el usuario preguntó "¿está timbrada?" y la instancia SÍ usa la localización MX (campos `l10n_mx_edi_*`, ahora en la whitelist de `account.move`).
- `odoo_sale_detail` — venta por folio: encabezado con vendedor y sus líneas con **pedido/entregado/facturado** ("¿ya se entregó todo?").
- Ambas resuelven folio → id y filtran líneas por FK numérica (el traversal sigue vedado); folio parcial con ≥2 matches devuelve la lista para precisar; líneas cap 80 con nota.

Hallazgo F3: `product.product.qty_available` es computado NO almacenado — Odoo revienta al filtrar/ordenar por él → queda fuera del catálogo; la verdad del stock es `stock.quant` (cuyo display de product_id ya trae el código embebido).

Hallazgos de la exploración F2 (2026-08-11): `res.partner` en Odoo 19 ya NO tiene `mobile` (consolidado en `phone`); `sale.order.date_order` es DATETIME → los rangos se expanden a extremos del día; al agrupar por un campo selection Odoo devuelve TODAS las opciones aunque el dominio las excluya → `normalizeGroups` descarta grupos con count 0.

## Tools Fase 6 (issue #70)

- `odoo_payment_detail` — pago por folio: encabezado, estado del **complemento de pago (REP)** digerido y el desglose de facturas que paga (cada una con saldo y su propio CFDI). 3 llamadas: pago → documentos REP → facturas.
- `odoo_rep_audit` — barrido por rango (default 30 días): pagos de cliente clasificados en **en regla / no requiere REP (PUE) / sin REP / REP con problema** (más `sin_facturas_conciliadas`). 2 llamadas — más una 3ª SOLO si quedaron pagos sin REP: la política `l10n_mx_edi_payment_policy` (PUE/PPD) de sus facturas, porque un pago 100% PUE no exige complemento y sería falso positivo (review PR #75; hoy la instancia es 100% PPD pero PUE existe en el selection). Los docs se buscan por la unión de facturas SIN filtro de fecha (el REP puede timbrarse días después del pago).

Hallazgos F6 (2026-08-20, exploración en vivo con PAY00068):

- **Los `l10n_mx_edi_*` de `account.payment` MIENTEN**: son computados no-almacenados y devuelven `false` incluso en pagos con REP timbrado y validado. NO entran al catálogo — allowlistarlos daría respuestas falsas.
- **La verdad del REP es `l10n_mx_edi.document`**: `state` (`payment_sent`/`payment_sent_pue`/`payment_sent_failed`/`payment_cancel*`), `sat_state`, `attachment_uuid` (folio fiscal), `invoice_ids` y `datetime` — todo ALMACENADO (filtrable/agregable sin trampas). También contiene los docs de facturas (`invoice_sent*`), por eso el label del catálogo dice "facturas y complementos".
- **El puente pago↔REP no es FK directa** (el pago tiene `move_id=false` en esta instancia): es por facturas conciliadas — `l10n_mx_edi.document` con `invoice_ids in [facturas del pago]` + `state like 'payment%'`. Heurística de cobertura: el doc cubre al pago si abarca TODAS sus facturas (con pagos parciales de una misma factura podría dar falso "en regla" — límite consciente, no afecta el patrón de cobro actual). Con varios docs (re-timbrado) manda el más reciente.
- **`reconciled_invoice_ids` es computado pero filtrarlo NO truena: devuelve 0 resultados EN SILENCIO** (peor que el ValueError de `qty_available`). Nació el concepto **`readOnlyFields`** en el catálogo: campos legibles bajo demanda pero vedados en dominios/order, y fuera de la proyección por defecto.

## Tools Fase 7 (issue #110) — vínculo real factura↔orden de venta

- `odoo_invoice_link_check` — la revisión periódica en UNA llamada lógica: facturas de cliente contabilizadas del periodo (default 30 días, opcional cliente), leídas **por páginas de 200** por encima del tope de 50 de las primitivas (tope duro 2000 → nota), clasificadas por el vínculo REAL: `ligada` (`sale_order_count > 0`), `vinculo_roto` (0 ligadas pero `invoice_origin` menciona una orden) y `huerfana` (ni ligada ni origen). Devuelve solo las problemáticas (con `incluir_ligadas` también las buenas), cada una con notas al pie ya en texto (`pedido_pie`) y término de pago. Lista para una rutina programada (issue aparte).
- `odoo_invoice_detail` gana `vinculo_venta` (órdenes ligadas + diagnóstico), `termino_pago`, `notas_pie` y por línea `unidad` + `ligada_a_venta` (por `sale_line_ids`). `odoo_sale_detail` gana `facturas` (folio/estado/pago — resueltas con una llamada extra solo si `invoice_ids` trae algo) y por línea `unidad`, `por_facturar` (`qty_to_invoice`) y `lineas_de_factura`.

Hallazgos F7 (2026-09-24, `fields_get` + muestras en vivo, Odoo 19):

- **`account.move.sale_order_count`: computado NO almacenado** — un dominio sobre él truena con `ValueError: Cannot convert ... not stored` (ruidoso, a diferencia de `reconciled_invoice_ids`). `readOnlyFields`. **`sale.order.invoice_ids`** igual: `readOnlyFields`.
- **Sí almacenados** (mejor de lo que la issue temía): `account.move.line.sale_line_ids` e `sale.order.line.invoice_lines` (many2many, filtrables), **`qty_to_invoice`** (float), `narration` (html), `invoice_payment_term_id`, `product_uom_id` en ambas líneas.
- `narration` llega como HTML con envoltorio de Odoo (`<p data-oe-version="2.0">PEDIDO: 4102931264</p>`) → `htmlToText()` en `normalize.ts` (bloques → saltos de línea, entidades decodificadas).
- `invoice_origin` es texto libre: NO prueba el vínculo. En el smoke jul–sep (210 facturas): 194 ligadas, huérfanas de Andritz con el PO solo en el pie, y **vínculos rotos reales** (FieldCore: origen `S00482`/`S00509`/`S00576` con 0 órdenes ligadas) — invisibles para la inferencia por texto.
- Una factura en borrador no tiene folio (`name = false`) → `odoo_sale_detail` la etiqueta "(borrador, sin folio)".
- Opción (b) de la issue (`store=True` en Odoo) descartada: exige módulo Python custom y Odoo **Online** no lo admite (eso es Odoo.sh).

### Exploración para rutinas futuras (2026-09-24, misma sesión; fuera del PR de #110 por decisión)

Verificado con `fields_get` + muestras; cada rutina tiene su issue (#112–#115) para no re-explorar:

| Capacidad | Modelo · campos | Almacenado | Dato de la instancia |
|---|---|---|---|
| Entregas pendientes/atrasadas | `stock.picking`: `name`, `partner_id`, `origin`, `state`, `scheduled_date`, `date_deadline`, `date_done`, `sale_id`, `picking_type_id` (id 2 = "Oficina: Delivery Orders") | sí (`picking_type_code` NO → readOnly) | 19 entregas `assigned` sin hacer, 503 `done`, 11 canceladas |
| Ventas sin entregar | `sale.order.delivery_status` (`full`/`pending`), `commitment_date`, `picking_ids` | sí | `commitment_date` sin uso en la muestra |
| Cotizaciones por expirar | `sale.order.validity_date` | sí | con datos (S00799 → 2026-10-24) |
| Cobros sin conciliar | `account.payment.is_reconciled`, `is_matched`, `journal_id`, `payment_method_line_id` | sí | — |
| Deuda/vencido por cliente | `res.partner.total_due`, `total_overdue`, `credit`, `days_sales_outstanding`, `use_partner_credit_limit` | **NO** → readOnly | FieldCore $997K deuda / $56.7K vencido; GE $1.45M / $334.6K |
| Vendedor / equipo | `account.move.invoice_user_id`, `team_id`; `sale.order.team_id`, `payment_term_id` | sí | un solo equipo "Sales" |
| PO del cliente en su campo | `sale.order.client_order_ref` | sí | **0 de 532 ventas confirmadas lo usan** — el PO vive en `narration` de la factura |
| Límite de crédito | `res.partner.credit_limit` | sí | 0 en todos, `use_partner_credit_limit` apagado |
| Márgenes | `sale.order.margin`, `sale.order.line.purchase_price` | **no existen** | módulo *Sale Margin* no instalado |
| Actividades (seguimientos) | `mail.activity`: `res_model`, `res_name`, `summary`, `date_deadline`, `user_id` | sí | sin rutina pedida |

## Tools Fase 8 (issue #113) — cartera y DSO por cliente

- `res.partner` gana `readOnlyFields: total_due, total_overdue, credit, days_sales_outstanding` — las cifras de cobranza que Odoo calcula por cliente (computadas sin store, verificadas 2026-09-25). `odoo_customer_profile` las lee en la misma llamada del contacto y las digiere en `cartera` (deuda total, vencido, por cobrar, días promedio de pago redondeados); el contacto no arrastra las llaves crudas.
- `odoo_receivables_ranking(limit?)` — lee TODOS los clientes (`customer_rank > 0`, páginas de 200, tope 1000 con nota) y ordena **en memoria**: `por_vencido` (vencido desc, luego deuda) y `mas_lentos` (DSO desc; sin DSO quedan fuera de esa lista). Odoo no puede ordenar por campos computados, por eso el orden del `search_read` es por relevancia (`customer_rank`) y el ranking se arma aquí. Totales de cartera al frente.
- Descartado de la issue original: "cobros sin conciliar con banco" — los 82 cobros pagados de la instancia tienen `is_matched = true`; la rutina devolvería siempre cero.

## Operación

- Env (server): `ODOO_URL`, `ODOO_API_KEY`, `ODOO_DB` (opcional). En Vercel para producción.
- **Rotación de la API key**: se genera con expiración (6–12 meses) desde Odoo → Usuario → Seguridad; renovarla es reemplazar la env. La key de exploración (1 mes) se revoca al desplegar.
- Tests sin red: caller inyectado por parámetro con las formas REALES capturadas de la instancia (2026-08-11); la cola/backoff se prueba con fetch/sleep inyectados.

## Verificación en vivo (2026-08-11)

Smoke test contra la instancia real vía las tools: cartera vencida $268,602.49 (13 facturas, la más vieja 102 días), julio $662,934.68 facturado / $625,930.59 pendiente, 59 pagos inbound por $4.7M. Consistente con la UI de Odoo.
