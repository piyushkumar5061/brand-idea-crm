-- Denormalize follow-up date/time onto leads so we don't have to JOIN call_logs
-- for Overdue / date filters on the main Leads dashboard.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_time TIME;
CREATE INDEX IF NOT EXISTS leads_follow_up_date_idx ON public.leads(follow_up_date);

-- Backfill: take the most recent call_log's follow-up per lead
UPDATE public.leads l
SET follow_up_date = cl.follow_up_date,
    follow_up_time = cl.follow_up_time
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, follow_up_date, follow_up_time, created_at
  FROM public.call_logs
  ORDER BY lead_id, created_at DESC
) cl
WHERE l.id = cl.lead_id
  AND (l.follow_up_date IS NULL OR l.follow_up_time IS NULL);

-- Update trigger so call_logs inserts mirror follow-up fields too
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

NOTIFY pgrst, 'reload schema';
