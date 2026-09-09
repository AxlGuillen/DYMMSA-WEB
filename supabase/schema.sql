-- ============================================================================
-- DYMMSA — Snapshot del schema de Supabase (proyecto wjlklwtvjewhtghlskbt)
-- Generado desde la BD real el 2026-07-13 vía MCP de Supabase (pg_catalog);
-- regenerado el 2026-07-16 tras la migración create_suppliers_module.
--
-- FUENTE DE RECONSTRUCCIÓN, no migración ejecutable tal cual: refleja el
-- estado acumulado. El historial cronológico vive en migrations-log.md.
--
-- REGLA (CLAUDE.md § auto-mejora): toda migración nueva debe regenerar este
-- archivo en el mismo commit. Cómo: correr las queries de pg_catalog
-- documentadas en el commit que creó este archivo, o pedirle a Claude
-- "regenera supabase/schema.sql desde la BD".
-- ============================================================================

-- ─── Extensiones ────────────────────────────────────────────────────────────
-- moddatetime v1.0 · pgcrypto v1.3 · uuid-ossp v1.1
-- pg_stat_statements v1.11 · supabase_vault v0.3.1

-- ─── Tablas ─────────────────────────────────────────────────────────────────

CREATE TABLE public.etm_products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  etm text NOT NULL,
  description text,
  description_es text,
  model_code text NOT NULL,
  price numeric(10,2),
  brand text DEFAULT 'URREA'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  is_sold boolean,            -- tri-estado: null=sin definir, true=lo vendemos, false=no
  dymmsa_description text     -- curada; vacía si hay match en urrea_catalog (ADR-013)
);

CREATE TABLE public.quotations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_name text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  approval_token uuid DEFAULT gen_random_uuid(),
  total_amount numeric(10,2) DEFAULT 0 NOT NULL,
  notes text,
  original_file_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  name text DEFAULT ''::text NOT NULL,
  approved_at timestamp with time zone   -- sellada al aprobar; se preserva siempre
);

CREATE TABLE public.quotation_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quotation_id uuid NOT NULL,
  etm text,
  description text,
  description_es text,
  model_code text,
  brand text,
  unit_price numeric(10,2),
  quantity integer,
  is_approved boolean,        -- tri-estado: null=pendiente, true/false=decisión del cliente
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  delivery_time text DEFAULT 'immediate'::text,
  sort_order integer DEFAULT 0 NOT NULL,
  item_type text DEFAULT 'product'::text NOT NULL,
  section_label text,
  separator_color text,      -- override manual del color de seccion; NULL = automatico (issue #73)
  is_sold boolean,
  dymmsa_description text     -- snapshot del valor RESUELTO al guardar (ADR-013)
);

CREATE TABLE public.orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_name text NOT NULL,
  status text DEFAULT 'ordered'::text NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  original_file_url text,
  urrea_order_file_url text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  quotation_id uuid,
  name text DEFAULT ''::text NOT NULL,
  odoo_id text
);

CREATE TABLE public.order_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  etm text,
  model_code text NOT NULL,
  description text,
  quantity_approved integer NOT NULL,
  quantity_in_stock integer DEFAULT 0 NOT NULL,
  quantity_to_order integer DEFAULT 0 NOT NULL,
  quantity_received integer DEFAULT 0 NOT NULL,
  urrea_status text DEFAULT 'pending'::text NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  brand text DEFAULT ''::text NOT NULL,
  description_es text,
  delivery_time text DEFAULT 'immediate'::text,
  item_type text DEFAULT 'product'::text NOT NULL,
  section_label text,
  separator_color text,      -- override manual del color de seccion; NULL = automatico (issue #73)
  sort_order integer DEFAULT 0 NOT NULL,
  location text               -- snapshot de store_inventory.location al crear la orden
);

-- ADR-018: decisiones de compra mayoreo/menudeo por orden, a nivel GRUPO
-- (model_code+brand normalizados) — la necesidad se consolida entre líneas
-- duplicadas antes de decidir. Recomendación siempre al vuelo; esto es la
-- decisión final del usuario para ESA orden (nunca verdad global del producto).
CREATE TABLE public.order_purchase_decisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  model_code text NOT NULL,   -- SIEMPRE normalizado trim+upper (catalogKey)
  brand text NOT NULL,        -- SIEMPRE normalizado trim+upper
  std_snapshot integer NOT NULL,  -- STD del catálogo al decidir (staleness si cambia)
  needed_qty integer NOT NULL,    -- N consolidado al decidir (staleness si cambia)
  packages_wholesale integer DEFAULT 0 NOT NULL,
  qty_retail integer DEFAULT 0 NOT NULL,
  decided_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.store_inventory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  model_code text NOT NULL,
  quantity integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  location text               -- gaveta; se conserva aunque quantity=0
);

CREATE TABLE public.urrea_catalog (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,         -- SIEMPRE normalizado trim+upper (ADR-013)
  brand text DEFAULT 'URREA' NOT NULL,  -- normalizado trim+upper; identidad = (code, brand)
  description text,
  std integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ADR-018 §7: configuración key-value (umbrales del planificador de compra).
-- Sin seeds: los defaults viven en código (src/lib/purchase-plan.ts).
CREATE TABLE public.app_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Proveedores de menudeo (issue #21). Módulo standalone; las marcas cruzan
-- por VALOR (nombre normalizado) con etm_products/urrea_catalog en el futuro.
CREATE TABLE public.suppliers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  phone text,
  whatsapp text,
  email text,
  address text,
  notes text,
  payment_terms_days integer,      -- plazo de credito en dias; NULL = contado (issue #84)
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Facturas por pagar (Finanzas, issue #84). Registro simbolico de gastos —
-- la facturacion oficial vive en Odoo; esto alimenta el overview de vencimientos.
CREATE TABLE public.payables (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  supplier_id uuid NOT NULL,
  concept text NOT NULL,
  amount numeric NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  paid_at date,               -- fecha REAL de pago; puede diferir del vencimiento
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Catálogo global de marcas (submódulo de proveedores). name normalizado
-- trim+upper. Sembrada con las marcas existentes de etm_products+urrea_catalog.
CREATE TABLE public.brands (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- M2M proveedor↔marca. brand_id SIN cascade: borrar una marca en uso se bloquea.
CREATE TABLE public.supplier_brands (
  supplier_id uuid NOT NULL,
  brand_id uuid NOT NULL
);

-- ─── Constraints ────────────────────────────────────────────────────────────

ALTER TABLE etm_products ADD CONSTRAINT etm_products_pkey PRIMARY KEY (id);
ALTER TABLE etm_products ADD CONSTRAINT etm_products_etm_key UNIQUE (etm);
ALTER TABLE etm_products ADD CONSTRAINT etm_products_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE quotations ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);
ALTER TABLE quotations ADD CONSTRAINT quotations_approval_token_key UNIQUE (approval_token);
ALTER TABLE quotations ADD CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE quotations ADD CONSTRAINT quotations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent_for_approval'::text, 'approved'::text, 'rejected'::text, 'converted_to_order'::text])));
ALTER TABLE quotations ADD CONSTRAINT quotations_total_check CHECK ((total_amount >= (0)::numeric));

ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_pkey PRIMARY KEY (id);
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE;
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_price_check CHECK (((unit_price IS NULL) OR (unit_price >= (0)::numeric)));
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_quantity_check CHECK (((quantity IS NULL) OR (quantity > 0)));
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_separator_color_check CHECK (((separator_color IS NULL) OR (item_type = 'separator'::text)));

ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE orders ADD CONSTRAINT orders_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES quotations(id);
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['ordered'::text, 'received'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE orders ADD CONSTRAINT orders_total_amount_check CHECK ((total_amount >= (0)::numeric));

ALTER TABLE order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
-- El invariante crítico del CLAUDE.md, encodado en BD:
ALTER TABLE order_items ADD CONSTRAINT check_quantity_sum CHECK (((quantity_in_stock + quantity_to_order) = quantity_approved));
-- (check_received_not_exceed_ordered eliminado el 2026-07-15, ADR-019:
--  lo recibido puede superar lo pedido; solo el excedente entra a inventario)
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_approved_check CHECK (((quantity_approved > 0) OR (item_type = 'separator'::text)));
ALTER TABLE order_items ADD CONSTRAINT order_items_separator_color_check CHECK (((separator_color IS NULL) OR (item_type = 'separator'::text)));
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_in_stock_check CHECK ((quantity_in_stock >= 0));
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_received_check CHECK ((quantity_received >= 0));
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_to_order_check CHECK ((quantity_to_order >= 0));
ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE order_items ADD CONSTRAINT order_items_urrea_status_check CHECK ((urrea_status = ANY (ARRAY['pending'::text, 'supplied'::text, 'not_supplied'::text])));
ALTER TABLE order_items ADD CONSTRAINT order_items_delivery_time_check CHECK ((delivery_time = ANY (ARRAY['immediate'::text, '2_3_days'::text, '3_5_days'::text, '1_week'::text, '2_weeks'::text, 'indefinite'::text])));

ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_pkey PRIMARY KEY (id);
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_key UNIQUE (order_id, model_code, brand);
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_std_check CHECK ((std_snapshot > 0));
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_needed_check CHECK ((needed_qty > 0));
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_packages_check CHECK ((packages_wholesale >= 0));
ALTER TABLE order_purchase_decisions ADD CONSTRAINT order_purchase_decisions_retail_check CHECK ((qty_retail >= 0));
-- La decisión siempre cubre la necesidad (mixto = exacto; mayoreo redondeado = excedente):
ALTER TABLE order_purchase_decisions ADD CONSTRAINT check_decision_covers_needed CHECK (((packages_wholesale * std_snapshot + qty_retail) >= needed_qty));

ALTER TABLE store_inventory ADD CONSTRAINT store_inventory_pkey PRIMARY KEY (id);
ALTER TABLE store_inventory ADD CONSTRAINT store_inventory_model_code_key UNIQUE (model_code);
ALTER TABLE store_inventory ADD CONSTRAINT store_inventory_quantity_check CHECK ((quantity >= 0));

ALTER TABLE urrea_catalog ADD CONSTRAINT urrea_catalog_pkey PRIMARY KEY (id);
ALTER TABLE urrea_catalog ADD CONSTRAINT urrea_catalog_code_brand_key UNIQUE (code, brand);
ALTER TABLE urrea_catalog ADD CONSTRAINT urrea_catalog_std_check CHECK ((std > 0));

ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

ALTER TABLE suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_name_key UNIQUE (name);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_name_not_blank CHECK ((btrim(name) <> ''));
ALTER TABLE payables ADD CONSTRAINT payables_pkey PRIMARY KEY (id);
-- SIN cascade a proposito: borrar un proveedor con facturas se bloquea (23503).
ALTER TABLE payables ADD CONSTRAINT payables_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE payables ADD CONSTRAINT payables_concept_not_blank CHECK ((btrim(concept) <> ''));
ALTER TABLE payables ADD CONSTRAINT payables_amount_check CHECK ((amount > 0));
ALTER TABLE payables ADD CONSTRAINT payables_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text])));
ALTER TABLE suppliers ADD CONSTRAINT suppliers_payment_terms_days_check CHECK (((payment_terms_days IS NULL) OR (payment_terms_days >= 0)));

ALTER TABLE brands ADD CONSTRAINT brands_pkey PRIMARY KEY (id);
ALTER TABLE brands ADD CONSTRAINT brands_name_key UNIQUE (name);
ALTER TABLE brands ADD CONSTRAINT brands_name_not_blank CHECK ((btrim(name) <> ''));

ALTER TABLE supplier_brands ADD CONSTRAINT supplier_brands_pkey PRIMARY KEY (supplier_id, brand_id);
ALTER TABLE supplier_brands ADD CONSTRAINT supplier_brands_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
-- Sin CASCADE a propósito: bloquea eliminar una marca asignada a proveedores.
ALTER TABLE supplier_brands ADD CONSTRAINT supplier_brands_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id);

-- ─── Índices (adicionales a los de constraints) ─────────────────────────────

CREATE INDEX idx_etm_products_etm ON public.etm_products USING btree (etm);
CREATE INDEX idx_etm_products_marca ON public.etm_products USING btree (brand);
CREATE INDEX idx_etm_products_modelo ON public.etm_products USING btree (model_code);
CREATE INDEX idx_order_items_etm ON public.order_items USING btree (etm);
CREATE INDEX idx_order_items_model_code ON public.order_items USING btree (model_code);
CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX idx_order_items_urrea_status ON public.order_items USING btree (urrea_status);
CREATE INDEX idx_order_purchase_decisions_order_id ON public.order_purchase_decisions USING btree (order_id);
CREATE INDEX idx_supplier_brands_brand_id ON public.supplier_brands USING btree (brand_id);
CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);
CREATE INDEX idx_orders_created_by ON public.orders USING btree (created_by);
CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_name);
CREATE INDEX idx_orders_quotation_id ON public.orders USING btree (quotation_id);
CREATE INDEX idx_orders_status ON public.orders USING btree (status);
CREATE INDEX idx_quotation_items_etm ON public.quotation_items USING btree (etm);
CREATE INDEX idx_quotation_items_quotation_id ON public.quotation_items USING btree (quotation_id);
CREATE INDEX idx_quotations_created_at ON public.quotations USING btree (created_at DESC);
CREATE INDEX idx_quotations_created_by ON public.quotations USING btree (created_by);
CREATE INDEX idx_quotations_status ON public.quotations USING btree (status);
CREATE UNIQUE INDEX idx_quotations_token ON public.quotations USING btree (approval_token);
CREATE INDEX idx_store_inventory_model ON public.store_inventory USING btree (model_code);
CREATE INDEX urrea_catalog_description_idx ON public.urrea_catalog USING btree (description);
CREATE INDEX idx_urrea_catalog_brand ON public.urrea_catalog USING btree (brand);

-- ─── Funciones ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- Conteo por marca del catálogo (filtro de la UI). security invoker → respeta RLS.
CREATE OR REPLACE FUNCTION public.urrea_catalog_brand_counts()
 RETURNS TABLE(brand text, count bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path = public
AS $function$
  SELECT brand, count(*)::bigint
  FROM public.urrea_catalog
  GROUP BY brand
  ORDER BY count(*) DESC;
$function$;

-- ─── Triggers ───────────────────────────────────────────────────────────────

CREATE TRIGGER update_etm_products_updated_at BEFORE UPDATE ON public.etm_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quotations_updated_at BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_store_inventory_updated_at BEFORE UPDATE ON public.store_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER urrea_catalog_set_updated_at BEFORE UPDATE ON public.urrea_catalog FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER payables_set_updated_at BEFORE UPDATE ON public.payables FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE INDEX idx_payables_status_due_date ON public.payables (status, due_date);
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.etm_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.urrea_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_purchase_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can delete products" ON public.etm_products FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert products" ON public.etm_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read products" ON public.etm_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update products" ON public.etm_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage order items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can read order items" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage all quotation items" ON public.quotation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage all quotations" ON public.quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage inventory" ON public.store_inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can read inventory" ON public.store_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage urrea_catalog" ON public.urrea_catalog FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage purchase decisions" ON public.order_purchase_decisions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage app settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage payables" ON public.payables FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage brands" ON public.brands FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage supplier brands" ON public.supplier_brands FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── Storage ────────────────────────────────────────────────────────────────
-- bucket task-images · public=true · límite 5 MB · PNG/JPEG/GIF/WEBP
-- (creado por la migración create_task_images_bucket, ADR-014)

-- ─── Inventario con marca resuelta (issue #53) ──────────────────────────────
-- `store_inventory` no guarda la marca: se cruza POR VALOR con `etm_products`
-- (misma filosofía que `urrea_catalog`). La vista la resuelve para poder
-- FILTRAR y PAGINAR server-side. Prefiere la fila de etm_products que SÍ trae
-- marca: muchos ETM la tienen vacía y hay `model_code` duplicados, así que
-- quedarse con "el más reciente" devolvería vacío aunque un hermano sí la
-- tenga. Sin ninguna coincidencia con marca → NULL ("sin marca").

CREATE INDEX IF NOT EXISTS idx_etm_products_model_code_norm
  ON public.etm_products (upper(trim(model_code)));

CREATE OR REPLACE VIEW public.store_inventory_with_brand
WITH (security_invoker = on) AS
SELECT
  i.id,
  i.model_code,
  i.quantity,
  i.location,
  i.updated_at,
  (SELECT upper(trim(e.brand))
     FROM public.etm_products e
    WHERE upper(trim(e.model_code)) = upper(trim(i.model_code))
      AND nullif(trim(e.brand), '') IS NOT NULL
    ORDER BY e.updated_at DESC NULLS LAST
    LIMIT 1) AS brand
FROM public.store_inventory i;

-- Conteos para el selector de marca (PostgREST no hace GROUP BY).
CREATE OR REPLACE FUNCTION public.inventory_brand_counts()
 RETURNS TABLE(brand text, total bigint, with_stock bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path = public
AS $function$
  SELECT v.brand,
         count(*) AS total,
         count(*) FILTER (WHERE v.quantity > 0) AS with_stock
  FROM public.store_inventory_with_brand v
  GROUP BY v.brand
  ORDER BY count(*) DESC, v.brand ASC;
$function$;

GRANT SELECT ON public.store_inventory_with_brand TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_brand_counts() TO anon, authenticated, service_role;

-- ─── Módulo de corte de material (issue #59, Fase 1) ────────────────────────
-- Tubos y placas de cobre (marca DYMMSA) que se mandan a hacer. Unidades en mm
-- (numeric: hay imperiales tipo 1/2" = 12.7 mm). Las longitudes pedidas varían
-- por pedido → tabla propia por orden, NO columnas fijas del producto.

CREATE TABLE public.cut_plan_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  material_type text NOT NULL CHECK (material_type IN ('tube', 'plate')),
  diameter_mm numeric CHECK (diameter_mm > 0),
  thickness_mm numeric CHECK (thickness_mm > 0),
  width_mm numeric CHECK (width_mm > 0),
  length_mm numeric NOT NULL CHECK (length_mm > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  -- Lo que pidió el cliente vs la medida usada (el "match" que hoy se pierde).
  requested_label text,
  source_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cut_piece_shape CHECK (
    (material_type = 'tube'  AND diameter_mm IS NOT NULL AND width_mm IS NULL AND thickness_mm IS NULL) OR
    (material_type = 'plate' AND width_mm IS NOT NULL AND thickness_mm IS NOT NULL AND diameter_mm IS NULL)
  )
);

CREATE INDEX idx_cut_plan_pieces_order ON public.cut_plan_pieces(order_id);

CREATE TRIGGER update_cut_plan_pieces_updated_at
  BEFORE UPDATE ON public.cut_plan_pieces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Presentaciones del proveedor: catálogo que SE ARMA SOLO con el uso (no se
-- conoce su catálogo completo; cada "tengo barras de 6 m" capturado se guarda).
CREATE TABLE public.material_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type text NOT NULL CHECK (material_type IN ('tube', 'plate')),
  diameter_mm numeric CHECK (diameter_mm > 0),
  thickness_mm numeric CHECK (thickness_mm > 0),
  width_mm numeric CHECK (width_mm > 0),
  length_mm numeric NOT NULL CHECK (length_mm > 0),
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT material_presentation_shape CHECK (
    (material_type = 'tube'  AND diameter_mm IS NOT NULL AND width_mm IS NULL AND thickness_mm IS NULL) OR
    (material_type = 'plate' AND width_mm IS NOT NULL AND thickness_mm IS NOT NULL AND diameter_mm IS NULL)
  ),
  -- Sin NULLS NOT DISTINCT, los NULL del tipo contrario colarían duplicados.
  CONSTRAINT material_presentation_unique UNIQUE NULLS NOT DISTINCT
    (material_type, diameter_mm, thickness_mm, width_mm, length_mm)
);

-- Medidas nominales del producto DYMMSA: SOLO pre-llenan la lista de corte
-- (hoy viven como texto libre en la descripción, p. ej. 'Copper Punch 30/300mm').
ALTER TABLE public.etm_products
  ADD COLUMN cut_kind text CHECK (cut_kind IN ('tube', 'plate')),
  ADD COLUMN cut_diameter_mm numeric CHECK (cut_diameter_mm > 0),
  ADD COLUMN cut_thickness_mm numeric CHECK (cut_thickness_mm > 0),
  ADD COLUMN cut_width_mm numeric CHECK (cut_width_mm > 0),
  ADD COLUMN cut_length_mm numeric CHECK (cut_length_mm > 0);

ALTER TABLE public.cut_plan_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_presentations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage cut pieces"
  ON public.cut_plan_pieces FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage presentations"
  ON public.material_presentations FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.cut_plan_pieces TO anon, authenticated, service_role;
GRANT ALL ON public.material_presentations TO anon, authenticated, service_role;

-- ─── Módulo de horas (issue #93): perfiles con rol + checadas del checador ───
-- Primer permiso por persona del sistema (ADR-026).

-- profiles: 1:1 con auth.users. role gobierna RLS; clock_employee_id mapea al checador.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  clock_employee_id integer UNIQUE CHECK (clock_employee_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- Perfil automático por usuario nuevo. Corre como supabase_auth_admin, que no tiene
-- permisos en public: SECURITY DEFINER es obligatorio. Si falla, el alta aborta a propósito.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      NEW.id::text
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill genérico: los usuarios que ya existían. No-op en un stack vacío.
INSERT INTO public.profiles (id, display_name)
SELECT
  id,
  COALESCE(
    NULLIF(raw_user_meta_data->>'full_name', ''),
    NULLIF(raw_user_meta_data->>'display_name', ''),
    NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
    id::text
  )
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- DEFINER lee profiles como owner: la policy de profiles nunca se re-evalúa a sí misma.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- time_entries: una fila por pareja de checada. Totales calculados, nunca guardados.
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sin cascade: borrar un usuario no borra nómina.
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  work_date date NOT NULL,
  -- Lo que dijo el checador. Inmutable: es la llave de idempotencia del re-import.
  source_clock_in time NOT NULL,
  clock_in time NOT NULL,
  clock_out time,
  note text,
  source text NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual')),
  edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_at timestamptz,
  -- Snapshot pre-edición, se escribe una sola vez: conserva lo que dijo el checador.
  original jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_out_after_in CHECK (clock_out IS NULL OR clock_out >= clock_in),
  CONSTRAINT time_entries_source_key UNIQUE (user_id, work_date, source_clock_in)
);
CREATE INDEX idx_time_entries_user_date ON public.time_entries (user_id, work_date);
CREATE TRIGGER time_entries_set_updated_at BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own entries, admins read all" ON public.time_entries
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "Admins insert entries" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins update entries" ON public.time_entries
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete entries" ON public.time_entries
  FOR DELETE TO authenticated USING (public.is_admin());

-- time_imports: bitácora de cargas del reporte semanal.
CREATE TABLE public.time_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  file_name text,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped_edited integer NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_imports_period_check CHECK (period_end >= period_start)
);
ALTER TABLE public.time_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read imports" ON public.time_imports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert imports" ON public.time_imports
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- Carga transaccional. INVOKER: RLS e is_admin() aplican al que llama. Las filas
-- editadas por un admin (edited_at) no se pisan y se reportan como saltadas.
CREATE OR REPLACE FUNCTION public.import_time_entries(
  p_entries jsonb,
  p_period_start date,
  p_period_end date,
  p_file_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer := 0;
  v_updated integer := 0;
  v_total integer := 0;
  v_import_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (user_id, work_date, clock_in)
      (e->>'user_id')::uuid AS user_id,
      (e->>'work_date')::date AS work_date,
      (e->>'clock_in')::time AS clock_in,
      NULLIF(e->>'clock_out', '')::time AS clock_out
    FROM jsonb_array_elements(p_entries) AS e
    -- A repeated pair keeps the one with a clock-out (deterministic re-import).
    ORDER BY user_id, work_date, clock_in, clock_out DESC NULLS LAST
  ),
  upserted AS (
    INSERT INTO public.time_entries (user_id, work_date, source_clock_in, clock_in, clock_out, source)
    SELECT user_id, work_date, clock_in, clock_in, clock_out, 'import' FROM incoming
    ON CONFLICT (user_id, work_date, source_clock_in) DO UPDATE
      SET clock_out = EXCLUDED.clock_out, source = 'import'
      WHERE public.time_entries.edited_at IS NULL
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT
    count(*) FILTER (WHERE is_insert),
    count(*) FILTER (WHERE NOT is_insert)
  INTO v_inserted, v_updated
  FROM upserted;

  SELECT count(*) INTO v_total
  FROM (
    SELECT DISTINCT (e->>'user_id'), (e->>'work_date'), (e->>'clock_in')
    FROM jsonb_array_elements(p_entries) AS e
  ) d;

  INSERT INTO public.time_imports
    (period_start, period_end, file_name, inserted, updated, skipped_edited, imported_by)
  VALUES
    (p_period_start, p_period_end, p_file_name, v_inserted, v_updated,
     v_total - v_inserted - v_updated, (SELECT auth.uid()))
  RETURNING id INTO v_import_id;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped_edited', v_total - v_inserted - v_updated
  );
END;
$$;

-- Sin anon a propósito: primeras tablas con permiso por persona; nada público las lee.
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT SELECT, INSERT ON public.time_imports TO authenticated;
GRANT ALL ON public.profiles, public.time_entries, public.time_imports TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_time_entries(jsonb, date, date, text) TO authenticated, service_role;
