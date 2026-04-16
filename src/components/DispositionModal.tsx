import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { SkipForward } from 'lucide-react';
import {
  DISPOSITIONS_BY_CATEGORY,
  NO_FOLLOWUP_REQUIRED,
  type DispositionCategory,
} from '@/lib/dispositions';

interface Lead {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  lead: Lead;
  onClose: () => void;
  onSaved: () => void;
  onSaveAndNext?: () => void;
  hasNext?: boolean;
}

export default function DispositionModal({ lead, onClose, onSaved, onSaveAndNext, hasNext }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DispositionCategory | ''>('');
  const [value, setValue] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Disposition list is derived from the selected category (dependent dropdown)
  const dispositionOptions = category ? DISPOSITIONS_BY_CATEGORY[category] : [];

  const needsFollowUp =
    category === 'contacted' && value && !NO_FOLLOWUP_REQUIRED.includes(value);

  const canSave =
    category && value && (!needsFollowUp || (followUpDate && followUpTime));

  const handleSave = async (andNext: boolean) => {
    if (!canSave || !user) return;

    // Only non_contact and contacted persist to call_logs (category enum)
    // A "new" disposition just updates the lead's status without a call record.
    setSaving(true);
    try {
      if (category === 'non_contact' || category === 'contacted') {
        const { error: logError } = await supabase.from('call_logs').insert({
          lead_id: lead.id,
          called_by: user.id,
          disposition_category: category,
          disposition_value: value,
          follow_up_date: followUpDate || null,
          follow_up_time: followUpTime || null,
          notes: notes || null,
        });
        if (logError) throw logError;
        // The DB trigger sync_lead_latest_disposition keeps leads in sync,
        // but we also write the client-side mirror so the UI is consistent
        // without waiting for a refetch. NEVER write the disposition into
        // current_status directly — that's what broke the CHECK constraint.
        const payload: Record<string, unknown> = {
          disposition: value,
          latest_disposition: value,
          category,
        };
        if (category === 'contacted') payload.current_status = 'contacted';
        await supabase.from('leads').update(payload).eq('id', lead.id);
      } else {
        // 'new' category — just mirror the disposition
        await supabase
          .from('leads')
          .update({ disposition: value, latest_disposition: value, category: 'new' })
          .eq('id', lead.id);
      }

      // Keep main table in sync (especially when filtered by disposition)
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-detail', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['call-logs', lead.id] });

      toast.success('Call logged successfully');

      if (andNext && onSaveAndNext) {
        setCategory('');
        setValue('');
        setFollowUpDate('');
        setFollowUpTime('');
        setNotes('');
        onSaveAndNext();
      } else {
        onSaved();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Call — {lead.name}</DialogTitle>
          <p className="text-xs text-muted-foreground">{lead.phone}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v: DispositionCategory) => { setCategory(v); setValue(''); }}
            >
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="non_contact">Non-Contact</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className={!category ? 'text-muted-foreground' : undefined}>
              Disposition {!category && <span className="text-xs">(pick category first)</span>}
            </Label>
            <Select value={value} onValueChange={setValue} disabled={!category}>
              <SelectTrigger>
                <SelectValue placeholder={category ? 'Select disposition' : 'Select category first'} />
              </SelectTrigger>
              <SelectContent>
                {dispositionOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {needsFollowUp && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Follow-up Date *</Label>
                <Input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} required />
              </div>
              <div>
                <Label>Follow-up Time *</Label>
                <Input type="time" value={followUpTime} onChange={e => setFollowUpTime(e.target.value)} required />
              </div>
            </div>
          )}

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {hasNext && onSaveAndNext && (
              <Button
                variant="secondary"
                onClick={() => handleSave(true)}
                disabled={!canSave || saving}
              >
                <SkipForward className="w-3.5 h-3.5 mr-1" />
                {saving ? 'Saving...' : 'Save & Next'}
              </Button>
            )}
            <Button onClick={() => handleSave(false)} disabled={!canSave || saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
