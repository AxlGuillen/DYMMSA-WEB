-- ============================================================================
-- Manual stock changes with a trail (#155 D, decision 7 of the plan): the assistant's counts and adjustments go
-- through ONE function that states why, and a trigger turns that into an audit_events row. Orders keep moving
-- stock exactly as before and leave no noise: the trigger acts only when the function raised the flag in its own
-- transaction. BEHAVIOR CHANGE (a new trigger on store_inventory), so it is applied only with the owner's OK.
-- ============================================================================

-- Mode count: the physical stock becomes p_value ONLY if it still is p_expected (compare and set, one UPDATE),
-- so an order created between the summary and the yes cannot be overwritten. Mode delta: adjust_inventory under
-- its own lock (creates the row for a positive delta, clamps at 0 and says so).
-- Errors: P0001 empty_code | reason_required | bad_mode | value_required | expected_required | negative_count.
CREATE OR REPLACE FUNCTION public.change_store_stock(
  p_model_code text,
  p_mode text,
  p_value integer,
  p_expected integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_quantity integer;
  v_adjust jsonb;
  v_code text := btrim(p_model_code);
BEGIN
  IF btrim(coalesce(p_model_code, '')) = '' THEN
    RAISE EXCEPTION 'empty_code';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('count', 'delta') THEN
    RAISE EXCEPTION 'bad_mode';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'value_required';
  END IF;

  -- Transaction-local: the audit trigger reads both and nothing outlives this call.
  PERFORM set_config('app.stock_manual', 'on', true);
  PERFORM set_config('app.stock_reason', btrim(p_reason), true);

  IF p_mode = 'delta' THEN
    v_adjust := public.adjust_inventory(v_code, p_value);
    RETURN v_adjust;
  END IF;

  IF p_value < 0 THEN
    RAISE EXCEPTION 'negative_count';
  END IF;
  IF p_expected IS NULL THEN
    RAISE EXCEPTION 'expected_required';
  END IF;

  UPDATE public.store_inventory
  SET quantity = p_value
  WHERE model_code = v_code AND quantity = p_expected
  RETURNING quantity INTO v_quantity;

  IF NOT FOUND THEN
    -- Either the row is gone or its quantity moved after the summary: the caller asks for the summary again.
    RETURN jsonb_build_object(
      'quantity', NULL,
      'changed', false,
      'missing', NOT EXISTS (SELECT 1 FROM public.store_inventory WHERE model_code = v_code)
    );
  END IF;
  RETURN jsonb_build_object('quantity', v_quantity, 'changed', true, 'missing', false);
END;
$$;

-- DEFINER: writes audit_events skipping its RLS and reads profiles as owner (same pattern as audit_payable).
-- Separate INSERT statements per operation: OLD does not exist on an INSERT.
CREATE OR REPLACE FUNCTION public.audit_store_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_name text;
  v_reason text := current_setting('app.stock_reason', true);
BEGIN
  IF coalesce(current_setting('app.stock_manual', true), '') <> 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.quantity IS NOT DISTINCT FROM NEW.quantity THEN
      RETURN NEW;
    END IF;
    SELECT display_name INTO v_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
    VALUES ('inventory', NEW.id, 'quantity_changed', v_actor, v_name, jsonb_build_object(
      'model_code', NEW.model_code, 'from', OLD.quantity, 'to', NEW.quantity, 'reason', v_reason
    ));
  ELSE
    SELECT display_name INTO v_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
    VALUES ('inventory', NEW.id, 'created', v_actor, v_name, jsonb_build_object(
      'model_code', NEW.model_code, 'from', NULL, 'to', NEW.quantity, 'reason', v_reason
    ));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_store_stock() FROM PUBLIC;

DROP TRIGGER IF EXISTS store_inventory_audit ON public.store_inventory;
CREATE TRIGGER store_inventory_audit
  AFTER INSERT OR UPDATE OF quantity ON public.store_inventory
  FOR EACH ROW EXECUTE FUNCTION public.audit_store_stock();

REVOKE ALL ON FUNCTION public.change_store_stock(text, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_store_stock(text, text, integer, integer, text) TO authenticated;
