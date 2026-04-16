-- Add latest_disposition to leads for efficient filtering, and keep it in sync
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS latest_disposition TEXT;

-- Backfill from current_status
UPDATE public.leads
SET latest_disposition = current_status
WHERE latest_disposition IS NULL AND current_status IS NOT NULL AND current_status <> 'new';

CREATE INDEX IF NOT EXISTS leads_latest_disposition_idx ON public.leads(latest_disposition);

-- Sync latest_disposition + current_status whenever a call_log is inserted
CREATE OR REPLACE FUNCTION public.sync_lead_latest_disposition()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET latest_disposition = NEW.disposition_value,
      current_status = NEW.disposition_value,
      updated_at = now()
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_logs_sync_lead ON public.call_logs;
CREATE TRIGGER call_logs_sync_lead
  AFTER INSERT ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_latest_disposition();

NOTIFY pgrst, 'reload schema';
