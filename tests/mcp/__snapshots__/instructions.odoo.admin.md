# MCP Odoo DYMMSA — mapa de herramientas

La facturación OFICIAL de la empresa vive en Odoo Online, un sistema EXTERNO. Este conector solo ve Odoo: las cotizaciones, órdenes, inventario de la tienda, horas y finanzas de la app están en el conector DYMMSA-WEB. Lectura, más las escrituras acotadas de Cotizar y facturar.
- Primitivas: odoo_query, odoo_aggregate (cola larga de preguntas sobre el catálogo permitido).
- Contabilidad: odoo_overdue_invoices (cartera vencida o estado de cuenta), odoo_invoices_summary, odoo_invoice_detail, odoo_payment_detail, odoo_rep_audit, odoo_invoice_link_check (facturas del periodo sin orden de venta ligada — la revisión periódica en una llamada).
- Ventas y cobranza: odoo_sales_summary, odoo_customer_profile (incluye la cartera del cliente: deuda total, vencido y días promedio de pago), odoo_sale_detail, odoo_receivables_ranking ("¿a quién le cobro primero?" / "¿quién paga más lento?").
- Operación: odoo_stock_check (almacén de ODOO — no confundir con search_inventory, que es la tienda), odoo_employee_directory, odoo_fleet_status.
- Cotizar y facturar (solo administradores): odoo_preview_quotation (solo lee: vista previa y clave) → tras el sí, odoo_save_quotation (BORRADOR, editar o confirmar como venta) → odoo_create_draft_invoice (factura completa en BORRADOR). "Haz esta cotización en Odoo" es este flujo, nunca el navegador. Nunca publica, timbra, envía ni crea clientes; los productos nuevos solo con el botón de la vista (odoo_save_product: no la llames tú).

Regla de oro: Odoo y DYMMSA-WEB son mundos separados — nunca asumas que una cotización u orden de la app corresponde a una de Odoo. Las únicas escrituras son las de Cotizar y facturar; todo lo demás es lectura.

Antes de cualquier escritura, di exactamente qué vas a hacer y con qué valores, y espera la confirmación del usuario. Si una búsqueda por nombre devuelve varias coincidencias, pregunta cuál en vez de adivinar.

Notas de crédito (Odoo): una nota de crédito sin aplicar es SALDO A FAVOR del cliente, no deuda. Las tools la reportan aparte (campos notas_credito*) y NUNCA la restan del vencido ni del por cobrar — es decisión del negocio (no se sabe si el cliente la usará o si se aplicará a una factura). No hagas ese neteo tú tampoco.

- **Vínculo factura↔orden de venta (Odoo)**: la verdad es ordenes_ligadas (el botón "Órdenes de venta" de la factura) y el vínculo línea a línea; origen (invoice_origin) es texto libre y NO prueba el vínculo — una factura con origen pero 0 órdenes ligadas tiene el vínculo roto. Las notas al pie (pedido_pie, "PEDIDO: …") vienen de Odoo, no de capturas.
- Moneda: MXN; un documento en otra moneda se reporta sin convertir.
