-- ============================================================================
-- replace_urrea_catalog (#157): the catalog "replace" import deletes and inserts in ONE transaction, so a
-- file that fails leaves the catalog as it was. INVOKER (RLS applies to the caller), no anon.
-- Additive and idempotent: the baseline has it too.
-- ============================================================================

-- Rows arrive validated and normalized (src/lib/urrea-catalog-store.ts); normalizing again keeps the
-- invariant for a direct call. Errors: P0001 empty_catalog | empty_code; 23505 a repeated (code, brand).
CREATE OR REPLACE FUNCTION public.replace_urrea_catalog(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer;
BEGIN
  -- An empty file must never empty the catalog.
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR p_rows = '[]'::jsonb THEN
    RAISE EXCEPTION 'empty_catalog';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(code text)
    WHERE btrim(coalesce(r.code, '')) = ''
  ) THEN
    RAISE EXCEPTION 'empty_code';
  END IF;

  -- Serializes concurrent replaces and edits; plain reads keep seeing the old catalog until commit.
  LOCK TABLE public.urrea_catalog IN EXCLUSIVE MODE;

  -- WHERE true: pg_safeupdate rejects a DELETE without a WHERE clause.
  DELETE FROM public.urrea_catalog WHERE true;

  INSERT INTO public.urrea_catalog (code, brand, description, std)
  SELECT upper(btrim(r.code)),
         coalesce(nullif(upper(btrim(r.brand)), ''), 'URREA'),
         nullif(btrim(r.description), ''),
         coalesce(r.std, 1)
  FROM jsonb_to_recordset(p_rows) AS r(code text, brand text, description text, std integer);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_urrea_catalog(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_urrea_catalog(jsonb) TO authenticated;
