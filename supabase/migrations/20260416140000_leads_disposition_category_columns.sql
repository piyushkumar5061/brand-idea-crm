-- Fix: "new row for relation leads violates check constraint leads_status_check"
--
-- Root cause: the frontend was writing disposition values (e.g. 'Ready to pay')
-- into the `current_status` column, which has a CHECK constraint limited to
-- {new, contacted, qualified, proposal-sent, converted, lost}. This migration
-- moves dispositions into dedicated columns and removes the blocking check.

-- 1. Drop the blocking CHECK constraint (two possible names, both safe)
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_current_status_check;

-- 2. Dedicated columns
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS disposition TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS category    TEXT;

-- 3. Backfill
UPDATE public.leads
SET disposition = COALESCE(disposition, latest_disposition, current_status)
WHERE disposition IS NULL;

UPDATE public.leads
SET category = CASE
  WHEN disposition IN ('Did not pick','Switched off','Not reachable','Not in service','Incorrect number')
    THEN 'non_contact'
  WHEN disposition IN ('Call back','Ready to pay','Ready to join session','After session joined not interested','Not interested (on call)','Deal closed')
    THEN 'contacted'
  WHEN disposition IS NULL OR disposition = '' OR disposition = 'new'
    THEN 'new'
  ELSE NULL
END
WHERE category IS NULL;

-- 4. Indexes for filter performance
CREATE INDEX IF NOT EXISTS leads_disposition_idx ON public.leads(disposition);
CREATE INDEX IF NOT EXISTS leads_category_idx    ON public.leads(category);

-- 5. Update call_logs sync trigger to write the new columns instead of
--    dumping the disposition into current_status. If a lead is still 'new'
--    and gets a 'contacted' category disposition, promote status to 'contacted'.
CREATE OR REPLACE FUNCTION public.sync_lead_latest_disposition()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET disposition        = NEW.disposition_value,
      latest_disposition = NEW.disposition_value,
      category           = NEW.disposition_category::text,
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
