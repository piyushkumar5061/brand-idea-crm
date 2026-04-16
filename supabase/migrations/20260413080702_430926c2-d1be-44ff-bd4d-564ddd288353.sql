-- Allow employees to update leads assigned to them
CREATE POLICY "Employees can update assigned leads"
ON public.leads
FOR UPDATE
TO authenticated
USING (assigned_to = auth.uid())
WITH CHECK (assigned_to = auth.uid());