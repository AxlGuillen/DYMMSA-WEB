-- ============================================================================
-- atomic_order_stock (#157): order stock moves inside the DB under a row lock, not read → write an
-- absolute from the route. INVOKER (RLS applies to the caller), no anon. Idempotent: the baseline has it.
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
    -- Same lock order in every call: two concurrent orders never deadlock.
    ORDER BY 1
  LOOP
    CONTINUE WHEN v_line.quantity <= 0;

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

-- Status change and restock in one transaction, guarded by the status the caller read:
-- a retry or a concurrent change gets false and restores nothing.
CREATE OR REPLACE FUNCTION public.cancel_order_restock(p_order_id uuid, p_expected_status text, p_lines jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.orders SET status = 'cancelled'
  WHERE id = p_order_id AND status = p_expected_status AND status <> 'cancelled';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public.release_inventory(p_lines);
  RETURN true;
END;
$$;

-- Same guard as cancel_order_restock; items, cut plan and decisions go by CASCADE.
CREATE OR REPLACE FUNCTION public.delete_order_restock(p_order_id uuid, p_expected_status text, p_lines jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.orders WHERE id = p_order_id AND status = p_expected_status;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public.release_inventory(p_lines);
  RETURN true;
END;
$$;

-- FOR SHARE keeps the order in the status read (it cannot turn delivered halfway).
CREATE OR REPLACE FUNCTION public.remove_order_item_restock(
  p_order_id uuid,
  p_item_id uuid,
  p_expected_status text,
  p_lines jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND status = p_expected_status FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.order_items WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public.release_inventory(p_lines);
  RETURN true;
END;
$$;

-- authenticated only: PUBLIC and anon lose their default EXECUTE.
REVOKE ALL ON FUNCTION public.reserve_inventory(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_inventory(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_inventory(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order_restock(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_order_restock(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_order_item_restock(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_inventory(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_restock(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_order_restock(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_restock(uuid, uuid, text, jsonb) TO authenticated;
