-- ===========================================================================
-- Attendance + Leave Management Module
-- ===========================================================================
-- Adds attendance_logs (daily clock-in/out + active CRM time + approval flow),
-- leave_requests (employee-requested leave with approve/reject flow),
-- and the admin_attendance_for_date RPC that joins attendance with the
-- call_logs performance counters for a single date.

-- ---------------------------------------------------------------------------
-- attendance_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Present'
    CHECK (status IN ('Present', 'Absent', 'Leave', 'Holiday', 'Abscond')),
  approval_status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
  active_crm_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS attendance_logs_user_date_idx
  ON public.attendance_logs (user_id, date DESC);
CREATE INDEX IF NOT EXISTS attendance_logs_date_idx
  ON public.attendance_logs (date);
CREATE INDEX IF NOT EXISTS attendance_logs_approval_idx
  ON public.attendance_logs (approval_status);

ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- Employees can read their own attendance; admins read everything.
DROP POLICY IF EXISTS attendance_select_self ON public.attendance_logs;
CREATE POLICY attendance_select_self ON public.attendance_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above());

-- Employees can ONLY insert an attendance row for themselves for today.
DROP POLICY IF EXISTS attendance_insert_self_today ON public.attendance_logs;
CREATE POLICY attendance_insert_self_today ON public.attendance_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND date = CURRENT_DATE
  );

-- Employees can update their own row ONLY if it's today's row (clock-out + minutes).
DROP POLICY IF EXISTS attendance_update_self_today ON public.attendance_logs;
CREATE POLICY attendance_update_self_today ON public.attendance_logs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND date = CURRENT_DATE)
  WITH CHECK (user_id = auth.uid() AND date = CURRENT_DATE);

-- Admins can do anything (approve, override, edit history).
DROP POLICY IF EXISTS attendance_admin_all ON public.attendance_logs;
CREATE POLICY attendance_admin_all ON public.attendance_logs
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_attendance_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance_logs;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_attendance_updated_at();

-- ---------------------------------------------------------------------------
-- leave_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_user_idx
  ON public.leave_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx
  ON public.leave_requests (status);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_select_self_or_admin ON public.leave_requests;
CREATE POLICY leave_select_self_or_admin ON public.leave_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above());

DROP POLICY IF EXISTS leave_insert_self ON public.leave_requests;
CREATE POLICY leave_insert_self ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Employees may cancel their own request ONLY while it is still Pending.
DROP POLICY IF EXISTS leave_delete_self_pending ON public.leave_requests;
CREATE POLICY leave_delete_self_pending ON public.leave_requests
  FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'Pending') OR public.is_admin_or_above()
  );

-- Only admins can approve/reject.
DROP POLICY IF EXISTS leave_update_admin ON public.leave_requests;
CREATE POLICY leave_update_admin ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

-- ---------------------------------------------------------------------------
-- Admin RPC: join attendance + call_logs performance for a single date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_attendance_for_date(p_date DATE)
RETURNS TABLE (
  attendance_id       UUID,
  user_id             UUID,
  full_name           TEXT,
  email               TEXT,
  date                DATE,
  status              TEXT,
  approval_status     TEXT,
  clock_in            TIMESTAMPTZ,
  clock_out           TIMESTAMPTZ,
  active_crm_minutes  INT,
  notes               TEXT,
  total_calls         BIGINT,
  connected_calls     BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id                                            AS attendance_id,
    p.user_id                                       AS user_id,
    p.full_name                                     AS full_name,
    p.email                                         AS email,
    COALESCE(a.date, p_date)                        AS date,
    COALESCE(a.status, 'Absent')                    AS status,
    COALESCE(a.approval_status, 'Pending')          AS approval_status,
    a.clock_in                                      AS clock_in,
    a.clock_out                                     AS clock_out,
    COALESCE(a.active_crm_minutes, 0)               AS active_crm_minutes,
    a.notes                                         AS notes,
    COALESCE(c.total_calls, 0)                      AS total_calls,
    COALESCE(c.connected_calls, 0)                  AS connected_calls
  FROM public.profiles p
  LEFT JOIN public.attendance_logs a
    ON a.user_id = p.user_id AND a.date = p_date
  LEFT JOIN (
    SELECT
      called_by,
      COUNT(*)                                                              AS total_calls,
      COUNT(*) FILTER (WHERE disposition_category::text = 'contacted')       AS connected_calls
    FROM public.call_logs
    WHERE created_at >= p_date::timestamptz
      AND created_at <  (p_date + INTERVAL '1 day')::timestamptz
    GROUP BY called_by
  ) c ON c.called_by = p.user_id
  ORDER BY p.full_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.admin_attendance_for_date(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_attendance_for_date(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
