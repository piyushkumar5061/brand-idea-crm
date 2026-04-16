-- ============================================================================
-- Brand Idea CRM — Master Database Blueprint (Supabase / Postgres)
-- ----------------------------------------------------------------------------
-- Run this ONCE against a fresh Supabase project's SQL editor (or psql) to
-- build the entire schema, RLS, triggers, and RPC surface consumed by the
-- Brand Idea CRM frontend.
--
-- Consolidates every migration from the school-sales-buddy lineage:
--   20260411… initial tables
--   20260412… leads.custom_fields
--   20260413… employees can update assigned leads
--   20260415… align with frontend (profiles.role, disposition_category enum)
--   20260416_0900  add latest_disposition
--   20260416_1400  leads disposition/category columns
--   20260416_1600  denormalized follow-up fields on leads
--   20260416_1800  attendance_logs + leave_requests + first admin RPC
--   20260416_2000  reviewed_by / reviewed_at columns
--   20260416_2200  widen status CHECK + deals_closed + employee history RPC
--   20260416_2400  admin_attendance_for_range RPC
--
-- Safe to re-run: everything is guarded with IF NOT EXISTS / DROP … IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.disposition_category AS ENUM ('non_contact', 'contacted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Shared updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============================================================================
-- 3. profiles  (role source of truth, keyed by user_id FK to auth.users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid() REFERENCES auth.users(id),
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  role        TEXT DEFAULT 'employee',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','manager','employee'));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique ON public.profiles(user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. leads
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  email              TEXT DEFAULT ''::text,
  message            TEXT DEFAULT ''::text,
  source             TEXT DEFAULT 'website'::text,
  current_status     TEXT DEFAULT 'new'::text,
  notes              TEXT DEFAULT ''::text,
  assigned_to_legacy TEXT DEFAULT ''::text,
  follow_up_date     TIMESTAMPTZ,
  follow_up_time     TIME,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  assigned_to        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_date      TEXT,
  lead_source        TEXT,
  age                TEXT,
  response           TEXT,
  location           TEXT,
  gender             TEXT,
  alt_phone          TEXT,
  call_status        TEXT,
  remarks            TEXT,
  custom_fields      JSONB DEFAULT '{}'::jsonb,
  latest_disposition TEXT,
  disposition        TEXT,
  category           TEXT,
  CONSTRAINT unique_phone_number UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to        ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_at         ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone              ON public.leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status             ON public.leads(current_status);
CREATE INDEX IF NOT EXISTS leads_category_idx           ON public.leads(category);
CREATE INDEX IF NOT EXISTS leads_disposition_idx        ON public.leads(disposition);
CREATE INDEX IF NOT EXISTS leads_follow_up_date_idx     ON public.leads(follow_up_date);
CREATE INDEX IF NOT EXISTS leads_latest_disposition_idx ON public.leads(latest_disposition);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- 5. call_logs  (per-call record; triggers lead disposition sync)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.call_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  called_by            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  disposition_category public.disposition_category NOT NULL,
  disposition_value    TEXT NOT NULL,
  follow_up_date       DATE,
  follow_up_time       TIME,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_called_by_idx ON public.call_logs(called_by);
CREATE INDEX IF NOT EXISTS call_logs_lead_id_idx   ON public.call_logs(lead_id);
CREATE INDEX IF NOT EXISTS call_logs_follow_up_idx ON public.call_logs(follow_up_date)
  WHERE follow_up_date IS NOT NULL;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. appointments  (optional scheduling table used by some modules)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  date       DATE NOT NULL,
  time       TEXT NOT NULL,
  note       TEXT DEFAULT ''::text,
  status     TEXT DEFAULT 'scheduled'::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show'));

CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(date);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS appointments_updated_at ON public.appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- 7. attendance_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date               DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in           TIMESTAMPTZ,
  clock_out          TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'Present',
  approval_status    TEXT NOT NULL DEFAULT 'Pending',
  active_crm_minutes INT  NOT NULL DEFAULT 0,
  notes              TEXT,
  reviewed_by        UUID REFERENCES auth.users(id),
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_status_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN (
    'Present',
    'Absent',
    'Leave',
    'Holiday',
    'Abscond',
    'Absconded',
    'Week off',
    'Pending Approval',
    'Leave Requested',
    'Leave Approved'
  ));

ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_approval_status_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_approval_status_check
  CHECK (approval_status IN ('Pending','Approved','Rejected'));

CREATE INDEX IF NOT EXISTS attendance_logs_user_idx         ON public.attendance_logs(user_id);
CREATE INDEX IF NOT EXISTS attendance_logs_date_idx         ON public.attendance_logs(date);
CREATE INDEX IF NOT EXISTS attendance_logs_reviewed_at_idx  ON public.attendance_logs(reviewed_at);
CREATE INDEX IF NOT EXISTS attendance_logs_pending_idx      ON public.attendance_logs(approval_status)
  WHERE approval_status = 'Pending';

ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance_logs;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- 8. leave_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('Pending','Approved','Rejected'));

CREATE INDEX IF NOT EXISTS leave_requests_user_idx   ON public.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON public.leave_requests(status);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. Role helpers (SECURITY DEFINER — bypass RLS recursion)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.current_user_role() IN ('super_admin','admin','manager'); $$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_above()  TO authenticated;

-- ============================================================================
-- 10. Auto-provision profile row on auth.users INSERT
--     (Super-admin email is configurable — see SUPER_ADMIN_EMAIL below.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- Change this to the email that should be auto-granted super_admin role.
  SUPER_ADMIN_EMAIL CONSTANT TEXT := 'piyushkumar5061@gmail.com';
BEGIN
  INSERT INTO public.profiles (id, user_id, full_name, email, role)
  VALUES (
    gen_random_uuid(),
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE WHEN NEW.email = SUPER_ADMIN_EMAIL THEN 'super_admin' ELSE 'employee' END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 11. Lead disposition sync — every call_logs insert updates parent lead
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_lead_latest_disposition()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET disposition        = NEW.disposition_value,
      latest_disposition = NEW.disposition_value,
      category           = NEW.disposition_category::text,
      follow_up_date     = NEW.follow_up_date,
      follow_up_time     = NEW.follow_up_time,
      current_status     = CASE
        WHEN current_status IS NULL OR current_status = 'new'
          THEN CASE NEW.disposition_category::text
                 WHEN 'contacted' THEN 'contacted'
                 ELSE current_status
               END
        ELSE current_status
      END,
      updated_at = now()
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_logs_sync_lead ON public.call_logs;
CREATE TRIGGER call_logs_sync_lead
  AFTER INSERT ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_latest_disposition();

-- ============================================================================
-- 12. RLS policies
-- ============================================================================

-- ----- profiles -----
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', p.policyname); END LOOP;
END $$;

CREATE POLICY profiles_select_own   ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above());

CREATE POLICY profiles_update_self  ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
              AND role = (SELECT role FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY profiles_insert_admin ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY profiles_delete_admin ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin_or_above());

-- ----- leads -----
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='leads'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads', p.policyname); END LOOP;
END $$;

CREATE POLICY leads_select        ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_admin_or_above() OR assigned_to = auth.uid());

CREATE POLICY leads_insert_admin  ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_above());

-- Public (anon) INSERT for webhook / marketing form ingestion
CREATE POLICY leads_insert_public ON public.leads
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY leads_update        ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_above() OR assigned_to = auth.uid())
  WITH CHECK (public.is_admin_or_above() OR assigned_to = auth.uid());

CREATE POLICY leads_delete_admin  ON public.leads
  FOR DELETE TO authenticated
  USING (public.is_admin_or_above());

-- ----- call_logs -----
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='call_logs'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.call_logs', p.policyname); END LOOP;
END $$;

CREATE POLICY call_logs_select        ON public.call_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_or_above() OR called_by = auth.uid());

CREATE POLICY call_logs_insert        ON public.call_logs
  FOR INSERT TO authenticated
  WITH CHECK (called_by = auth.uid());

CREATE POLICY call_logs_update_own    ON public.call_logs
  FOR UPDATE TO authenticated
  USING (called_by = auth.uid() OR public.is_admin_or_above())
  WITH CHECK (called_by = auth.uid() OR public.is_admin_or_above());

CREATE POLICY call_logs_delete_admin  ON public.call_logs
  FOR DELETE TO authenticated
  USING (public.is_admin_or_above());

-- ----- attendance_logs -----
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='attendance_logs'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.attendance_logs', p.policyname); END LOOP;
END $$;

CREATE POLICY attendance_select_own          ON public.attendance_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above());

CREATE POLICY attendance_insert_self_today   ON public.attendance_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND date = CURRENT_DATE);

CREATE POLICY attendance_update_self_today   ON public.attendance_logs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND date = CURRENT_DATE)
  WITH CHECK (user_id = auth.uid() AND date = CURRENT_DATE);

CREATE POLICY attendance_admin_all           ON public.attendance_logs
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

-- ----- leave_requests -----
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='leave_requests'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.leave_requests', p.policyname); END LOOP;
END $$;

CREATE POLICY leave_select              ON public.leave_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above());

CREATE POLICY leave_insert_self         ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY leave_delete_own_pending  ON public.leave_requests
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid() AND status = 'Pending') OR public.is_admin_or_above());

CREATE POLICY leave_update_admin        ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

-- ============================================================================
-- 13. Admin / employee RPCs for the Attendance dashboard
-- ============================================================================

-- Single-date admin view (used by legacy code; kept for parity)
DROP FUNCTION IF EXISTS public.admin_attendance_for_date(DATE);
CREATE FUNCTION public.admin_attendance_for_date(p_date DATE)
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
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id,
    p.user_id,
    p.full_name,
    p.email,
    COALESCE(a.date, p_date),
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

-- Date-range admin view (one row per employee per day — used by month picker)
DROP FUNCTION IF EXISTS public.admin_attendance_for_range(DATE, DATE);
CREATE FUNCTION public.admin_attendance_for_range(p_start DATE, p_end DATE)
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
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH allowed AS (SELECT public.is_admin_or_above() AS ok)
  SELECT
    a.id,
    p.user_id,
    p.full_name,
    p.email,
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

-- Employee-self (or admin) history for a single user across a date range
DROP FUNCTION IF EXISTS public.employee_attendance_history(UUID, DATE, DATE);
CREATE FUNCTION public.employee_attendance_history(
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
LANGUAGE sql SECURITY DEFINER SET search_path = public
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
      COUNT(*)                                                                     AS total,
      COUNT(*) FILTER (WHERE disposition_category = 'contacted')                   AS connected,
      COUNT(*) FILTER (WHERE disposition_value IN ('Deal closed', 'Ready to pay')) AS deals
    FROM public.call_logs cl
    WHERE cl.called_by   = p_user_id
      AND cl.created_at >= d::timestamptz
      AND cl.created_at <  (d::DATE + 1)::timestamptz
  ) c ON TRUE
  WHERE allowed.ok = TRUE
    AND (a.id IS NOT NULL OR d::DATE <= CURRENT_DATE)
  ORDER BY d::DATE DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_attendance_for_date(DATE)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_attendance_for_range(DATE, DATE)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_attendance_history(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- 14. Backfill profile rows for any auth.users that pre-date the trigger
-- ============================================================================
INSERT INTO public.profiles (id, user_id, full_name, email, role)
SELECT
  gen_random_uuid(),
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.email,
  CASE WHEN u.email = 'piyushkumar5061@gmail.com' THEN 'super_admin' ELSE 'employee' END
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- ============================================================================
-- 15. Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';
