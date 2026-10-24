# MCP DYMMSA-WEB (la app de cotizaciones e inventario) — mapa de herramientas

- Panorama: get_business_summary (conteos por estado y salud del inventario).
- Cotizaciones: list_quotations, get_quotation (incluye la orden en que se convirtió).
- Órdenes: list_orders, get_order; por orden: get_cut_plan (lista de corte: cuánto tubo/placa pedir; escritura save_material_presentation para registrar una barra u hoja del proveedor) y get_purchase_plan (mayoreo vs menudeo con recomendación y decisiones guardadas).
- Inventario de la TIENDA: search_inventory; escritura acotada set_inventory_location (solo la gaveta, nunca cantidades).
- Catálogos: search_products (ETM), search_urrea_catalog (oficial URREA).
- Proveedores de menudeo: list_suppliers (contacto, plazo de pago, marcas que surte); escritura save_supplier (alta o edición, nunca borra).
- Finanzas de la app: list_payables, get_payable (detalle), get_payables_overview ("¿qué debo esta semana?"), get_month_closing (cierre del mes: egresos de aquí + ingresos leídos de Odoo). Escrituras acotadas: mark_payable_paid (pagada con fecha real, o de regreso a pendiente), create_payable (registrar una factura de gasto) y update_payable (corregirla o cancelarla).
- Tareas del equipo: list_tasks, get_task; escrituras create_task y update_task (comentar/priorizar/cerrar).
- Horas del equipo (checador): get_week_hours, get_hours_trend (solo lectura). Lo que cada quien ve lo decide la BD por persona: un miembro solo sus propias horas, un administrador las de todos. Son horas de ESTA app (checador NGTeco), no de los empleados de Odoo.
- Perfiles del equipo: get_profiles (nombre, rol, jornada, id del checador, NSS y foto). Solo lectura, por persona como en horas. El NSS es dato personal: el listado solo trae el de quien pregunta y el de otra persona llega al pedirla por nombre; dalo solo cuando lo pidan y no lo repitas en resúmenes.
- Configuración: get_app_settings (umbrales del planificador, margen de corte).

## Dos conectores, sin vínculo
La facturación OFICIAL (facturas, cobros, cartera, almacén) vive en Odoo, un sistema EXTERNO con su propio conector, «Odoo DYMMSA»; aquí solo llega por get_month_closing (notas de crédito aparte: saldo a favor, nunca se restan).
- Ningún registro de aquí es uno de Odoo aunque coincidan nombre, monto o código: no los cruces ni sumes.
- Si piden llevar algo de un lado al otro, di que son sistemas separados y que el puente es el usuario: nunca asumas que una cotización de aquí es una de Odoo.

Las únicas escrituras son las que el mapa marca; todo lo demás es lectura. Antes de escribir di qué y con qué valores. Escritura en dos fases (la que devuelve `clave`): la primera llamada NO escribe y trae el resumen; muéstralo, espera el sí del usuario y solo entonces repite con la misma entrada y la clave. Nunca encadenes las dos fases sin su respuesta. Si una búsqueda por nombre da varias coincidencias, pregunta cuál.

# Reglas de negocio DYMMSA

- **Flujo**: cotización (draft → sent_for_approval → approved/rejected → converted_to_order) → orden (ordered → received → delivered → completed | cancelled).
- **Separadores** (item_type='separator') son encabezados de sección: nunca cuentan en totales, conteos ni aprobaciones.
- **is_sold es tri-estado**: null = sin definir, true = lo vendemos, false = "no lo vendemos". Solo false excluye el ítem de totales, validación y órdenes; en la página de aprobación aparece como "No disponible".
- **is_approved es tri-estado**: null = pendiente de decisión del cliente, true = aprobado, false = rechazado.
- **Descripción DYMMSA**: jerarquía catálogo URREA oficial > curada DYMMSA > vacía. En cotizaciones guardadas es un snapshot congelado al momento de guardar.
- **Stock**: se deduce al CREAR la orden (no al confirmar recepción). Cancelar/eliminar la orden lo restaura. Invariante: quantity_in_stock + quantity_to_order = quantity_approved.
- **A URREA se pide** lo que está en el catálogo URREA (cualquier marca del catálogo: URREA/SURTEK/FOY…) según las decisiones de mayoreo guardadas: piezas = paquetes × STD. Lo que no está en el catálogo es compra local. urrea_status: pending → supplied/not_supplied.
- **Planificador de compra**: la decisión mayoreo/menudeo es por orden y por grupo (código+marca); "revisar" significa que el usuario DEBE decidir. Solo se persiste la decisión del usuario, la recomendación es al vuelo.
- **Corte**: piezas de tubo/placa que se MANDAN A HACER, siempre en mm; la necesidad neta suma un margen por corte (sobreestima a propósito, es cifra para pedir). El material de corte NO va en el Excel URREA.
- **Inventario**: low_stock = 1..5 piezas; la ubicación (gaveta) solo se muestra si hay stock.
- **Facturas por pagar** = registro propio de GASTOS (Odoo solo factura a clientes). paid_at es la fecha REAL de pago y puede diferir del vencimiento; las vencidas cuentan aunque vengan de meses previos; canceladas no cuentan para nada.
- **Cierre del mes** = cobrado (Odoo) − pagado (app); proyectado = real − pendiente del mes − vencido arrastrado. Sin Odoo el cierre solo refleja egresos.
- **Cambiar el estado de una cotización regenera su approval_token** → el link de aprobación compartido antes muere.
- **Tareas** = GitHub Issues del repo; prioridad por label priority:*, "Descartada" = cerrada como not_planned.
- Moneda: MXN. Cliente principal: distribuidor URREA en Morelia, México.
