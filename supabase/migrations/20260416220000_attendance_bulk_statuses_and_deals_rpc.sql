-- ===========================================================================
-- Attendance: widen status vocabulary + add deals_closed metric to the
-- admin RPC and introduce an employee history RPC that joins attendance
-- with per-day call_logs aggregates.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen attendance_logs.status CHECK to include all admin-selectable states
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_status_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN (
    'Present',
    'Absent',
    'Leave',                -- legacy
    'Holiday',
    'Abscond',              -- legacy
    'Absconded',
    'Week off',
    'Pending Approval',
    'Leave Requested',
    'Leave Approved'
  ));

-- ---------------------------------------------------------------------------
-- 2. Admin RPC: add deals_closed (Deal closed OR Ready to pay) per user/day
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_attendance_for_date(DATE);

CREATE OR REPLACE FUNCTION public.admin_attendance_for_date(p_date DATE)
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
  total_calls        BIGINT,
  connected_calls    BIGINT,
  deals_closed       BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    p.user_id,
    p.full_name,
    p.email,
    COALESCE(a.date, p_date) AS date,
    COALESCE(a.status, 'Absent'),
    COALESCE(a.approval_status, 'Pending'),
    a.clock_in,
    a.clock_out,
    COALESCE(a.active_crm_minutes, 0),
    COALESCE(c.total,     0),
    COALESCE(c.connected, 0),
    COALESCE(c.deals,     0)
  FROM public.profiles p
  LEFT JOIN public.attendance_logs a
    ON a.user_id = p.user_id AND a.date = p_date
  LEFT JOIN (
    SELECT
      called_by,
      COUNT(*)                                                                          AS total,
      COUNT(*) FILTER (WHERE disposition_category = 'contacted')                        AS connected,
      COUNT(*) FILTER (WHERE disposition_value IN ('Deal closed', 'Ready to pay'))      AS deals
    FROM public.call_logs
    WHERE created_at >= p_date::timestamptz
      AND created_at <  (p_date + 1)::timestamptz
    GROUP BY called_by
  ) c ON c.called_by = p.user_id
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

-- ---------------------------------------------------------------------------
-- 3. Employee RPC: history for a single user with the same three metrics
--    (respects RLS-equivalent: only the user themselves or an admin can fetch)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.employee_attendance_history(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.employee_attendance_history(
  p_user_id UUID,
  p_start   DATE DEFAULT (CURRENT_DATE - INTERVAL '90 days')::DATE,
  p_end     DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  attendance_id      UUID,
  user_id            UUID,
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
  WITH allowed AS (
    SELECT (auth.uid() = p_user_id OR public.is_admin_or_above()) AS ok
  )
  SELECT
    a.id,
    COALESCE(a.user_id, p_user_id),
    d::DATE,
    COALESCE(a.status, 'Absent'),
    COALESCE(a.approval_status, 'Pending'),
    a.clock_in,
    a.clock_out,
    COALESCE(a.active_crm_minutes, 0),
    a.notes,
    COALESCE(c.total,     0),
    COALESCE(c.connected, 0),
    COALESCE(c.deals,     0)
  FROM generate_series(p_start, p_end, INTERVAL '1 day') AS d
  CROSS JOIN allowed
  LEFT JOIN public.attendance_logs a
    ON a.user_id = p_user_id AND a.date = d::DATE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                                                          AS total,
      COUNT(*) FILTER (WHERE disposition_category = 'contacted')                        AS connected,
      COUNT(*) FILTER (WHERE disposition_value IN ('Deal closed', 'Ready to pay'))      AS deals
    FROM public.call_logs cl
    WHERE cl.called_by   = p_user_id
      AND cl.created_at >= d::timestamptz
      AND cl.created_at <  (d::DATE + 1)::timestamptz
  ) c ON TRUE
  WHERE allowed.ok = TRUE
    AND (a.id IS NOT NULL OR d::DATE <= CURRENT_DATE)
  ORDER BY d::DATE DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_attendance_for_date(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_attendance_history(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
