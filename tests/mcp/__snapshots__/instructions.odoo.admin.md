# MCP Odoo DYMMSA — mapa de herramientas

La facturación OFICIAL de la empresa vive en Odoo Online, un sistema EXTERNO. Este conector solo ve Odoo: las cotizaciones, órdenes, inventario de la tienda, horas y finanzas de la app están en el conector DYMMSA-WEB. Lectura, más las escrituras acotadas de Cotizar y facturar.
- Un folio (F…, S…, PAY…): odoo_get_document. Un cliente: odoo_get_customer (expediente y estado de cuenta). Toda la cartera ("¿a quién le cobro primero?", "¿quién paga más lento?"): odoo_list_receivables.
- Totales de un periodo: odoo_summarize_invoices, odoo_summarize_sales. Revisiones: odoo_audit_invoice_links (facturas sin orden de venta), odoo_audit_payment_complements (pagos sin REP).
- Almacén de ODOO: odoo_search_stock (la tienda es search_inventory, del conector DYMMSA-WEB).
- Primitivas, solo si nada de lo anterior responde: odoo_search_records (también empleados y flotilla: hr.employee, fleet.vehicle, fleet.vehicle.log.services), odoo_aggregate_records.
- Cotizar y facturar (solo administradores): odoo_preview_quotation (solo lee: vista previa y clave) → sí → odoo_save_quotation (BORRADOR o edición). Confirmar como venta: vista previa con solo el folio (muestra al_confirmar) → sí → odoo_confirm_quotation. Facturar: odoo_create_draft_invoice sin confirmar (resumen) → sí → con confirmar: true (BORRADOR). "Haz esta cotización en Odoo" es este flujo, nunca el navegador. Nunca publica, timbra, envía ni crea clientes; los productos nuevos solo con el botón de la vista (odoo_save_product: no la llames tú).

Regla de oro: Odoo y DYMMSA-WEB son mundos separados — nunca asumas que una cotización u orden de la app corresponde a una de Odoo. Las únicas escrituras son las de Cotizar y facturar; todo lo demás es lectura.

Antes de cualquier escritura, di exactamente qué vas a hacer y con qué valores, y espera la confirmación del usuario. Si una búsqueda por nombre devuelve varias coincidencias, pregunta cuál en vez de adivinar.

Notas de crédito (Odoo): una nota de crédito sin aplicar es SALDO A FAVOR del cliente, no deuda. Las tools la reportan aparte (campos notas_credito*) y NUNCA la restan del vencido ni del por cobrar — es decisión del negocio (no se sabe si el cliente la usará o si se aplicará a una factura). No hagas ese neteo tú tampoco.

- Cartera = facturas abiertas, brutas por factura como la pantalla Clientes; cartera_contable (odoo_get_customer) es el saldo neto de Odoo: no lo cuadres contra la bruta.
- **Vínculo factura↔orden de venta (Odoo)**: la verdad es ordenes_ligadas (el botón "Órdenes de venta" de la factura) y el vínculo línea a línea; origen (invoice_origin) es texto libre y NO prueba el vínculo — una factura con origen pero 0 órdenes ligadas tiene el vínculo roto. Las notas al pie (pedido_pie, "PEDIDO: …") vienen de Odoo, no de capturas.
- Moneda: MXN; un documento en otra moneda se reporta sin convertir.
