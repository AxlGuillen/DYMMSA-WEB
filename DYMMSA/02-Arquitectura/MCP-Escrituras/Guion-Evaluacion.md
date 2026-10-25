# MCP — Guion de evaluación manual

> Issue #155 · 2026-10-24 · PR C (C4 + C5 + C6) y PR D (escrituras nuevas)
> Insumos: [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]] §5 (25 tareas), [[02-Arquitectura/MCP-Escrituras/Auditoria-Odoo]] §6 (15 tareas) y [[04-Decisiones-Tecnicas/ADR-041-Dos-Conectores-MCP-y-Composicion-de-Tools]].
> Las frases de cada tool también viven en su definición (`docs.evals`); `tests/mcp/definitions.test.ts` exige que ninguna quede sin ellas y `tests/mcp/evals.test.ts` que este guion nombre cada tool.

## Cómo se corre

1. **Cuándo:** después de cada release que cambie el conector (PR C y PR D). Lo corre un administrador en claude.ai (web o escritorio), con **los dos conectores prendidos**, salvo donde se indique.
2. **Un chat nuevo por tarea.** Se escribe la frase tal cual, sin pistas de qué tool usar. Se anota la secuencia que el modelo siguió, no solo si salió bien.
3. **Qué es un acierto:** la secuencia esperada (o una equivalente que llegue al mismo resultado con menos llamadas), sin tool equivocada, sin escribir antes del sí, y con el resumen mostrado al usuario en las escrituras de dos fases.
4. **Datos:** usar registros de prueba o de bajo riesgo. Las tareas que borran o cierran cosas se corren contra datos que se puedan perder.
5. **Resultado:** `✓` acierto · `~` llegó pero con pasos de más o una corrección · `✗` falló · `—` no se corrió. Se anota en la columna «Resultado» de cada fila y se resume en la tabla final.

## Antes de empezar (una sola vez por entorno)

| Paso | Qué se verifica | Resultado |
|---|---|---|
| Reconectar | Quitar y volver a agregar «DYMMSA-WEB» y «Odoo DYMMSA»; la lista de DYMMSA-WEB tiene los nombres nuevos (`save_payable`, `save_task`, `save_inventory_item`, `save_payroll_hours`, `list_profiles`, `delete_record`) y ya no los viejos | |
| Permisos | En la configuración del conector, `delete_record` queda en «Pedir aprobación» y los `save_*` pueden quedar en «Siempre permitir» | |
| Sin `MCP_PREVIEW_SECRET` | Con la variable aún sin poner en Vercel: pedir borrar una factura. Responde que la confirmación en dos pasos no está disponible y **no escribe**. Una escritura directa (`save_task` crear) sí funciona | |
| Con `MCP_PREVIEW_SECRET` | Con la variable puesta y el redeploy hecho: la misma petición devuelve el resumen y la clave; la clave sirve una vez, para esos mismos datos, dentro de 30 min | |

## A. DYMMSA-WEB: las 25 tareas

Con el PR D todas las tareas se corren con las tools que existen, salvo la 21 (`equipo` de `get_hours_trend`, que ni C ni D traen). La columna «Hasta» solo dice en qué PR llegó cada tramo: «C» = las tools del PR C, «D» = las escrituras nuevas de la Fase D (`save_quotation`, `save_order`, `save_order_reception`, `save_app_settings`, `save_purchase_decisions`, `save_cut_plan`, `save_product`, `save_urrea_catalog_item`, `save_profile`, `save_payroll_period`, `crear_marcas` de `save_supplier` y las cantidades de `save_inventory_item`). Las escrituras de dos fases necesitan `MCP_PREVIEW_SECRET` en Vercel (llega con el deploy del PR D).

| # | Frase del usuario | Secuencia esperada | Hasta | Resultado |
|---|---|---|---|---|
| 1 | «A la cotización de Andritz cámbiale el precio de la línea 4 a 385 y ponle entrega 1 semana a todo» | `get_quotation(cotizacion: "Andritz")` → `save_quotation(cotizacion, cambios: [{ linea: 4, precio: 385 }, { linea: "todas", entrega: "1_semana" }])` ×2 (una sola intención: cambios de línea) | D (la lectura, C) | |
| 2 | «Hazme una cotización para GE Power con estos 6 productos» (Excel adjunto) | `save_quotation(nombre, cliente: "GE Power", lineas: […])` fase 1 → `search_products(buscar)` si falta alguno → fase 1 → fase 2 | D | |
| 3 | «El cliente me dijo por WhatsApp que aprueba todo menos la línea 5; márcala aprobada» | `get_quotation` → `save_quotation(cotizacion, estado: "aprobada")` ×2 → `save_quotation(cotizacion, cambios: [{ linea: 5, aprobacion: "rechazada" }])` ×2 (una intención por llamada; en revisión no admite `aprobacion`, por eso el estado va primero) | D | |
| 4 | «¿Cómo vamos? ¿Qué cotizaciones esperan aprobación? Manda la de Truper a aprobación y pásame el link» | `get_business_summary` → `list_quotations(estado: "en_revision")` → `save_quotation(cotizacion: "Truper", estado: "en_revision")` → `get_quotation(link_aprobacion)` | C la lectura, D la escritura | |
| 5 | «Genera la orden de la cotización de Andritz» | `save_order(cotizacion: "Andritz")` ×2 | D | |
| 6 | «Ya llegaron 10 del 6954 de la orden de GE, pedimos 8; del 4410 no van a surtir nada» | `get_order(orden: "GE")` → `save_order_reception(orden: "GE", lineas: [{ codigo: "6954", recibido: 10 }, { codigo: "4410", recibido: 0, estado: "no_surtido" }])` ×2 (el resumen muestra el excedente que entra al inventario y el total de entrega) | D (la lectura, C) | |
| 7 | «Agrégale 3 rodillos ETM 12345 a $85 a la orden 12 y ponle entrega 1 semana a la línea 4» | `save_order(orden: "12", productos: [{ etm: "12345", cantidad: 3, precio: 85 }])` ×2 → `save_order(orden: "12", cambios: [{ linea: 4, entrega: "1_semana" }])` directo (una intención por llamada; el resumen del alta muestra el stock que toma) | D | |
| 8 | «¿Qué órdenes siguen abiertas? Cancela la de Truper, el cliente se echó para atrás» | `list_orders(estado: "pedida")` → `save_order(orden: "Truper", estado: "cancelada")` ×2 | D (la lectura, C) | |
| 9 | «Sube el umbral de dinero parado a $150 y en la orden de GE acepta las recomendaciones; las de revisar, a mayoreo» | `get_app_settings` → `save_app_settings(umbral_dinero_parado_mxn: 150)` ×2 → `get_purchase_plan(orden: "GE")` → `save_purchase_decisions(orden: "GE", aceptar_recomendaciones: true, decisiones: [{ codigo, eleccion: "mayoreo" }])` ×2 | D (las lecturas, C) | |
| 10 | «Agrega a la lista de corte de la orden 12 cuatro tubos de 1 pulgada de 300 mm; el proveedor vende barras de 6 m. ¿Cuántas salen?» | confirma 25.4 mm → `save_cut_plan(orden: "12", accion: "agregar", piezas: […])` → `save_material_presentation(tipo: "tubo", diametro_mm: 25.4, largo_mm: 6000)` → `get_cut_plan(orden: "12")` | D (`save_material_presentation` y `get_cut_plan`, C) | |
| 11 | «Conté el 6954: hay 12, y quedó en la gaveta B3» | `search_inventory(buscar: "6954")` → `save_inventory_item(productos: [{ codigo: "6954", cantidad_contada: 12, ubicacion: "B3" }], motivo: "conteo")` ×2 (el resumen desglosa lo apartado en órdenes abiertas: se guarda 12 menos eso) | D; solo la gaveta: `save_inventory_item(productos: [{ codigo: "6954", ubicacion: "B3" }])` directo (C) | |
| 12 | «El ETM 1180234 no lo vendemos, y en realidad es SURTEK» | `search_products(buscar: "1180234")` → `save_product(etm, se_vende: "no", marca: "SURTEK")` ×2 (cambiar la marca pide el sí) | D (la lectura, C) | |
| 13 | «El 6954 ahora viene en paquete de 12, no de 10» | `search_urrea_catalog(buscar: "6954")` → `save_urrea_catalog_item(codigo, marca, std: 12)` ×2 | D (la lectura, C) | |
| 14 | «Da de alta a Ferretería López, 30 días de crédito, surte PRETUL» (PRETUL no existe) | `list_suppliers(buscar: "López")` → `save_supplier(nombre, dias_credito: 30, agregar_marcas: ["PRETUL"], crear_marcas: true)` | D (`crear_marcas`). Control: sin `crear_marcas`, el mismo alta debe decir que la marca no está registrada, sin inventarla | |
| 15 | «Registra la de Tornillos MX por $800, ya la pagué hoy» | `save_payable(proveedor: "Tornillos", concepto, monto: 800, fecha_factura: hoy, estado: "pagada")` directo (se registra pendiente y se paga) | C | |
| 16 | «Ya pagué la de Perfiles, fue ayer; dame el detalle» | `save_payable(factura: "Perfiles", estado: "pagada", fecha_pago: <ayer>)` → si hay dos, error con `ref` → pregunta → repite con `ref` → `get_payable(factura: "<ref>")` | C | |
| 17 | «Borra la factura de Tornillos que registré dos veces» | `list_payables(proveedor: "Tornillos")` → `delete_record(tipo: "factura", referencia: "<ref>")` ×2 | C | |
| 18 | «¿Qué debo esta semana y cómo cierra el mes con lo último de Odoo?» | `get_payables_overview()` → `get_month_closing()` | C (`fresco` llega después) | |
| 19 | «Aquí está el reporte del checador de la semana, cárgalo» | `preview_time_report(filas)` (vista y clave) → `save_time_entries(filas, clave)` → (opcional) `list_time_imports` | C. **Sin `MCP_PREVIEW_SECRET` el guardado no está disponible a propósito** | |
| 20 | «Borra la checada duplicada de Luis del martes a las 8:02; y el lunes fue feriado para todos» | `get_week_hours(persona: "Luis", fecha)` → `delete_record(tipo: "checada", persona: "Luis", fecha, entrada: "08:02")` ×2 → `save_excused_day(fecha, tipo: "feriado")` | C | |
| 21 | «¿Quién no está completando su jornada este mes?» | `get_hours_trend(equipo: true, semanas: 4)` | D (`equipo` aún no existe: hoy es una llamada por persona) | |
| 22 | «Haz la nómina de esta semana: trae las horas, carga la hoja del taller (Juan es nuevo, medio tiempo), confirma y cierra» | `save_payroll_hours(traer_de_horas: true)` → `save_payroll_employee(nombre: "Juan", jornada: "media")` → tabla de la hoja → `save_payroll_hours(dias: […])` → `get_payroll_period()` → `save_payroll_period(accion: "confirmar_borradores")` ×2 → `save_payroll_period(accion: "cerrar")` ×2 | C hasta cargar borradores; confirmar y cerrar, D (`save_payroll_period` siempre pide el sí con la clave) | |
| 23 | «A Pedro el martes ponle 9.5, no 8» (día ya confirmado) | `save_payroll_hours(corregir: { empleado: "Pedro", fecha, horas: 9.5 })` ×2 | D | |
| 24 | «Diego pasa a medio tiempo y su NSS es 1234 56 7890 1» | `list_profiles(persona: "Diego")` → `save_profile(persona: "Diego", jornada: "media", nss: "12345678901")` ×2 | D (la lectura, C) | |
| 25 | «¿Qué tareas altas siguen abiertas? Comenta en la 45 que ya quedó y ciérrala» | `list_tasks(estado: "abierta", prioridad: "alta")` → `get_task(tarea: 45)` → `save_task(tarea: 45, comentario: "…", estado: "cerrada")` directo | C | |

### Controles negativos (no cuentan en las 25)

| # | Frase | Debe pasar | Resultado |
|---|---|---|---|
| C1 | «Borra la cotización de prueba» | Ninguna tool. Dice que eso se hace en la app (`delete_record` no acepta `cotizacion`) | |
| C2 | Con los dos conectores prendidos: «cambia esta cotización: la línea 2 a 120» (tras ver una de DYMMSA-WEB) | `save_quotation`, **nunca** `odoo_save_quotation` (D) | |

### Las dos fases (revisar en las tareas 15–17, 19, 20 y 25)

| Se verifica | Resultado |
|---|---|
| La primera llamada de `delete_record` **no** escribe y el modelo muestra el resumen (qué se pierde, avisos) antes de pedir el sí | |
| Con el sí, repite con **la misma entrada y la clave**; no cambia datos entre las dos | |
| Si algo cambió entre las dos (otra persona edita la factura), la segunda falla con «cambió desde el resumen» y el modelo vuelve a pedir el resumen | |
| Un proveedor con facturas, una marca en uso o una factura pagada salen con `bloqueos` y **sin clave**; el modelo explica cómo desbloquear | |
| `save_payable` / `save_task` / `save_inventory_item`: lo de bajo riesgo escribe directo y dice qué cambió (`cambios`) | |
| Cambiar el monto de una factura **pagada** o el título de una tarea pide el sí con clave | |

## B. Odoo DYMMSA: las 15 tareas

| # | Frase | Secuencia esperada | Resultado |
|---|---|---|---|
| 1 | «¿Quién nos debe más y desde cuándo? Dame el estado de cuenta del primero» | `odoo_list_receivables` → `odoo_get_customer(cliente)` | |
| 2 | «¿A quién le cobro primero esta semana y quién paga más lento?» | `odoo_list_receivables(ordenar: vencido)` y `(ordenar: dias_pago)` | |
| 3 | «Estado de cuenta de Andritz: lo vencido y lo que vence este mes» | `odoo_get_customer(cliente: "Andritz")` | |
| 4 | «Haz esta cotización en Odoo para GE Power: 6 aerosoles 31211507 a $56.03 y 2 brochas de 4"» | `odoo_preview_quotation` → botón de la vista → `odoo_preview_quotation` → sí → `odoo_save_quotation` | |
| 5 | «Dale de alta con la categoría de pinturas en aerosol» | `odoo_preview_quotation(… categoria_sat)` → vista → botón | |
| 6 | «Cámbiale el precio a la línea 3 de la S00915 a $120 y quita la nota del final» | `odoo_preview_quotation(folio)` → `odoo_preview_quotation(folio, lineas)` → sí → `odoo_save_quotation` | |
| 7 | «Confirma la S00912 como venta» | `odoo_preview_quotation(folio)` → sí → `odoo_confirm_quotation(folio, clave)` | |
| 8 | «Haz la factura de la S00912» | `odoo_create_draft_invoice(folio)` (resumen y **clave**) → sí → `odoo_create_draft_invoice(folio, clave)`; repetirla da `sin_cambios` con el borrador existente. **Sin `MCP_PREVIEW_SECRET` responde que la confirmación no está disponible** | |
| 9 | «¿Ya se entregó y facturó todo lo de la S00247? Si falta facturar, factúrala» | `odoo_get_document("S00247")` → la secuencia de la 8 si hace falta | |
| 10 | «¿Qué pagos de septiembre se quedaron sin REP? Abre el primero» | `odoo_audit_payment_complements(desde, hasta)` → `odoo_get_document("PAY…")` | |
| 11 | «¿Qué facturas del mes no están ligadas a su venta? Abre la de FieldCore» | `odoo_audit_invoice_links(desde, hasta)` → `odoo_get_document("F…")` | |
| 12 | «Facturas de GE de agosto con su estado de pago, y el total por estado» | `odoo_summarize_invoices(cliente, desde, hasta, agrupar_por: estado_pago)` → `odoo_search_records(account.move)` | |
| 13 | «¿Cuántas puntas de cobre hay en el almacén de Odoo y cuántas en la tienda?» (los dos conectores) | `odoo_search_stock` y `search_inventory`, sin sumarlos | |
| 14 | «¿Cómo cierra el mes?» (los dos conectores) | `get_month_closing` (DYMMSA-WEB); ninguna tool de Odoo | |
| 15 | «¿Cuál es el correo de trabajo de Diego y qué camioneta tiene asignada?» | `odoo_search_records(hr.employee)` → `odoo_search_records(fleet.vehicle)` | |

Las tools restantes de Odoo (`odoo_summarize_sales`, `odoo_aggregate_records`, `odoo_save_product`) se ejercitan en las tareas 2, 12 y 4–5; el botón de la vista es la única forma de llamar `odoo_save_product`.

## Cobertura por tool

`tests/mcp/evals.test.ts` comprueba que cada tool de los dos conectores aparezca en este guion. La frase que se prueba por tool está en su `docs.evals`.

| Conector | Tools que este guion ejercita |
|---|---|
| DYMMSA-WEB | `get_business_summary`, `list_quotations`, `get_quotation`, `save_quotation`, `list_orders`, `get_order`, `save_order`, `save_order_reception`, `get_cut_plan`, `save_cut_plan`, `save_material_presentation`, `get_purchase_plan`, `save_purchase_decisions`, `search_inventory`, `save_inventory_item`, `search_products`, `save_product`, `search_urrea_catalog`, `save_urrea_catalog_item`, `list_suppliers`, `save_supplier`, `list_payables`, `get_payable`, `get_payables_overview`, `save_payable`, `get_month_closing`, `get_week_hours`, `get_hours_trend`, `list_time_imports`, `preview_time_report`, `save_time_entries`, `save_excused_day`, `list_profiles`, `save_profile`, `get_payroll_period`, `save_payroll_hours`, `save_payroll_employee`, `save_payroll_period`, `list_tasks`, `get_task`, `save_task`, `get_app_settings`, `save_app_settings`, `delete_record` |
| Odoo DYMMSA | `odoo_get_document`, `odoo_get_customer`, `odoo_list_receivables`, `odoo_summarize_invoices`, `odoo_summarize_sales`, `odoo_audit_invoice_links`, `odoo_audit_payment_complements`, `odoo_search_stock`, `odoo_search_records`, `odoo_aggregate_records`, `odoo_preview_quotation`, `odoo_save_quotation`, `odoo_confirm_quotation`, `odoo_save_product`, `odoo_create_draft_invoice` |

## Resultados por corrida

Una fila por corrida; el detalle de cada tarea va en las tablas de arriba (copiar la nota en el chat o en la tarea de GitHub).

| Fecha | Quién | Entorno | Release | DYMMSA-WEB (✓ / ~ / ✗ de las corridas) | Odoo (✓ / ~ / ✗) | Controles | Notas |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Qué hacer con un fallo

- **Tool equivocada o ninguna:** revisar la descripción de la tool que debía ganar y la de su vecina (R9); casi siempre es un «Úsala para…» ambiguo. El texto de la tarea se queda tal cual.
- **Escribió antes del sí:** es un bug del núcleo de dos fases, no del modelo. Reproducir con el harness (`tests/mcp/two-phase.test.ts`) y abrir issue con la secuencia.
- **Pidió un ID/UUID:** una lista dejó de mostrar `ref`, o un `get_*` no lo aceptó (`resolveByName`).
- **Rutinas:** al renombrar una tool, las rutinas programadas (la del viernes) deben actualizarse; ver ADR-041 § «Rutinas a actualizar».
