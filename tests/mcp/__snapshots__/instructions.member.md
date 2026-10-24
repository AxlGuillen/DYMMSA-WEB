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

Las únicas escrituras son las que el mapa marca; todo lo demás es lectura. Antes de escribir di qué y con qué valores. Escritura en dos fases (la que devuelve `clave`): la primera llamada NO escribe y trae el resumen; muéstralo, espera el sí del usuario y solo entonces repite con la misma entrada y la clave. Nunca encadenes las dos fases sin su respuesta. Si una búsqueda por nombre da varias coincidencias, pregunta cuál; los registros se nombran por nombre o ref.

# Reglas de negocio DYMMSA

- **Flujo**: cotización (borrador → en_revision → aprobada | rechazada → convertida) → orden (pedida → recibida → entregada → completada | cancelada).
- **Secciones** (tipo seccion) son encabezados: nunca cuentan en totales, conteos ni aprobaciones.
- **se_vende**: sin_definir | si | no. Con "no" ("no lo vendemos") la línea queda fuera de totales, validación y órdenes. **aprobacion** por línea: pendiente | aprobada | rechazada.
- **Descripción DYMMSA**: catálogo URREA oficial > curada > vacía; en una cotización guardada es un snapshot congelado.
- **Stock**: se deduce al CREAR la orden, no al recibir; cancelarla o eliminarla lo restaura. en_stock + por_pedir = cantidad_aprobada.
- **A URREA se pide** lo que está en su catálogo (URREA/SURTEK/FOY…) según las decisiones de mayoreo guardadas: piezas = paquetes × STD; lo demás es compra local. estado_urrea: pendiente → surtido | no_surtido.
- **Planificador de compra**: decisión mayoreo/menudeo por orden y por grupo (código+marca); "revisar" = el usuario DEBE decidir. Solo se guarda su decisión.
- **Corte**: tubo/placa que se MANDAN A HACER, en mm; la necesidad neta suma un margen por corte (sobreestima a propósito). No va en el Excel URREA.
- **Inventario**: poca = 1 a 5 piezas; la ubicación (gaveta) solo se muestra con existencias.
- **Facturas por pagar** = GASTOS propios (Odoo solo factura a clientes). pagada_el es la fecha REAL de pago; las vencidas cuentan aunque sean de meses previos; las canceladas no cuentan.
- **Cierre del mes** = cobrado (Odoo) − pagado (app); proyectado = real − pendiente del mes − vencido arrastrado. Sin Odoo solo refleja egresos.
- **Cambiar el estado de una cotización** regenera su link de aprobación: el anterior muere.
- **Tareas** = GitHub Issues; prioridad por label; descartada = cerrada como no planeada.
- Moneda: MXN. Cliente principal: distribuidor URREA en Morelia, México.
