-- ============================================================================
-- atomic_order_stock (#157): order stock moves inside the DB under a row lock, not read → write an
-- absolute from the route. INVOKER (RLS applies to the caller), no anon. Idempotent: the baseline has it.
-- Lock order everywhere: the order row first, then store_inventory rows by model_code.
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
