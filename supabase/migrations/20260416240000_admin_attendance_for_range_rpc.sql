-- ===========================================================================
-- Admin RPC: full date range variant of admin_attendance_for_date, powered by
-- generate_series × profiles so the month view shows one row per employee per
-- day (even days with no attendance log yet). Same three call_logs aggregates
-- are computed per exact day so historical metrics stay correct.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.admin_attendance_for_range(DATE, DATE);

CREATE OR REPLACE FUNCTION public.admin_attendance_for_range(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  attendance_id      UUID,
  user_id            UUID,
  full_name          TEXT,
  email              TEXT,
  date               DATE,
  status             TEXT,
  approval_status    TEXT,
  clock_in           TIMESTAMPTZ,
  clock_out          TIMESTAMPTZ,
  active_crm_minutes INT,
  notes              TEXT,
  total_calls        BIGINT,
  connected_calls    BIGINT,
  deals_closed       BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only admins (or above) can invoke this.
  WITH allowed AS (
    SELECT public.is_admin_or_above() AS ok
  )
  SELECT
    a.id,
    p.user_id,
    p.full_name,
    p.email,
    d::DATE                                     AS date,
    COALESCE(a.status, 'Absent')                AS status,
    COALESCE(a.approval_status, 'Pending')      AS approval_status,
    a.clock_in,
    a.clock_out,
    COALESCE(a.active_crm_minutes, 0)           AS active_crm_minutes,
    a.notes,
    COALESCE(c.total,     0)                    AS total_calls,
    COALESCE(c.connected, 0)                    AS connected_calls,
    COALESCE(c.deals,     0)                    AS deals_closed
  FROM public.profiles p
  CROSS JOIN generate_series(p_start, p_end, INTERVAL '1 day') AS d
  CROSS JOIN allowed
  LEFT JOIN public.attendance_logs a
    ON a.user_id = p.user_id AND a.date = d::DATE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                                                     AS total,
      COUNT(*) FILTER (WHERE disposition_category = 'contacted')                   AS connected,
      COUNT(*) FILTER (WHERE disposition_value IN ('Deal closed', 'Ready to pay')) AS deals
    FROM public.call_logs cl
    WHERE cl.called_by   = p.user_id
      AND cl.created_at >= d::timestamptz
      AND cl.created_at <  (d::DATE + 1)::timestamptz
  ) c ON TRUE
  WHERE allowed.ok = TRUE
  ORDER BY d::DATE DESC, p.full_name NULLS LAST, p.email;
$$;

GRANT EXECUTE ON FUNCTION public.admin_attendance_for_range(DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
