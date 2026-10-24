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
  currency text DEFAULT 'MXN'::text NOT NULL,
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
-- NOT VALID (#157, atomic_quotation_writes): checks new and updated rows only, the history stays as it is.
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_delivery_time_check CHECK ((delivery_time = ANY (ARRAY['immediate'::text, '2_3_days'::text, '3_5_days'::text, '1_week'::text, '2_weeks'::text, 'indefinite'::text]))) NOT VALID;
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_item_type_check CHECK ((item_type = ANY (ARRAY['product'::text, 'separator'::text]))) NOT VALID;

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
ALTER TABLE payables ADD CONSTRAINT payables_currency_check CHECK ((currency = ANY (ARRAY['MXN'::text, 'USD'::text])));
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
-- At most one order per quotation (ADR-010); manual orders keep quotation_id NULL.
CREATE UNIQUE INDEX orders_quotation_id_unique ON public.orders USING btree (quotation_id) WHERE (quotation_id IS NOT NULL);
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

-- ─── Cotizaciones atómicas (#157, migración atomic_quotation_writes) ───────
-- Edición y aprobación pública bajo el lock de la fila de la cotización. INVOKER, sin anon.
-- Edit: header + lines in one transaction. Lines keep their id (updated in place by "id"); the ones left
-- out are deleted; the ones without an id, or with an id of no line here, are inserted with a fresh id.
-- sort_order = position in p_items. Errors: P0001 quotation_not_found | quotation_not_editable | duplicate_item.
CREATE OR REPLACE FUNCTION public.update_quotation(p_quotation_id uuid, p_header jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_deleted integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  SELECT q.status INTO v_status FROM public.quotations q WHERE q.id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation_not_found';
  END IF;
  IF v_status NOT IN ('draft', 'sent_for_approval', 'approved') THEN
    RAISE EXCEPTION 'quotation_not_editable';
  END IF;
  IF (SELECT count(e->>'id') <> count(DISTINCT e->>'id') FROM jsonb_array_elements(v_items) AS e) THEN
    RAISE EXCEPTION 'duplicate_item';
  END IF;

  UPDATE public.quotations
  SET name = p_header->>'name',
      customer_name = p_header->>'customer_name',
      total_amount = (p_header->>'total_amount')::numeric
  WHERE id = p_quotation_id;

  DELETE FROM public.quotation_items qi
  WHERE qi.quotation_id = p_quotation_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) AS e WHERE (e->>'id')::uuid = qi.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.quotation_items qi
  SET item_type = l.j->>'item_type',
      section_label = l.j->>'section_label',
      separator_color = l.j->>'separator_color',
      etm = l.j->>'etm',
      description = l.j->>'description',
      description_es = l.j->>'description_es',
      dymmsa_description = l.j->>'dymmsa_description',
      model_code = l.j->>'model_code',
      brand = l.j->>'brand',
      unit_price = (l.j->>'unit_price')::numeric,
      quantity = (l.j->>'quantity')::integer,
      delivery_time = l.j->>'delivery_time',
      is_sold = (l.j->>'is_sold')::boolean,
      -- Under review the decision is the client's: an editor opened before it saved never resets it (#157).
      is_approved = CASE
        WHEN l.j->>'item_type' = 'separator' THEN NULL
        WHEN v_status = 'sent_for_approval' THEN qi.is_approved
        ELSE (l.j->>'is_approved')::boolean
      END,
      sort_order = l.pos
  FROM (
    SELECT t.j, (t.ord - 1)::integer AS pos
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(j, ord)
  ) AS l
  WHERE qi.quotation_id = p_quotation_id AND qi.id = (l.j->>'id')::uuid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.quotation_items (
    quotation_id, item_type, section_label, separator_color, etm, description, description_es,
    dymmsa_description, model_code, brand, unit_price, quantity, delivery_time, is_approved, is_sold, sort_order
  )
  SELECT
    p_quotation_id, t.j->>'item_type', t.j->>'section_label', t.j->>'separator_color', t.j->>'etm',
    t.j->>'description', t.j->>'description_es', t.j->>'dymmsa_description', t.j->>'model_code', t.j->>'brand',
    (t.j->>'unit_price')::numeric, (t.j->>'quantity')::integer, t.j->>'delivery_time',
    CASE WHEN t.j->>'item_type' = 'separator' THEN NULL ELSE (t.j->>'is_approved')::boolean END,
    (t.j->>'is_sold')::boolean, (t.ord - 1)::integer
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(j, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.quotation_items qi
    WHERE qi.quotation_id = p_quotation_id AND qi.id = (t.j->>'id')::uuid
  )
  ORDER BY t.ord;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'deleted', v_deleted);
END;
$$;

-- Public approval (/approve/[token]): every id must still be an approvable line of this quotation, or nothing
-- is written. finalize=false saves progress (rest → NULL); finalize=true sends (rest → false, status moves).
-- approved_at keeps the FIRST approval: sealed once, never moved or cleared (#157 decision 2026-10-24).
-- Errors: P0001 quotation_not_found | quotation_processed | stale_items.
CREATE OR REPLACE FUNCTION public.submit_quotation_approval(p_token uuid, p_approved_ids jsonb, p_finalize boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_ids uuid[];
  v_approved integer;
  v_new_status text;
BEGIN
  SELECT q.id, q.status INTO v_id, v_status FROM public.quotations q WHERE q.approval_token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation_not_found';
  END IF;
  IF v_status <> 'sent_for_approval' THEN
    RAISE EXCEPTION 'quotation_processed';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_approved_ids, '[]'::jsonb)) AS x);

  SELECT count(*)::integer INTO v_approved
  FROM public.quotation_items qi
  WHERE qi.quotation_id = v_id AND qi.id = ANY (v_ids)
    AND qi.item_type = 'product' AND qi.is_sold IS DISTINCT FROM false;
  IF v_approved <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'stale_items';
  END IF;

  UPDATE public.quotation_items qi
  SET is_approved = CASE WHEN qi.id = ANY (v_ids) THEN true WHEN p_finalize THEN false ELSE NULL END
  WHERE qi.quotation_id = v_id AND qi.item_type = 'product' AND qi.is_sold IS DISTINCT FROM false;

  IF NOT coalesce(p_finalize, false) THEN
    RETURN jsonb_build_object('quotation_id', v_id, 'finalized', false, 'status', v_status, 'approved_count', v_approved);
  END IF;

  v_new_status := CASE WHEN v_approved > 0 THEN 'approved' ELSE 'rejected' END;
  UPDATE public.quotations
  SET status = v_new_status,
      approved_at = CASE WHEN v_new_status = 'approved' THEN coalesce(approved_at, now()) ELSE approved_at END
  WHERE id = v_id;

  RETURN jsonb_build_object('quotation_id', v_id, 'finalized', true, 'status', v_new_status, 'approved_count', v_approved);
END;
$$;

-- update_quotation: authenticated only. submit_quotation_approval: only the public route's service role,
-- so a session can never answer as the client.
REVOKE ALL ON FUNCTION public.update_quotation(uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_quotation_approval(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_quotation(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quotation_approval(uuid, jsonb, boolean) TO service_role;

-- ─── Storage ────────────────────────────────────────────────────────────────
-- bucket task-images · public=true · límite 5 MB · PNG/JPEG/GIF/WEBP
-- (creado por la migración create_task_images_bucket, ADR-014)
-- bucket avatars · public=true · límite 2 MB · JPEG/PNG/WEBP (#122) · policies: solo la carpeta `<uid>/` propia

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
  shift text CHECK (shift IN ('full_time', 'part_time')),  -- jornada (#101): NULL = sin asignar
  nss text CHECK (nss ~ '^[0-9]{11}$'),
  avatar_path text,
  is_owner boolean NOT NULL DEFAULT false,
  area text NOT NULL DEFAULT 'office' CHECK (area IN ('office', 'workshop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_avatar_own_folder CHECK (avatar_path IS NULL OR avatar_path LIKE id::text || '/%'),
  CONSTRAINT profiles_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80)
);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE UNIQUE INDEX profiles_single_owner ON public.profiles (is_owner) WHERE is_owner;

-- RLS cannot restrict columns (#122): without this a member could promote themself via their own row.
CREATE OR REPLACE FUNCTION public.guard_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_admin() AND (
    NEW.role IS DISTINCT FROM OLD.role
    OR NEW.clock_employee_id IS DISTINCT FROM OLD.clock_employee_id
    OR NEW.shift IS DISTINCT FROM OLD.shift
    OR NEW.is_owner IS DISTINCT FROM OLD.is_owner
    OR NEW.area IS DISTINCT FROM OLD.area
  ) THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el rol, la jornada, el área, el id del checador o el dueño'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_guard_admin_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_admin_fields();

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
    -- Trimmed and capped: a blank or long metadata name must not trip profiles_display_name_length.
    left(COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(btrim(split_part(COALESCE(NEW.email, ''), '@', 1)), ''),
      NEW.id::text
    ), 80)
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
-- Own row or admin: the MCP reads with the user's token, so USING (true) bypassed requireAdmin (PR #99).
CREATE POLICY "Users read own profile, admins read all" ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "Admins can update profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

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
CREATE POLICY "Admins read imports" ON public.time_imports
  FOR SELECT TO authenticated USING (public.is_admin());
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
    -- Casted like the incoming CTE: '8:05' and '08:05' are one pair.
    SELECT DISTINCT (e->>'user_id')::uuid, (e->>'work_date')::date, (e->>'clock_in')::time
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

-- excused_days (meeting 2026-10-01): holidays and authorized early exits; user_id NULL = whole team.
CREATE TABLE public.excused_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,  -- CASCADE a propósito: es una marca sobre la persona, no un registro suyo (time_entries sigue bloqueando la baja)
  kind text NOT NULL CHECK (kind IN ('holiday', 'early_release')),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT excused_days_unique UNIQUE NULLS NOT DISTINCT (work_date, user_id)
);
CREATE INDEX excused_days_work_date ON public.excused_days (work_date);
ALTER TABLE public.excused_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team-wide or own excused days, admins all" ON public.excused_days
  FOR SELECT TO authenticated USING (user_id IS NULL OR user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "Admins add excused days" ON public.excused_days
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete excused days" ON public.excused_days
  FOR DELETE TO authenticated USING (public.is_admin());
-- UPDATE llegó con save_excused_day (review PR #138): cambiar feriado ↔ salida autorizada en su lugar.
CREATE POLICY "Admins update excused days" ON public.excused_days
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.excused_days TO authenticated;
GRANT ALL ON public.excused_days TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_time_entries(jsonb, date, date, text) TO authenticated, service_role;

-- ============================================================================
-- Bitácora genérica (issue #100, ADR-028): quién cambió qué y cuándo.
-- Tabla aparte y NO columnas en la entidad: solo el admin la lee (RLS), y un
-- member no puede ni saber que existe leyendo payables por PostgREST.
-- Escribe únicamente el trigger (DEFINER); la app no tiene INSERT.
-- ============================================================================
CREATE TABLE public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,                  -- 'payable' hoy; otras entidades después
  entity_id uuid NOT NULL,
  action text NOT NULL,                       -- created | status_changed | paid_at_changed | deleted
  actor_id uuid,                              -- sin FK: un INSERT de bitácora jamás tumba la escritura del usuario
  actor_name text,                            -- snapshot del display_name de ese día
  data jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { from, to } o el snapshot de la fila
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_entity ON public.audit_events (entity_type, entity_id, created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (public.is_admin());
-- Sin policy de escritura para authenticated a propósito.

-- DEFINER: inserta saltando la RLS de audit_events y lee profiles como owner
-- para el snapshot del nombre. auth.uid() es NULL con service_role.
CREATE OR REPLACE FUNCTION public.audit_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_name text;
  v_action text;
  v_data jsonb;
BEGIN
  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_actor;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_data := jsonb_build_object(
      'concept', NEW.concept, 'amount', NEW.amount,
      'supplier_id', NEW.supplier_id, 'status', NEW.status
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_data := jsonb_build_object(
      'concept', OLD.concept, 'amount', OLD.amount,
      'supplier_id', OLD.supplier_id, 'status', OLD.status, 'paid_at', OLD.paid_at
    );
  ELSE
    IF OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.paid_at IS NOT DISTINCT FROM NEW.paid_at THEN
      RETURN NEW;  -- concept/amount/notes edits are not audited (yet)
    END IF;
    v_action := CASE WHEN OLD.status IS DISTINCT FROM NEW.status
                     THEN 'status_changed' ELSE 'paid_at_changed' END;
    v_data := jsonb_build_object(
      'from', jsonb_build_object('status', OLD.status, 'paid_at', OLD.paid_at),
      'to',   jsonb_build_object('status', NEW.status, 'paid_at', NEW.paid_at)
    );
  END IF;

  INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
  VALUES ('payable', COALESCE(NEW.id, OLD.id), v_action, v_actor, v_name, v_data);

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_payable() FROM PUBLIC;

CREATE TRIGGER payables_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.audit_payable();

-- Sin anon; sin INSERT para authenticated: solo el trigger escribe.
GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO service_role;

-- ============================================================================
-- Nómina (issue #123, ADR-033): horas por empleado y día, corte sábado → viernes.
-- Solo admin de punta a punta; los trabajadores del taller no tienen cuenta.
-- ============================================================================
CREATE TABLE public.payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,  -- oficina: prellenado desde Horas
  shift text NOT NULL DEFAULT 'full_time',    -- tope de horas normales L-V (8 h / 4 h)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_employees_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT payroll_employees_shift_check CHECK (shift IN ('full_time', 'part_time'))
);
CREATE TRIGGER payroll_employees_set_updated_at BEFORE UPDATE ON public.payroll_employees
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- payroll_days: una fila por empleado y día. El multiplicador (sábado ×2, domingo ×3)
-- NO se guarda: sale de la fecha en src/lib/payroll.ts.
CREATE TABLE public.payroll_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.payroll_employees(id),  -- sin cascade: la baja es desactivar
  work_date date NOT NULL,
  worked_minutes integer NOT NULL DEFAULT 0,
  missed_minutes integer NOT NULL DEFAULT 0,  -- HRS NO TRABAJADAS: solo registro
  note text,
  source text NOT NULL DEFAULT 'manual',      -- sheet (MCP) | hours (prellenado) | manual
  status text NOT NULL DEFAULT 'draft',       -- draft | confirmed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_days_employee_date_key UNIQUE (employee_id, work_date),
  CONSTRAINT payroll_days_worked_check CHECK (worked_minutes BETWEEN 0 AND 1440),
  CONSTRAINT payroll_days_missed_check CHECK (missed_minutes BETWEEN 0 AND 1440),
  CONSTRAINT payroll_days_source_check CHECK (source IN ('sheet', 'hours', 'manual')),
  CONSTRAINT payroll_days_status_check CHECK (status IN ('draft', 'confirmed'))
);
CREATE INDEX idx_payroll_days_date ON public.payroll_days (work_date);
CREATE TRIGGER payroll_days_set_updated_at BEFORE UPDATE ON public.payroll_days
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- payroll_periods: el corte, identificado por su sábado. Sin fila = abierto.
CREATE TABLE public.payroll_periods (
  start_date date PRIMARY KEY,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by_name text,                        -- snapshot, como audit_events.actor_name
  reopened_at timestamptz,
  reopened_by_name text,
  CONSTRAINT payroll_periods_saturday CHECK (EXTRACT(ISODOW FROM start_date) = 6),
  CONSTRAINT payroll_periods_status_check CHECK (status IN ('open', 'closed'))
);

-- Un corte cerrado no cambia: ni por la app, ni por el MCP, ni con service_role.
CREATE OR REPLACE FUNCTION public.guard_closed_payroll_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_date date;
BEGIN
  FOREACH v_date IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.work_date END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.work_date END
  ] LOOP
    IF v_date IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payroll_periods p
      WHERE p.status = 'closed'
        AND p.start_date = v_date - ((EXTRACT(ISODOW FROM v_date)::int + 1) % 7)
    ) THEN
      RAISE EXCEPTION 'El corte de nómina que incluye el % está cerrado', v_date
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER payroll_days_guard_closed BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_days
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_payroll_period();

ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage payroll employees" ON public.payroll_employees
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins manage payroll days" ON public.payroll_days
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins manage payroll periods" ON public.payroll_periods
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Sin anon, como el resto de las tablas por rol.
REVOKE ALL ON public.payroll_employees, public.payroll_days, public.payroll_periods FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_employees, public.payroll_days, public.payroll_periods TO authenticated;
GRANT ALL ON public.payroll_employees, public.payroll_days, public.payroll_periods TO service_role;

-- ============================================================================
-- Tarifa por hora (review PR #137): la policy de fila propia de profiles dejaba a un member leer
-- su hourly_rate por PostgREST. Vive aparte, solo admin — mismo precedente que audit_events (ADR-028).
-- Sin fila = sin tarifa (sin pago estimado).
-- ============================================================================
CREATE TABLE public.profile_pay (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_rate numeric(10,2) NOT NULL CHECK (hourly_rate > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profile_pay_set_updated_at BEFORE UPDATE ON public.profile_pay
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

ALTER TABLE public.profile_pay ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage profile pay" ON public.profile_pay
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.profile_pay FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_pay TO authenticated;
GRANT ALL ON public.profile_pay TO service_role;

-- ============================================================================
-- Atomic order stock (#157, migration atomic_order_stock): store_inventory moves by model_code under a
-- row lock; add/remove a line, cancel, delete and reception write and move stock in one transaction. INVOKER, no anon.
-- ============================================================================
-- Reserve: least(stock, asked) per model_code under FOR UPDATE; repeated codes are summed first.
CREATE OR REPLACE FUNCTION public.reserve_inventory(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_line record;
  v_stock integer;
  v_location text;
  v_taken integer;
  v_result jsonb := '[]'::jsonb;
BEGIN
  FOR v_line IN
    SELECT l->>'model_code' AS model_code, sum((l->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) AS l
    WHERE btrim(coalesce(l->>'model_code', '')) <> ''
    GROUP BY 1
    ORDER BY 1
  LOOP
    -- least() skips NULLs: a missing quantity must reserve nothing, not the whole stock.
    CONTINUE WHEN coalesce(v_line.quantity, 0) <= 0;

    SELECT i.quantity, i.location INTO v_stock, v_location
    FROM public.store_inventory i
    WHERE i.model_code = v_line.model_code
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := v_result || jsonb_build_object('model_code', v_line.model_code, 'reserved', 0, 'location', NULL);
      CONTINUE;
    END IF;

    v_taken := least(greatest(v_stock, 0), v_line.quantity);
    IF v_taken > 0 THEN
      UPDATE public.store_inventory SET quantity = quantity - v_taken WHERE model_code = v_line.model_code;
    END IF;
    v_result := v_result || jsonb_build_object('model_code', v_line.model_code, 'reserved', v_taken, 'location', v_location);
  END LOOP;

  RETURN v_result;
END;
$$;

-- Release: adds back per model_code and creates a missing row, as cancelling always did.
CREATE OR REPLACE FUNCTION public.release_inventory(p_lines jsonb)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH incoming AS (
    SELECT l->>'model_code' AS model_code, sum((l->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) AS l
    WHERE btrim(coalesce(l->>'model_code', '')) <> ''
    GROUP BY 1
  ),
  upserted AS (
    INSERT INTO public.store_inventory AS s (model_code, quantity)
    SELECT model_code, quantity FROM incoming WHERE quantity > 0 ORDER BY model_code
    ON CONFLICT (model_code) DO UPDATE SET quantity = s.quantity + EXCLUDED.quantity
    RETURNING 1
  )
  SELECT count(*)::integer FROM upserted;
$$;

-- Reception delta (ADR-019): positive adds (creating the row), negative is clamped at 0 and reported.
CREATE OR REPLACE FUNCTION public.adjust_inventory(p_model_code text, p_delta integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_stock integer;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 OR btrim(coalesce(p_model_code, '')) = '' THEN
    RETURN jsonb_build_object('quantity', NULL, 'clamped', false, 'missing', false);
  END IF;

  IF p_delta > 0 THEN
    INSERT INTO public.store_inventory AS s (model_code, quantity)
    VALUES (p_model_code, p_delta)
    ON CONFLICT (model_code) DO UPDATE SET quantity = s.quantity + EXCLUDED.quantity
    RETURNING s.quantity INTO v_stock;
    RETURN jsonb_build_object('quantity', v_stock, 'clamped', false, 'missing', false);
  END IF;

  SELECT i.quantity INTO v_stock
  FROM public.store_inventory i
  WHERE i.model_code = p_model_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('quantity', NULL, 'clamped', false, 'missing', true);
  END IF;

  UPDATE public.store_inventory SET quantity = greatest(0, v_stock + p_delta) WHERE model_code = p_model_code;
  RETURN jsonb_build_object('quantity', greatest(0, v_stock + p_delta), 'clamped', v_stock + p_delta < 0, 'missing', false);
END;
$$;

-- What a cancel/delete gives back, read under the caller's order lock so a concurrent line change is seen.
CREATE OR REPLACE FUNCTION public.order_restock_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- Mirrors computeRestoration() in src/lib/inventory.ts: in_stock + min(received, ordered) (ADR-019).
  SELECT coalesce(jsonb_agg(jsonb_build_object('model_code', t.model_code, 'quantity', t.quantity) ORDER BY t.model_code), '[]'::jsonb)
  FROM (
    SELECT oi.model_code, sum(oi.quantity_in_stock + least(oi.quantity_received, oi.quantity_to_order))::integer AS quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.item_type <> 'separator'
      AND btrim(coalesce(oi.model_code, '')) <> ''
    GROUP BY oi.model_code
  ) t
  WHERE t.quantity > 0;
$$;

-- Cancel: status and restock in one transaction, only if the order is still in the status read.
-- Returns the codes restocked; NULL = it already changed (retry, double click) and nothing moved.
CREATE OR REPLACE FUNCTION public.cancel_order_restock(p_order_id uuid, p_expected_status text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.orders SET status = 'cancelled'
  WHERE id = p_order_id AND status = p_expected_status AND status <> 'cancelled';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.release_inventory(public.order_restock_lines(p_order_id));
END;
$$;

-- Delete: same guard; p_restock comes from deleteRestoresStock(). Items, cut plan and decisions go by CASCADE.
CREATE OR REPLACE FUNCTION public.delete_order_restock(p_order_id uuid, p_expected_status text, p_restock boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lines jsonb := '[]'::jsonb;
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND status = p_expected_status FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p_restock THEN
    v_lines := public.order_restock_lines(p_order_id);
  END IF;
  DELETE FROM public.orders WHERE id = p_order_id;
  RETURN public.release_inventory(v_lines);
END;
$$;

-- Remove a line: FOR SHARE keeps the order in the status read (it cannot turn delivered halfway).
-- Gives back only what the line took from stock, read from the deleted row itself.
CREATE OR REPLACE FUNCTION public.remove_order_item_restock(p_order_id uuid, p_item_id uuid, p_expected_status text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_model_code text;
  v_in_stock integer;
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND status = p_expected_status FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.order_items
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING model_code, quantity_in_stock INTO v_model_code, v_in_stock;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.release_inventory(jsonb_build_array(jsonb_build_object('model_code', v_model_code, 'quantity', v_in_stock)));
END;
$$;

-- Add a line: the order lock keeps a concurrent cancel from missing it, so its stock always comes back.
-- Errors: P0001 with message order_not_found | order_closed | order_delivered, and nothing is reserved.
CREATE OR REPLACE FUNCTION public.add_order_item(p_order_id uuid, p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_qty integer := (p_item->>'quantity_approved')::integer;
  v_code text := coalesce(p_item->>'model_code', '');
  v_reserved integer := 0;
  v_sort integer;
  v_row public.order_items;
BEGIN
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  -- Mirrors isOrderClosed() / goodsInStore() in src/lib/inventory.ts: change them in pairs.
  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'order_closed';
  END IF;
  IF v_status NOT IN ('ordered', 'received') THEN
    RAISE EXCEPTION 'order_delivered';
  END IF;

  IF btrim(v_code) <> '' THEN
    v_reserved := coalesce((public.reserve_inventory(
      jsonb_build_array(jsonb_build_object('model_code', v_code, 'quantity', v_qty))
    )->0->>'reserved')::integer, 0);
  END IF;

  SELECT coalesce(max(oi.sort_order), -1) + 1 INTO v_sort FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- Same split as allocateLines() in src/lib/business-rules.ts: stock first, the rest is ordered from URREA.
  INSERT INTO public.order_items (
    order_id, sort_order, item_type, etm, model_code, description, brand,
    quantity_approved, quantity_in_stock, quantity_to_order, quantity_received, urrea_status, unit_price
  ) VALUES (
    p_order_id, v_sort, 'product', coalesce(p_item->>'etm', ''), v_code, coalesce(p_item->>'description', ''),
    coalesce(p_item->>'brand', ''), v_qty, v_reserved, v_qty - v_reserved, 0, 'pending', (p_item->>'unit_price')::numeric
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- Reception in one transaction (ADR-019): lines and their excess delta commit together, so a failed
-- inventory write never leaves a received quantity whose excess a retry would read as delta 0.
-- Errors: P0001 with message order_not_found | order_closed | duplicate_item | item_not_in_order |
-- item_not_ordered (DETAIL = the line's tag), and nothing is written.
CREATE OR REPLACE FUNCTION public.receive_order_items(p_order_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_line record;
  v_delta integer;
  v_adjust jsonb;
  v_updated integer := 0;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  -- Mirrors isOrderClosed() in src/lib/inventory.ts; delivered passes on purpose (reception stays open).
  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'order_closed';
  END IF;

  IF (SELECT count(DISTINCT e->>'id') <> count(*) FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) AS e) THEN
    RAISE EXCEPTION 'duplicate_item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_items oi WHERE oi.id = (e->>'id')::uuid AND oi.order_id = p_order_id
    )
  ) THEN
    RAISE EXCEPTION 'item_not_in_order';
  END IF;

  FOR v_line IN
    SELECT oi.id, oi.model_code, oi.item_type, oi.quantity_to_order,
           oi.quantity_received AS old_received,
           (e->>'quantity_received')::integer AS new_received,
           e->>'urrea_status' AS urrea_status,
           coalesce(nullif(oi.etm, ''), nullif(oi.model_code, ''), oi.id::text) AS tag
    FROM jsonb_array_elements(p_items) AS e
    JOIN public.order_items oi ON oi.id = (e->>'id')::uuid AND oi.order_id = p_order_id
    ORDER BY oi.model_code, oi.id
    FOR UPDATE OF oi
  LOOP
    CONTINUE WHEN v_line.item_type = 'separator';
    IF v_line.quantity_to_order <= 0 THEN
      RAISE EXCEPTION 'item_not_ordered' USING DETAIL = v_line.tag;
    END IF;

    UPDATE public.order_items
    SET quantity_received = v_line.new_received, urrea_status = v_line.urrea_status
    WHERE id = v_line.id;

    -- Mirrors receptionExcess() in src/lib/business-rules.ts: only the excess over what was ordered moves.
    v_delta := greatest(0, v_line.new_received - v_line.quantity_to_order)
             - greatest(0, v_line.old_received - v_line.quantity_to_order);
    CONTINUE WHEN v_delta = 0 OR btrim(coalesce(v_line.model_code, '')) = '';

    v_adjust := public.adjust_inventory(v_line.model_code, v_delta);
    IF (v_adjust->>'missing')::boolean THEN
      v_warnings := v_warnings || jsonb_build_object('tag', v_line.tag, 'model_code', v_line.model_code, 'kind', 'missing');
      CONTINUE;
    END IF;
    IF (v_adjust->>'clamped')::boolean THEN
      v_warnings := v_warnings || jsonb_build_object('tag', v_line.tag, 'model_code', v_line.model_code, 'kind', 'clamped');
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('inventory_updated', v_updated, 'warnings', v_warnings);
END;
$$;

-- authenticated only: PUBLIC and anon lose their default EXECUTE.
REVOKE ALL ON FUNCTION public.reserve_inventory(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_inventory(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_inventory(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_restock_lines(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order_restock(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_order_restock(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_order_item_restock(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_order_item(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_order_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_inventory(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_restock_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_restock(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_order_restock(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_restock(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_order_item(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_order_items(uuid, jsonb) TO authenticated;
