# Historial de migraciones aplicadas (Supabase `wjlklwtvjewhtghlskbt`)

Extraído de la BD real (`list_migrations`) el 2026-07-13. Las migraciones se
aplican vía el MCP de Supabase (`apply_migration`); este log conserva la
cronología en git. El estado acumulado vive en [schema.sql](./schema.sql).

> Nota: el schema base (Fases 0-5: tablas core, RLS, funciones) se creó antes
> de que se usara `apply_migration`, por eso el registro empieza en 2026-03.
> El detalle narrativo de cada cambio está en `DYMMSA/06-Changelog/`.

| Versión | Nombre |
|---|---|
| 20260306214536 | add_delivery_time_to_order_items |
| 20260309004641 | add_delivery_time_to_quotation_items |
| 20260319012014 | add_sort_order_to_quotation_items |
| 20260321010344 | add_name_to_quotations |
| 20260321010959 | add_name_to_orders |
| 20260330002338 | add_item_type_and_section_label |
| 20260401042130 | add_sort_order_to_order_items |
| 20260401050143 | link_orders_to_quotations_and_fix_sort_order |
| 20260409055423 | rename_order_statuses_to_generic |
| 20260519042151 | allow_all_authenticated_users_to_manage_quotations |
| 20260521202944 | add_odoo_id_to_orders |
| 20260524194310 | allow_separators_in_order_items_quantity |
| 20260618063652 | create_urrea_catalog |
| 20260707035238 | add_is_sold_to_etm_and_quotation_items |
| 20260707060022 | add_location_to_inventory_and_order_items |
| 20260707062651 | add_approved_at_to_quotations |
| 20260708191200 | add_dymmsa_description |
| 20260708231212 | drop_price_from_urrea_catalog |
| 20260709195136 | create_task_images_bucket |
| 20260714000759 | cleanup_legacy_policies_and_cruft — DROP policies anon de etm_products (seguridad), policies authenticated duplicadas, UNIQUE duplicado en etm, default legacy de orders.status → 'ordered', DROP cancel_order() sin uso |
| 20260714184841 | add_brand_to_urrea_catalog — columna `brand text NOT NULL DEFAULT 'URREA'`; UNIQUE(code) → UNIQUE(code, brand); índice de marca. Backfill de filas existentes a 'URREA'. |
| 20260714185216 | urrea_catalog_brand_counts_fn — RPC `urrea_catalog_brand_counts()` (conteo por marca para el filtro del catálogo; security invoker) |
| 20260715223723 | create_purchase_planner_tables — `order_purchase_decisions` (decisión mayoreo/menudeo por orden a nivel grupo; UNIQUE(order_id, model_code, brand), CHECK cobertura `paq×std+retail >= needed`) y `app_settings` (key-value jsonb para umbrales; sin seeds, defaults en código). RLS + policy authenticated en ambas. ADR-018. |
| 20260716000343 | allow_received_to_exceed_ordered — DROP `check_received_not_exceed_ordered`: lo recibido puede superar lo pedido (recepción con excedente; solo el excedente entra a inventario, por delta). Se conserva `quantity_received >= 0`. ADR-019. |
| 20260716230443 | create_suppliers_module — tablas `suppliers` (contacto: name UNIQUE, phone, whatsapp, email, address, notes), `brands` (catálogo global, name UNIQUE normalizado trim+upper, **sembrada** con las marcas existentes de etm_products+urrea_catalog) y `supplier_brands` (M2M; brand_id SIN cascade → borrar marca en uso se bloquea). RLS + policies authenticated. Issue #21. |
| 20260729112500 | inventory_brand_view — vista `store_inventory_with_brand` (marca resuelta por `model_code` contra `etm_products`, security invoker) + RPC `inventory_brand_counts()` (total y con stock, para el selector) + índice `idx_etm_products_model_code_norm`. Habilita filtrar el inventario por marca server-side. Issue #53. |
| 20260731111250 | cut_module_tables — módulo de corte (issue #59, Fase 1): `cut_plan_pieces` (lista de corte por orden; CHECK de forma tubo/placa, `requested_label` registra el match cliente↔medida, FK a orders CASCADE y a order_items SET NULL), `material_presentations` (presentaciones del proveedor capturadas al usarlas; UNIQUE NULLS NOT DISTINCT contra duplicados), y 5 columnas `cut_*` nominales en `etm_products` (solo pre-llenado). RLS + policies authenticated. Unidades en mm (numeric). |
| 20260821055522 | add_separator_color — columna `separator_color` (text, nullable) en `quotation_items` y `order_items` con CHECK `IS NULL OR item_type='separator'`. Override manual del color de sección de los separadores; NULL = color automático por índice (solo presentación). Viaja de la cotización a la orden como `section_label`. Issue #73. |
