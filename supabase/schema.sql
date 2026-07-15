-- ============================================================================
-- DYMMSA — Snapshot del schema de Supabase (proyecto wjlklwtvjewhtghlskbt)
-- Generado desde la BD real el 2026-07-13 vía MCP de Supabase (pg_catalog);
-- regenerado el 2026-07-15 tras la migración create_purchase_planner_tables.
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

ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE orders ADD CONSTRAINT orders_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES quotations(id);
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['ordered'::text, 'received'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE orders ADD CONSTRAINT orders_total_amount_check CHECK ((total_amount >= (0)::numeric));

ALTER TABLE order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
-- El invariante crítico del CLAUDE.md, encodado en BD:
ALTER TABLE order_items ADD CONSTRAINT check_quantity_sum CHECK (((quantity_in_stock + quantity_to_order) = quantity_approved));
ALTER TABLE order_items ADD CONSTRAINT check_received_not_exceed_ordered CHECK ((quantity_received <= quantity_to_order));
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_approved_check CHECK (((quantity_approved > 0) OR (item_type = 'separator'::text)));
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

-- ─── Índices (adicionales a los de constraints) ─────────────────────────────

CREATE INDEX idx_etm_products_etm ON public.etm_products USING btree (etm);
CREATE INDEX idx_etm_products_marca ON public.etm_products USING btree (brand);
CREATE INDEX idx_etm_products_modelo ON public.etm_products USING btree (model_code);
CREATE INDEX idx_order_items_etm ON public.order_items USING btree (etm);
CREATE INDEX idx_order_items_model_code ON public.order_items USING btree (model_code);
CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX idx_order_items_urrea_status ON public.order_items USING btree (urrea_status);
CREATE INDEX idx_order_purchase_decisions_order_id ON public.order_purchase_decisions USING btree (order_id);
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

-- ─── Storage ────────────────────────────────────────────────────────────────
-- bucket task-images · public=true · límite 5 MB · PNG/JPEG/GIF/WEBP
-- (creado por la migración create_task_images_bucket, ADR-014)
