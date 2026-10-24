-- ============================================================================
-- guards_audit_payroll_freeze (#157, «El resto»). Idempotent: the baseline has it.
--   1. audit_payable(): audits amount/currency (amount_changed) and keeps currency in its snapshots. [behavior change]
--   2. guard_profile_admin_fields(): is_owner only changes without a session (SQL / service role). [behavior change]
--   3. profiles_guard_last_admin: the last admin cannot be demoted or deleted, not even by SQL. [new trigger on profiles]
--   4. payroll_days.shift_snapshot / area_snapshot + close/reopen functions: a closed cut keeps its totals. [additive]
-- ============================================================================

-- 1. Payables audit trail (ADR-028): one row per kind of change; concept, dates, supplier and notes stay unaudited.
CREATE OR REPLACE FUNCTION public.audit_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_name text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.paid_at IS NOT DISTINCT FROM NEW.paid_at
     AND OLD.amount IS NOT DISTINCT FROM NEW.amount
     AND OLD.currency IS NOT DISTINCT FROM NEW.currency THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_actor;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
    VALUES ('payable', NEW.id, 'created', v_actor, v_name, jsonb_build_object(
      'concept', NEW.concept, 'amount', NEW.amount, 'currency', NEW.currency,
      'supplier_id', NEW.supplier_id, 'status', NEW.status
    ));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
    VALUES ('payable', OLD.id, 'deleted', v_actor, v_name, jsonb_build_object(
      'concept', OLD.concept, 'amount', OLD.amount, 'currency', OLD.currency,
      'supplier_id', OLD.supplier_id, 'status', OLD.status, 'paid_at', OLD.paid_at
    ));
  ELSE
    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.paid_at IS DISTINCT FROM NEW.paid_at THEN
      INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
      VALUES ('payable', NEW.id,
        CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status_changed' ELSE 'paid_at_changed' END,
        v_actor, v_name, jsonb_build_object(
          'from', jsonb_build_object('status', OLD.status, 'paid_at', OLD.paid_at),
          'to',   jsonb_build_object('status', NEW.status, 'paid_at', NEW.paid_at)
        ));
    END IF;
    IF OLD.amount IS DISTINCT FROM NEW.amount OR OLD.currency IS DISTINCT FROM NEW.currency THEN
      INSERT INTO public.audit_events (entity_type, entity_id, action, actor_id, actor_name, data)
      VALUES ('payable', NEW.id, 'amount_changed', v_actor, v_name, jsonb_build_object(
        'from', jsonb_build_object('amount', OLD.amount, 'currency', OLD.currency),
        'to',   jsonb_build_object('amount', NEW.amount, 'currency', NEW.currency)
      ));
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_payable() FROM PUBLIC;

-- 2. RLS cannot restrict columns (#122). is_owner has no write path: with a session (admin too) it never changes.
CREATE OR REPLACE FUNCTION public.guard_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NEW.is_owner IS DISTINCT FROM OLD.is_owner THEN
    RAISE EXCEPTION 'El dueño del negocio solo se cambia por SQL, no desde la app'
      USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_admin() AND (
    NEW.role IS DISTINCT FROM OLD.role
    OR NEW.clock_employee_id IS DISTINCT FROM OLD.clock_employee_id
    OR NEW.shift IS DISTINCT FROM OLD.shift
    OR NEW.area IS DISTINCT FROM OLD.area
  ) THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el rol, la jornada, el área o el id del checador'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. At least one admin, for every caller. The advisory lock serializes two demotions that would each see the other admin.
-- Text shared with LAST_ADMIN_MESSAGE in src/lib/profile.ts (the route maps the 23514 to a 400).
CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Deleting the row (also an auth user removed by cascade) counts as a demotion (review PR #171).
  IF OLD.role = 'admin' AND CASE WHEN TG_OP = 'DELETE' THEN true ELSE NEW.role IS DISTINCT FROM 'admin' END THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.profiles.last_admin'));
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.role = 'admin' AND p.id <> OLD.id) THEN
      RAISE EXCEPTION 'Debe quedar al menos un administrador'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_last_admin() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_guard_last_admin ON public.profiles;
CREATE TRIGGER profiles_guard_last_admin BEFORE UPDATE OF role OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();

-- 4. Payroll freeze (ADR-033): the rules a closed cut was paid with. NULL = open cut, live values.
ALTER TABLE public.payroll_days ADD COLUMN IF NOT EXISTS shift_snapshot text;
ALTER TABLE public.payroll_days ADD COLUMN IF NOT EXISTS area_snapshot text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_days_shift_snapshot_check') THEN
    ALTER TABLE public.payroll_days ADD CONSTRAINT payroll_days_shift_snapshot_check
      CHECK (shift_snapshot IS NULL OR shift_snapshot IN ('full_time', 'part_time'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_days_area_snapshot_check') THEN
    ALTER TABLE public.payroll_days ADD CONSTRAINT payroll_days_area_snapshot_check
      CHECK (area_snapshot IS NULL OR area_snapshot IN ('office', 'workshop'));
  END IF;
END;
$$;

-- Close: snapshot first, flip the status last, in one transaction: the guard trigger refuses any
-- write to a closed cut. Errors: P0001 not_period_start | drafts_pending (DETAIL = count).
-- An already closed cut is returned as is: its first stamp and its snapshot stay.
CREATE OR REPLACE FUNCTION public.close_payroll_period(p_start date, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_period public.payroll_periods;
  v_drafts integer;
BEGIN
  IF p_start IS NULL OR EXTRACT(ISODOW FROM p_start) <> 6 THEN
    RAISE EXCEPTION 'not_period_start';
  END IF;
  -- The period row is the lock. The no-op DO UPDATE locks and returns it even when a concurrent close
  -- created it first; DO NOTHING + SELECT could come back empty (review PR #171).
  INSERT INTO public.payroll_periods AS pp (start_date, status) VALUES (p_start, 'open')
  ON CONFLICT (start_date) DO UPDATE SET status = pp.status
  RETURNING * INTO v_period;
  IF v_period.status = 'closed' THEN
    RETURN to_jsonb(v_period);
  END IF;

  SELECT count(*) INTO v_drafts FROM public.payroll_days
  WHERE status = 'draft' AND work_date BETWEEN p_start AND p_start + 6;
  IF v_drafts > 0 THEN
    RAISE EXCEPTION 'drafts_pending' USING DETAIL = v_drafts::text;
  END IF;

  -- Mirrors payrollArea() in src/lib/payroll.ts: no linked profile means the workshop. INVOKER, so a profile
  -- hidden by RLS would freeze as workshop too; unreachable today: only an admin passes the RLS of payroll_days.
  UPDATE public.payroll_days d
  SET shift_snapshot = e.shift, area_snapshot = coalesce(p.area, 'workshop')
  FROM public.payroll_employees e
  LEFT JOIN public.profiles p ON p.id = e.profile_id
  WHERE e.id = d.employee_id AND d.work_date BETWEEN p_start AND p_start + 6;

  UPDATE public.payroll_periods
  SET status = 'closed', closed_at = now(), closed_by_name = p_actor_name
  WHERE start_date = p_start
  RETURNING * INTO v_period;
  RETURN to_jsonb(v_period);
END;
$$;

-- Reopen: the status flips first so the guard lets the snapshot go. NULL = it was not closed (nothing stamped).
CREATE OR REPLACE FUNCTION public.reopen_payroll_period(p_start date, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_period public.payroll_periods;
BEGIN
  IF p_start IS NULL OR EXTRACT(ISODOW FROM p_start) <> 6 THEN
    RAISE EXCEPTION 'not_period_start';
  END IF;
  UPDATE public.payroll_periods
  SET status = 'open', reopened_at = now(), reopened_by_name = p_actor_name
  WHERE start_date = p_start AND status = 'closed'
  RETURNING * INTO v_period;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.payroll_days
  SET shift_snapshot = NULL, area_snapshot = NULL
  WHERE work_date BETWEEN p_start AND p_start + 6
    AND (shift_snapshot IS NOT NULL OR area_snapshot IS NOT NULL);
  RETURN to_jsonb(v_period);
END;
$$;

-- authenticated only (RLS is_admin() still decides): PUBLIC and anon lose their default EXECUTE.
REVOKE ALL ON FUNCTION public.close_payroll_period(date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_payroll_period(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_payroll_period(date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_payroll_period(date, text) TO authenticated, service_role;
