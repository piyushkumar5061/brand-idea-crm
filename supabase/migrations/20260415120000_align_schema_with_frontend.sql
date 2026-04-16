-- =============================================================================
-- Align DB schema with frontend expectations.
-- - profiles keyed by user_id (FK to auth.users) + full_name/email/phone
-- - role values: super_admin, admin, manager, employee
-- - call_logs uses disposition_category ENUM + disposition_value + called_by NOT NULL
-- - handle_new_user trigger auto-provisions profile on signup
-- - RLS policies use profiles.role via security-definer helper
-- =============================================================================

-- Drop legacy helpers created in an earlier (incorrect) migration
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID) CASCADE;

-- ---------- PROFILES ----------
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', p.policyname); END LOOP;
END $$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE public.profiles SET user_id = id WHERE user_id IS NULL;
ALTER TABLE public.profiles ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique ON public.profiles(user_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'employee';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','manager','employee'));

-- Backfill names/emails from auth.users
UPDATE public.profiles p
SET email = COALESCE(p.email, u.email),
    full_name = COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
FROM auth.users u
WHERE p.user_id = u.id;

-- Promote primary owner
UPDATE public.profiles SET role = 'super_admin'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'piyushkumar5061@gmail.com');

-- Backfill missing profiles
INSERT INTO public.profiles (id, user_id, full_name, email, role)
SELECT gen_random_uuid(), u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
       u.email,
       CASE WHEN u.email = 'piyushkumar5061@gmail.com' THEN 'super_admin' ELSE 'employee' END
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- ---------- HELPERS ----------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT public.current_user_role() IN ('super_admin','admin','manager'); $$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_above() TO authenticated;

-- ---------- RLS: profiles ----------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_or_above());
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin_or_above()) WITH CHECK (public.is_admin_or_above());
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE user_id = auth.uid()));
CREATE POLICY profiles_insert_admin ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_above());
CREATE POLICY profiles_delete_admin ON public.profiles
  FOR DELETE TO authenticated USING (public.is_admin_or_above());

-- ---------- HANDLE NEW USER TRIGGER ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id, full_name, email, role)
  VALUES (
    gen_random_uuid(),
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE WHEN NEW.email = 'piyushkumar5061@gmail.com' THEN 'super_admin' ELSE 'employee' END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- CALL_LOGS ----------
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='call_logs'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.call_logs', p.policyname); END LOOP;
END $$;

DROP TABLE IF EXISTS public.call_logs CASCADE;

DO $$ BEGIN
  CREATE TYPE public.disposition_category AS ENUM ('non_contact', 'contacted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  called_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  disposition_category public.disposition_category NOT NULL,
  disposition_value TEXT NOT NULL,
  follow_up_date DATE,
  follow_up_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX call_logs_lead_id_idx ON public.call_logs(lead_id);
CREATE INDEX call_logs_called_by_idx ON public.call_logs(called_by);
CREATE INDEX call_logs_follow_up_idx ON public.call_logs(follow_up_date) WHERE follow_up_date IS NOT NULL;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_logs_select ON public.call_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_or_above() OR called_by = auth.uid());
CREATE POLICY call_logs_insert ON public.call_logs
  FOR INSERT TO authenticated
  WITH CHECK (called_by = auth.uid());
CREATE POLICY call_logs_update_own ON public.call_logs
  FOR UPDATE TO authenticated
  USING (called_by = auth.uid() OR public.is_admin_or_above())
  WITH CHECK (called_by = auth.uid() OR public.is_admin_or_above());
CREATE POLICY call_logs_delete_admin ON public.call_logs
  FOR DELETE TO authenticated USING (public.is_admin_or_above());

-- ---------- LEADS POLICIES (realign) ----------
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='leads'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads', p.policyname); END LOOP;
END $$;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_admin_or_above() OR assigned_to = auth.uid());
CREATE POLICY leads_insert_admin ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_above());
CREATE POLICY leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_above() OR assigned_to = auth.uid())
  WITH CHECK (public.is_admin_or_above() OR assigned_to = auth.uid());
CREATE POLICY leads_delete_admin ON public.leads
  FOR DELETE TO authenticated USING (public.is_admin_or_above());

-- Public insert for n8n / webhook (anon key)
CREATE POLICY leads_insert_public ON public.leads
  FOR INSERT TO anon WITH CHECK (true);

-- Tell PostgREST to reload schema so new columns/enums are visible immediately
NOTIFY pgrst, 'reload schema';
