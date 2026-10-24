-- ============================================================================
-- atomic_quotation_writes (#157): the quotation edit and the public approval run inside the DB under the
-- quotation row lock, so they serialize and never see each other half-done. Additive and idempotent:
-- the baseline has it too. Lock order: the quotation row first, then its lines.
-- ============================================================================

-- Enum checks, forward-only: NOT VALID skips the historical rows (#157 decision 2026-10-24).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotation_items_delivery_time_check' AND conrelid = 'public.quotation_items'::regclass
  ) THEN
    ALTER TABLE public.quotation_items ADD CONSTRAINT quotation_items_delivery_time_check
      CHECK ((delivery_time = ANY (ARRAY['immediate'::text, '2_3_days'::text, '3_5_days'::text, '1_week'::text, '2_weeks'::text, 'indefinite'::text]))) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotation_items_item_type_check' AND conrelid = 'public.quotation_items'::regclass
  ) THEN
    ALTER TABLE public.quotation_items ADD CONSTRAINT quotation_items_item_type_check
      CHECK ((item_type = ANY (ARRAY['product'::text, 'separator'::text]))) NOT VALID;
  END IF;
END;
$$;

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
