-- ===========================================================================
-- Fix: Add missing reviewed_by / reviewed_at columns to attendance_logs
-- (Also ensure leave_requests has reviewed_by for parity.)
-- Clears PostgREST schema cache so "column not found" errors disappear.
-- ===========================================================================

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);

-- Index on reviewed_at for admin dashboards filtering by approval time
CREATE INDEX IF NOT EXISTS attendance_logs_reviewed_at_idx
  ON public.attendance_logs (reviewed_at);

-- Force PostgREST to reload its schema cache so the new columns appear immediately
NOTIFY pgrst, 'reload schema';
