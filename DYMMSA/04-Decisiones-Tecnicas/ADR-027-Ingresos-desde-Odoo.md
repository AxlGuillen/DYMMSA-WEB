# ADR-027 — Ingresos desde Odoo (Finanzas fase 2)

**Fecha:** 2026-09-09
**Estado:** Aceptado
**Issue:** #94 · **Relacionado:** [[ADR-025-Bloque-Odoo-MCP]] (el cliente y el catálogo que se reúsan), [[ADR-009-Errores-Descriptivos]]

## Contexto

Finanzas fase 1 (#84) registra los **egresos** en la app porque Odoo no lleva nuestros gastos. Los **ingresos** ya viven en Odoo, que es quien factura a los clientes (452 facturas en Contabilidad → Facturas). El overview necesitaba la otra mitad para calcular lo que le da sentido al módulo: **cómo cierra el mes**, porque DYMMSA paga impuestos sobre la ganancia mensual.

Restricción de la issue: **leer, nunca duplicar**. Nada de una tabla `receivables` que espeje `account.move`.

## Decisión

### 1. Ingreso del mes = cobrado por fecha real de cobro

Se leen los **pagos de cliente** (`account.payment`, `payment_type = inbound`, **`partner_type = customer`**, `state in (in_process, paid)`) cuya `date` cae en el mes. El `partner_type` no es adorno: un reembolso recibido de un proveedor y una transferencia interna también son `inbound`, y contarlos inflaría justo el número del que dependen los impuestos (review PR #98). No las facturas por `invoice_date`: los egresos ya van por `paid_at` y las dos mitades deben hablar del mismo hecho — dinero que se movió ese mes — o el cierre sale mal. Una factura emitida el 25/08 y cobrada el 05/09 cuenta en septiembre. `in_process` es un pago registrado sin conciliar con el banco; `paid`, conciliado. Se cuentan ambos (mismo criterio que `odoo_rep_audit`); un pago que después se marque `rejected` sale del total al expirar el caché.

`account.payment.date` es un `DATE` (sin hora), así que el rango es `[mes-01, mesSiguiente-01)` con `nextMonth()` — la misma frontera exclusiva que los egresos.

### 2. Lo facturado y no cobrado va aparte

Facturas `out_invoice` publicadas con `payment_state in (not_paid, partial)` y `amount_residual > 0` (`OPEN_RECEIVABLES_DOMAIN`, compartido con las tools MCP): **Por cobrar** (vence hoy o después, o sin vencimiento) y **Vencido por cobrar** (vencimiento `< hoy`, cualquier mes). Es el espejo de "pendiente/vencido" del lado de egresos; mezclarlo con el ingreso del mes inflaría el cierre con dinero que no ha llegado. La lectura es independiente del mes y el corte por `today` se hace **fuera del caché**, en `src/lib/income.ts`.

### 3. Dos llamadas por vista, cacheadas en el Data Cache de Vercel

Odoo Online no admite llamadas paralelas (cola serializada de 1.1 s, ADR-025): consultar en cada carga sería lento y frágil. `src/lib/odoo/income-cache.ts` envuelve las dos lecturas con `unstable_cache` (tag `finance-income`, `revalidate: 900`). Se eligió el Data Cache y no un `Map` en módulo porque en Vercel el `Map` es por instancia: cada cold start volvería a pegarle a Odoo y el botón "Actualizar" solo purgaría la instancia que atendió el POST. Un error lanzado dentro del callback **no se cachea**, así que tras un fallo el siguiente GET reintenta.

Trampas de Next 16 que quedan documentadas: `unstable_cache` fuera de un request lanza `Invariant: incrementalCache missing` (los tests mockean `next/cache`); `revalidateTag(tag, profile)` **exige** el segundo argumento y `{ expire: 0 }` es la expiración inmediata — con `'max'` sería stale-while-revalidate y "Actualizar" parecería roto. Es API legacy: vive en un solo archivo para cambiarla (a `'use cache'` cuando se adopte `cacheComponents`, que NO se habilita hoy).

El refresh (`POST /api/finance/income/refresh`) purga el tag y responde con los loaders **crudos**, no con los cacheados: la respuesta no depende de la semántica del caché en el mismo request.

### 4. Degradar, nunca romper

`GET /api/finance/income` responde **200 con `income: null`** y un `unavailable.reason` (`not_configured` | `odoo_error`) cuando Odoo no está en el entorno o falla. El overview pinta los egresos igual y una tarjeta "Ingresos no disponibles" con el botón de reintento. Solo un error ajeno a Odoo produce 500.

### 5. Todo el equipo lo ve

`requireAuth()`, no `requireAdmin()`: decisión del usuario (2026-09-09). Los datos son agregados mensuales y la lista de cobros, sin líneas de factura ni RFC.

### 6. El cierre se calcula en el cliente

`monthClosing({ collected, paid, pending, carryOver })` → real = cobrado − pagado, proyectado = real − pendientes del mes **− vencidas de meses previos** (`carryOver` = `carryOverTotal` de `summarizeMonth`, que por definición no se traslapa con `pendingTotal`; la resta vive en la lib con su test, no en el componente). Decisión del usuario (2026-09-09, review PR #98): una factura de julio sin pagar en septiembre sí se tiene que pagar, así que un proyectado que la ignore sale optimista justo cuando hay atrasos. Corre en `FinanceOverview` con los dos hooks, para que la ruta de ingresos sea solo-Odoo (cacheable, sin Supabase) y las mutaciones de payables no disparen refetches a Odoo. El negativo es respuesta válida: es justo el mes que conviene no cerrar así.

**Límite al navegar hacia adelante:** con hoy en septiembre, el proyectado de diciembre no resta lo que vence en octubre y noviembre — no está vencido (no es arrastre) ni vence en diciembre (no es pendiente del mes). La etiqueta de la tarjeta es literal ("pendientes del mes y vencidas previas"), así que el número no miente, pero es optimista para meses futuros. Se acepta: el módulo existe para decidir el cierre del mes en curso; una proyección acumulada hacia adelante es material de la simulación pendiente.

### 7. Límites conscientes

- **Truncado**: 500 filas por lectura (años de volumen de DYMMSA); `collectionsTruncated` y `receivablesTruncated` se exponen por separado para que el aviso hable del renglón correcto. Si alguna vez importa, un `read_group` extra da la suma exacta.
- **Refresh caro a propósito**: purgar + leer crudo deja el Data Cache vacío, así que un ciclo de "Actualizar" cuesta 4 llamadas a Odoo (2 del POST + 2 del siguiente GET). Es el precio de que el botón nunca muestre dato viejo.
- **Moneda**: `amount` va en la moneda del pago y `amount_residual` en la de la factura; ninguno se convierte. el resumen trae `collectionCurrencies` (cobros del mes, badge en el encabezado) y `receivableCurrencies`/`overdueCurrencies` (facturas abiertas, cada tarjeta con la nota de su propio lado) **por separado**: una factura vieja en USD no debe pintar el aviso en todos los meses. Si algún día hace falta convertir, `amount_residual_signed` ya viene en moneda de la compañía.
- **Data Cache entre instancias**: tras un refresh, otra instancia podría servir una vez el dato viejo; el POST devuelve datos frescos y el hook los siembra.
- **Fuera de alcance**: simulación de mover pagos entre meses (lo único que queda de #84 fase 2), tools MCP nuevas, histórico anual.

## Consecuencias

- `src/lib/odoo/` deja de ser exclusivo del MCP: `domains.ts` e `income.ts` los usa la app. El catálogo sigue siendo la frontera para ambos.
- Primer uso del Data Cache de Next en el proyecto; el patrón (un archivo, tag, refresh con `{ expire: 0 }`) es el que se reutiliza si otro tercero necesita caché.
