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
