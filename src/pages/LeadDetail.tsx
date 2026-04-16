import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, MessageCircle, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import DispositionModal from '@/components/DispositionModal';
import { normalizePhoneForWa } from '@/lib/dispositions';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string | null;
  assigned_to: string | null;
  current_status: string | null;
  disposition: string | null;
  category: string | null;
  latest_disposition: string | null;
  created_at: string;
  updated_at: string | null;
  custom_fields?: Record<string, string> | null;
}

interface CallLog {
  id: string;
  disposition_category: string;
  disposition_value: string;
  follow_up_date: string | null;
  follow_up_time: string | null;
  notes: string | null;
  created_at: string;
}

type LeadsCacheShape = { rows: Lead[]; total: number };

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showLogModal, setShowLogModal] = useState(false);

  const { data: lead, isLoading: leadLoading } = useQuery<Lead | null>({
    queryKey: ['lead-detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as Lead | null;
    },
  });

  const { data: callLogs = [], isLoading: logsLoading } = useQuery<CallLog[]>({
    queryKey: ['call-logs', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('call_logs')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      return (data as CallLog[]) ?? [];
    },
  });

  /**
   * Resolve the next lead to view after a call log is saved.
   * We scan all cached ['leads', ...] queries (the main dashboard uses a
   * composite key with filters+pagination) and find one whose row list
   * contains the current lead. The lead at idx+1 is our target.
   * Returns null if there is no next lead (i.e., last in cache or not cached).
   */
  const findNextLeadId = (currentId: string): string | null => {
    const entries = queryClient.getQueriesData<LeadsCacheShape>({ queryKey: ['leads'] });
    for (const [, data] of entries) {
      if (!data?.rows?.length) continue;
      const idx = data.rows.findIndex(l => l.id === currentId);
      if (idx === -1) continue;
      if (idx + 1 < data.rows.length) return data.rows[idx + 1].id;
    }
    return null;
  };

  const nextLeadId = useMemo(() => (lead ? findNextLeadId(lead.id) : null), [lead?.id]);
  const hasNext = !!nextLeadId;

  /** Called by DispositionModal's "Save & Next" once the log is persisted. */
  const handleSaveAndNext = () => {
    if (!lead) return;
    // Re-resolve from cache: the modal already invalidated ['leads'], but the
    // existing cached snapshots are still accurate for ordering.
    const target = findNextLeadId(lead.id);
    setShowLogModal(false);
    if (target) navigate(`/leads/${target}`);
    else {
      toast.message('End of list — back to Leads');
      navigate('/leads');
    }
  };

  /** Called by the modal's plain "Save". */
  const handleSaved = () => {
    setShowLogModal(false);
    queryClient.invalidateQueries({ queryKey: ['lead-detail', lead?.id] });
    queryClient.invalidateQueries({ queryKey: ['call-logs', lead?.id] });
  };

  const openWhatsApp = () => {
    if (!lead) return;
    const phone = normalizePhoneForWa(lead.phone);
    if (!phone) { toast.error('Invalid phone number'); return; }
    window.open(
      `https://wa.me/${phone}?text=Hello ${encodeURIComponent(lead.name)}`,
      '_blank',
    );
  };

  const customFields =
    lead?.custom_fields && typeof lead.custom_fields === 'object' && !Array.isArray(lead.custom_fields)
      ? (lead.custom_fields as Record<string, string>)
      : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header: Back + WhatsApp + prominent Log Call */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/leads')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Leads
          </Button>
          {lead && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 border-green-200 hover:bg-green-50"
                onClick={openWhatsApp}
              >
                <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
              </Button>
              <Button size="sm" onClick={() => setShowLogModal(true)}>
                <Phone className="w-4 h-4 mr-1" /> Log Call
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Lead info */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-xl">
                {leadLoading ? <Skeleton className="h-6 w-48" /> : lead?.name || 'Lead'}
              </CardTitle>
              {lead && (
                <div className="flex items-center gap-2">
                  {lead.disposition && (
                    <Badge variant="outline" className="bg-primary/10 text-primary">
                      {lead.disposition}
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-muted text-muted-foreground text-[11px]">
                    {lead.current_status || 'new'}
                  </Badge>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {leadLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : !lead ? (
                <p className="text-sm text-muted-foreground">Lead not found.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <InfoRow label="Phone" value={
                      <span className="flex items-center gap-1">
                        {lead.phone}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
                          title="WhatsApp"
                          onClick={openWhatsApp}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </Button>
                      </span>
                    } />
                    <InfoRow label="Email" value={lead.email || '—'} />
                    <InfoRow label="Source" value={lead.source || '—'} />
                    <InfoRow label="Category" value={lead.category || '—'} />
                    <InfoRow label="Created" value={format(new Date(lead.created_at), 'MMM d, yyyy, h:mm a')} />
                    {lead.updated_at && (
                      <InfoRow label="Updated" value={format(new Date(lead.updated_at), 'MMM d, yyyy, h:mm a')} />
                    )}
                  </div>

                  {customFields && Object.keys(customFields).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-semibold text-muted-foreground mb-2">Additional Info</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          {Object.entries(customFields).map(([k, v]) => (
                            <InfoRow key={k} label={k} value={String(v)} />
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Update the disposition by logging a call. Use <strong>Save &amp; Next</strong> to
                      speed-dial through leads.
                    </p>
                    <Button size="sm" onClick={() => setShowLogModal(true)}>
                      <Phone className="w-4 h-4 mr-1" /> Log Call
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Call history */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Call History {callLogs.length > 0 && <span className="text-muted-foreground">({callLogs.length})</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : callLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No calls logged yet</p>
              ) : (
                <div className="space-y-2">
                  {callLogs.map(log => (
                    <div key={log.id} className="p-2.5 bg-muted/50 rounded-lg text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className={log.disposition_category === 'contacted'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted'}
                        >
                          {log.disposition_value}
                        </Badge>
                        <span className="text-muted-foreground">
                          {format(new Date(log.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      {log.follow_up_date && (
                        <p className="text-muted-foreground">
                          Follow-up: {format(new Date(log.follow_up_date), 'MMM d')} {log.follow_up_time?.slice(0, 5)}
                        </p>
                      )}
                      {log.notes && <p className="text-foreground">{log.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {lead && showLogModal && (
        <DispositionModal
          lead={{ id: lead.id, name: lead.name, phone: lead.phone }}
          onClose={() => setShowLogModal(false)}
          onSaved={handleSaved}
          onSaveAndNext={handleSaveAndNext}
          hasNext={hasNext}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
