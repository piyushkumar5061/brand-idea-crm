import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ALL_DISPOSITIONS, normalizePhoneForWa } from '@/lib/dispositions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { format as formatDate } from 'date-fns';
import DispositionModal from '@/components/DispositionModal';
import { cn } from '@/lib/utils';
import {
  Phone, Search, Filter, X, Trash2, ChevronLeft, ChevronRight,
  MessageCircle, Users, SlidersHorizontal, CalendarIcon, AlertTriangle,
  LayoutList, KanbanSquare, Filter as FunnelIcon, Trophy, Flame,
  CircleDot, Database, RefreshCw,
} from 'lucide-react';

/**
 * Hard timeout wrapper for any PromiseLike. If the underlying promise hasn't
 * resolved by `ms`, we reject with a diagnostic Error. Required because
 * Supabase's JS client will happily hang forever when a relation is missing
 * or an RLS recursion blocks the connection — React Query's default is no
 * timeout, so isLoading stays true until the user closes the tab.
 */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[${label}] timed out after ${ms}ms — the table may be missing or RLS is blocking the query.`)),
      ms,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Heuristic: does this Supabase error mean "the table literally doesn't exist"?
 * Postgres returns error code 42P01 / message includes "relation … does not exist".
 * We surface a different, more actionable empty-state for this case.
 */
function isMissingRelationError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? '';
  return code === '42P01' || /relation .* does not exist/i.test(msg);
}

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
  custom_fields?: Record<string, string> | null;
}

interface Employee {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

const STATUS_OPTIONS = [
  'new', 'Did not pick', 'Switched off', 'Not reachable', 'Not in service', 'Incorrect number',
  'Call back', 'Ready to pay', 'Ready to join session',
  'After session joined not interested', 'Not interested (on call)', 'Deal closed',
];

const DISPOSITION_OPTIONS = ALL_DISPOSITIONS.filter(d => d !== 'new');

const PAGE_SIZE_OPTIONS = [
  { label: '10', value: '10' },
  { label: '50', value: '50' },
  { label: '100', value: '100' },
  { label: '500', value: '500' },
  { label: 'All', value: 'all' },
];

const FILTERABLE_COLUMNS = [
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'phone', label: 'Phone', type: 'text' },
  { value: 'email', label: 'Email', type: 'text' },
  { value: 'source', label: 'Source', type: 'text' },
  { value: 'current_status', label: 'Status', type: 'text' },
  { value: 'disposition', label: 'Disposition', type: 'text' },
  { value: 'category', label: 'Category', type: 'text' },
  { value: 'created_at', label: 'Created At', type: 'date' },
];

const OPERATORS = [
  { value: 'ilike', label: 'Contains' },
  { value: 'eq', label: 'Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'lt', label: 'Less Than' },
];

// ---------------------------------------------------------------------------
// CRM chrome configuration — additive overlay on top of school-sales-buddy core
// ---------------------------------------------------------------------------
type ViewMode = 'list' | 'kanban' | 'funnel';
type Priority = 'all' | 'P1' | 'P2' | 'P3' | 'P4';

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'P1',  label: 'P1' },
  { value: 'P2',  label: 'P2' },
  { value: 'P3',  label: 'P3' },
  { value: 'P4',  label: 'P4' },
];

/** Buckets used to split the board into columns (Kanban) or stages (Funnel). */
const PIPELINE_STAGES: { key: string; label: string; match: (l: Lead) => boolean }[] = [
  { key: 'new',         label: 'New',         match: l => !l.current_status || l.current_status === 'new' },
  { key: 'contacted',   label: 'Contacted',   match: l => l.category === 'contacted' && l.current_status !== 'Deal closed' && l.current_status !== 'Ready to pay' },
  { key: 'qualified',   label: 'Qualified',   match: l => l.current_status === 'Call back' || l.current_status === 'Ready to join session' },
  { key: 'hot',         label: 'Hot',         match: l => l.current_status === 'Ready to pay' },
  { key: 'won',         label: 'Won',         match: l => l.current_status === 'Deal closed' },
  { key: 'lost',        label: 'Lost',        match: l => !!l.current_status && (l.current_status.includes('Not interested') || l.current_status === 'After session joined not interested') },
];

export default function Leads() {
  const { user, isAdminOrAbove } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // ── NEW CRM chrome state (additive — does not replace anything) ───────────
  const [view, setView] = useState<ViewMode>('list');
  const [priority, setPriority] = useState<Priority>('all');

  // Search + filters
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDisposition, setFilterDisposition] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterFollowUpDate, setFilterFollowUpDate] = useState<Date | undefined>(undefined);
  const [filterOverdue, setFilterOverdue] = useState(false);

  // Advanced filter (single-column)
  const [advColumn, setAdvColumn] = useState('');
  const [advOperator, setAdvOperator] = useState('ilike');
  const [advValue, setAdvValue] = useState('');
  const [advApplied, setAdvApplied] = useState<{ col: string; op: string; val: string } | null>(null);

  // Selection + modals
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [dispositionLeadIdx, setDispositionLeadIdx] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState<string>('50');
  const [page, setPage] = useState(0);

  // ---------- Queries ----------
  const leadsQueryKey = [
    'leads',
    { search, filterSource, filterStatus, filterDisposition, filterOwner,
      filterFollowUpDate: filterFollowUpDate ? formatDate(filterFollowUpDate, 'yyyy-MM-dd') : null,
      filterOverdue, advApplied, pageSize, page, priority,
      role: isAdminOrAbove ? 'admin' : 'employee', userId: user?.id ?? null },
  ];

  const LEADS_QUERY_TIMEOUT_MS = 7000;

  const { data: leadsData, isLoading, isError, error: leadsError, refetch } = useQuery({
    queryKey: leadsQueryKey,
    placeholderData: keepPreviousData,
    // React Query's defaults would retry a hung request 3 times — that turns a
    // 7 s timeout into a ~30 s spinner trap. One retry is plenty.
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Leads] 📥 Fetching leads — key:', leadsQueryKey[1]);
      let query = supabase
        .from('leads')
        .select(
          'id, name, phone, email, source, assigned_to, current_status, disposition, category, latest_disposition, created_at, custom_fields',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });

      if (!isAdminOrAbove && user) query = query.eq('assigned_to', user.id);

      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (filterSource) query = query.eq('source', filterSource);
      if (filterStatus) query = query.eq('current_status', filterStatus);
      if (filterDisposition) query = query.eq('disposition', filterDisposition);
      if (filterOwner) query = query.eq('assigned_to', filterOwner);

      // Priority tab (stored in custom_fields.priority as "P1"/"P2"/"P3"/"P4")
      if (priority !== 'all') {
        query = query.eq('custom_fields->>priority', priority);
      }

      if (filterFollowUpDate) {
        query = query.eq('follow_up_date', formatDate(filterFollowUpDate, 'yyyy-MM-dd'));
      }

      if (filterOverdue) {
        const today = formatDate(new Date(), 'yyyy-MM-dd');
        query = query
          .lt('follow_up_date', today)
          .not('follow_up_date', 'is', null)
          .neq('disposition', 'Deal closed')
          .neq('disposition', 'Not interested (on call)');
      }

      if (advApplied && advApplied.col && advApplied.val) {
        const { col, op, val } = advApplied;
        if (op === 'ilike') query = query.ilike(col, `%${val}%`);
        else if (op === 'eq') query = query.eq(col, val);
        else if (op === 'gt') query = query.gt(col, val);
        else if (op === 'lt') query = query.lt(col, val);
      }

      if (pageSize !== 'all') {
        const size = parseInt(pageSize, 10);
        const from = page * size;
        const to = from + size - 1;
        query = query.range(from, to);
      }

      // Bounded: if the request hangs (missing table, RLS recursion, network
      // hiccup) we reject after LEADS_QUERY_TIMEOUT_MS instead of spinning
      // forever. React Query will then flip isError=true and isLoading=false.
      try {
        const { data, count, error } = await withTimeout(query, LEADS_QUERY_TIMEOUT_MS, 'leads');
        if (error) {
          console.error('[Leads] ❌ supabase error:', error);
          throw error;
        }
        console.log('[Leads] ✅ Leads fetched:', { rows: data?.length ?? 0, total: count ?? 0 });
        return { rows: (data as Lead[]) ?? [], total: count ?? 0 };
      } catch (e) {
        console.error('[Leads] 💥 queryFn threw — surfacing to React Query:', e);
        throw e;
      }
    },
  });

  // ── Component-level kill switch ──────────────────────────────────────────
  // React Query owns `isLoading` — we can't force it false — but we can
  // refuse to keep rendering the skeleton after 3 s. `loadingExpired` flips
  // the body over to the error-state card so the user is NEVER trapped on a
  // spinner, even if React Query, Supabase, or withTimeout all failed us.
  const [loadingExpired, setLoadingExpired] = useState(false);
  useEffect(() => {
    if (!isLoading) { setLoadingExpired(false); return; }
    console.log('[Leads] ⏳ isLoading=true — arming 3 s kill switch');
    const timer = setTimeout(() => {
      console.warn('[Leads] 🛟 KILL SWITCH: isLoading still true after 3 s — forcing error UI');
      setLoadingExpired(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Log whenever the query transitions state so a silent hang is *visible*.
  useEffect(() => {
    if (isError) console.error('[Leads] query state: isError=true, error=', leadsError);
    else if (!isLoading && leadsData) console.log('[Leads] query state: success, rows=', leadsData.rows.length);
  }, [isLoading, isError, leadsData, leadsError]);

  const leads = leadsData?.rows ?? [];
  const totalCount = leadsData?.total ?? 0;

  // ── KPI query: four parallel counts, each with its own hard timeout.
  //    A missing leads table will reject all four identically; the cards
  //    render as 0 and the error state in the body explains why.
  const { data: kpis } = useQuery({
    queryKey: ['lead-kpis', { role: isAdminOrAbove ? 'admin' : 'employee', userId: user?.id ?? null }],
    enabled: !!user,
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      const base = () => {
        let q = supabase.from('leads').select('id', { count: 'exact', head: true });
        if (!isAdminOrAbove && user) q = q.eq('assigned_to', user.id);
        return q;
      };
      const today = formatDate(new Date(), 'yyyy-MM-dd');
      const KPI_TIMEOUT_MS = 5000;

      const countOrZero = async (
        label: string,
        build: () => PromiseLike<{ count: number | null; error: unknown }>,
      ): Promise<number> => {
        try {
          const { count, error } = await withTimeout(build(), KPI_TIMEOUT_MS, label);
          if (error) {
            console.error(`[Leads/kpi:${label}] supabase error:`, error);
            return 0;
          }
          return count ?? 0;
        } catch (e) {
          console.error(`[Leads/kpi:${label}] threw:`, e);
          return 0;
        }
      };

      const [total, won, inProgress, followUps] = await Promise.all([
        countOrZero('total', () => base()),
        countOrZero('won',   () => base().eq('current_status', 'Deal closed')),
        countOrZero('inProgress', () => base()
          .not('current_status', 'in', '("Deal closed","Not interested (on call)","After session joined not interested","new")')
          .not('current_status', 'is', null),
        ),
        countOrZero('followUps', () => base().lte('follow_up_date', today).not('follow_up_date', 'is', null)),
      ]);

      return { total, won, inProgress, followUps };
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['profiles-for-leads'],
    enabled: isAdminOrAbove,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, full_name, email');
      return (data as Employee[]) ?? [];
    },
  });

  const employeeName = useCallback(
    (uid: string | null) => {
      if (!uid) return '—';
      const e = employees.find(e => e.user_id === uid);
      return e?.full_name || e?.email || uid.slice(0, 6);
    },
    [employees],
  );

  // ---------- Mutations ----------
  const refetchLeads = () => {
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['lead-kpis'] });
  };

  const assignLeads = async () => {
    if (!assignTo || selectedLeads.size === 0) return;
    const ids = Array.from(selectedLeads);
    const { error } = await supabase.from('leads').update({ assigned_to: assignTo }).in('id', ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} leads assigned`);
    setSelectedLeads(new Set());
    setAssignTo('');
    refetchLeads();
  };

  /**
   * Bulk-delete every lead currently in `selectedLeads`.
   *
   * Anti-hang contract:
   *   1. Strict try / catch / finally — `setDeleting(false)` is an invariant,
   *      guaranteed to fire even if Supabase throws or the request times out.
   *   2. 8 s timeout fuse via withTimeout() so a hung DELETE (missing table,
   *      RLS recursion, network flap) never leaves the button spinning forever.
   *   3. On success: clear the selection, toast, and refetch both the leads
   *      list AND the KPI counts so the UI is consistent after the write.
   *   4. Diagnostic console breadcrumbs so a future hang leaves a trail.
   */
  const deleteSelected = async () => {
    if (selectedLeads.size === 0) return;
    const ids = Array.from(selectedLeads);
    console.log('[Leads:bulkDelete] 🗑  starting —', ids.length, 'id(s):', ids);
    setDeleting(true);
    try {
      const { error } = await withTimeout(
        supabase.from('leads').delete().in('id', ids),
        8000,
        'bulkDelete',
      );
      if (error) {
        console.error('[Leads:bulkDelete] ❌ supabase error:', error);
        throw error;
      }
      console.log('[Leads:bulkDelete] ✅ deleted', ids.length, 'lead(s)');
      toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} deleted`);
      setSelectedLeads(new Set());
      refetchLeads();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Leads:bulkDelete] 💥 threw:', e);
      toast.error(msg || 'Failed to delete leads');
    } finally {
      // INVARIANT: the button is re-enabled no matter what happened above.
      setDeleting(false);
    }
  };

  const bulkWhatsApp = () => {
    const selected = leads.filter(l => selectedLeads.has(l.id));
    if (selected.length === 0) return;
    if (selected.length > 10) toast.warning('Opening max 10 tabs to avoid browser blocking.');
    selected.slice(0, 10).forEach((lead, i) => {
      const phone = normalizePhoneForWa(lead.phone);
      setTimeout(() => {
        window.open(`https://wa.me/${phone}?text=Hello ${encodeURIComponent(lead.name)}`, '_blank');
      }, i * 500);
    });
  };

  // ---------- Helpers ----------
  const toggleSelect = (id: string) => {
    const next = new Set(selectedLeads);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedLeads(next);
  };
  /** Toggle "select every lead currently visible" (the filtered page). */
  const toggleSelectAll = () => {
    if (selectedLeads.size === leads.length) setSelectedLeads(new Set());
    else setSelectedLeads(new Set(leads.map(l => l.id)));
  };
  /** Clear selection. Safe to call when nothing is selected. */
  const deselectAll = () => setSelectedLeads(new Set());
  /**
   * Add (or remove) every lead in one Kanban / Funnel stage to the selection.
   * If every lead in the stage is already selected → deselect them;
   * otherwise → union into the current selection (doesn't clobber other stages).
   */
  const toggleSelectStage = (stageItems: Lead[]) => {
    const ids = stageItems.map(l => l.id);
    const allSelected = ids.length > 0 && ids.every(id => selectedLeads.has(id));
    const next = new Set(selectedLeads);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    setSelectedLeads(next);
  };
  /** Bulk delete with confirm guard — shared by every view. */
  const confirmAndBulkDelete = async () => {
    if (selectedLeads.size === 0) return;
    const ok = window.confirm(`Delete ${selectedLeads.size} lead${selectedLeads.size === 1 ? '' : 's'}? This cannot be undone.`);
    if (!ok) return;
    await deleteSelected();
  };

  const sources = useMemo(() => {
    const s = new Set(leads.map(l => l.source).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [leads]);

  const statusColor = (s: string | null) => {
    if (!s || s === 'new') return 'bg-muted text-muted-foreground';
    if (s === 'Deal closed') return 'bg-accent/20 text-accent';
    if (s.includes('Not interested')) return 'bg-destructive/20 text-destructive';
    return 'bg-primary/10 text-primary';
  };

  const dispositionLead = dispositionLeadIdx !== null ? leads[dispositionLeadIdx] : null;
  const hasNextLead = dispositionLeadIdx !== null && dispositionLeadIdx < leads.length - 1;

  const handleSaveAndNext = () => {
    if (dispositionLeadIdx !== null && dispositionLeadIdx < leads.length - 1) {
      setDispositionLeadIdx(dispositionLeadIdx + 1);
    } else {
      setDispositionLeadIdx(null);
      refetchLeads();
    }
  };

  const clearAllFilters = () => {
    setFilterSource(''); setFilterStatus(''); setFilterDisposition(''); setFilterOwner('');
    setFilterFollowUpDate(undefined); setFilterOverdue(false);
    setAdvApplied(null); setAdvColumn(''); setAdvValue(''); setAdvOperator('ilike');
  };

  const hasActiveFilters =
    filterSource || filterStatus || filterDisposition || filterOwner ||
    filterFollowUpDate || filterOverdue || advApplied;

  const effectivePageSize = pageSize === 'all' ? (totalCount || 1) : parseInt(pageSize, 10);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalCount / effectivePageSize));

  const applyAdvanced = () => {
    if (!advColumn || !advValue) { toast.error('Pick a column and value'); return; }
    setAdvApplied({ col: advColumn, op: advOperator, val: advValue });
    setPage(0);
  };

  // Grouping for Kanban / Funnel views — computed from whatever the current
  // filtered page returned (no extra query, so switching views is instant).
  const stageBuckets = useMemo(() => {
    return PIPELINE_STAGES.map(stage => ({
      ...stage,
      items: leads.filter(stage.match),
    }));
  }, [leads]);

  const funnelMax = Math.max(1, ...stageBuckets.map(s => s.items.length));

  // ---------- Render helpers ----------
  const renderLeadRow = (lead: Lead, idx: number) => (
    <Card
      key={lead.id}
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => navigate(`/leads/${lead.id}`)}
    >
      <CardContent className="flex items-center gap-3 py-3">
        {isAdminOrAbove && (
          <Checkbox
            checked={selectedLeads.has(lead.id)}
            onCheckedChange={() => toggleSelect(lead.id)}
            onClick={e => e.stopPropagation()}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{lead.name}</span>
            <Badge variant="outline" className={statusColor(lead.current_status)}>
              {lead.current_status || 'New'}
            </Badge>
            {lead.custom_fields?.priority && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]">
                {lead.custom_fields.priority}
              </Badge>
            )}
            {isAdminOrAbove && (
              <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                {employeeName(lead.assigned_to)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lead.phone} {lead.source ? `• ${lead.source}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-500/10"
            title="WhatsApp"
            onClick={e => {
              e.stopPropagation();
              window.open(
                `https://wa.me/${normalizePhoneForWa(lead.phone)}?text=Hello ${encodeURIComponent(lead.name)}`,
                '_blank',
              );
            }}
          >
            <MessageCircle className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={e => { e.stopPropagation(); setDispositionLeadIdx(idx); }}
          >
            <Phone className="w-3.5 h-3.5 mr-1" /> Log Call
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderKanbanCard = (lead: Lead, idx: number) => (
    <Card
      key={lead.id}
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/leads/${lead.id}`)}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          {isAdminOrAbove && (
            <Checkbox
              checked={selectedLeads.has(lead.id)}
              onCheckedChange={() => toggleSelect(lead.id)}
              onClick={e => e.stopPropagation()}
              className="mt-0.5"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{lead.name}</p>
            <p className="text-xs text-muted-foreground truncate">{lead.phone}</p>
          </div>
          {lead.custom_fields?.priority && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]">
              {lead.custom_fields.priority}
            </Badge>
          )}
        </div>
        {lead.source && (
          <p className="text-[10px] text-muted-foreground">Source: {lead.source}</p>
        )}
        <div className="flex items-center justify-between pt-1">
          <Badge variant="outline" className={cn('text-[10px]', statusColor(lead.current_status))}>
            {lead.current_status || 'New'}
          </Badge>
          <div className="flex items-center gap-1">
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-green-600 hover:bg-green-500/10"
              onClick={e => {
                e.stopPropagation();
                window.open(`https://wa.me/${normalizePhoneForWa(lead.phone)}?text=Hello ${encodeURIComponent(lead.name)}`, '_blank');
              }}
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7"
              title="Log Call"
              onClick={e => { e.stopPropagation(); setDispositionLeadIdx(idx); }}
            >
              <Phone className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // ---------- KPI cards ----------
  const kpiCards = [
    { key: 'total',      label: 'Total Leads',  value: kpis?.total      ?? totalCount, icon: Users,      color: 'text-primary',     bg: 'bg-primary/10' },
    { key: 'won',        label: 'Won',          value: kpis?.won        ?? 0,          icon: Trophy,     color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { key: 'inProgress', label: 'In Progress',  value: kpis?.inProgress ?? 0,          icon: CircleDot,  color: 'text-blue-500',    bg: 'bg-blue-500/10' },
    { key: 'followUps',  label: 'Follow-ups',   value: kpis?.followUps  ?? 0,          icon: Flame,      color: 'text-amber-500',   bg: 'bg-amber-500/10' },
  ];

  return (
    <div>
      {/* ══════════════════════════════════════════════════════════════════════
          KPI CARDS — must not be removed (see top-of-file directive).
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">{isAdminOrAbove ? 'All Leads' : 'My Leads'}</h1>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {kpiCards.map(k => (
          <Card key={k.key}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', k.bg)}>
                <k.icon className={cn('w-5 h-5', k.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold leading-tight">{k.value.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          VIEW TOGGLES + PRIORITY TABS — must not be removed.
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
          {([
            { v: 'list',   icon: LayoutList,    label: 'List' },
            { v: 'kanban', icon: KanbanSquare,  label: 'Kanban' },
            { v: 'funnel', icon: FunnelIcon,    label: 'Funnel' },
          ] as const).map(({ v, icon: Icon, label }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors',
                view === v
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 ml-1">
          {PRIORITIES.map(p => (
            <button
              key={p.value}
              onClick={() => { setPriority(p.value); setPage(0); }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                priority === p.value
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          FILTER BAR — school-sales-buddy multi-select filters (preserved).
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-muted-foreground" />

        <Select value={filterSource || '_all_'} onValueChange={v => { setFilterSource(v === '_all_' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Sources" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Sources</SelectItem>
            {sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus || '_all_'} onValueChange={v => { setFilterStatus(v === '_all_' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Statuses</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterDisposition || '_all_'} onValueChange={v => { setFilterDisposition(v === '_all_' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All Dispositions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Dispositions</SelectItem>
            {DISPOSITION_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {isAdminOrAbove && (
          <Select value={filterOwner || '_all_'} onValueChange={v => { setFilterOwner(v === '_all_' ? '' : v); setPage(0); }}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All Owners" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Owners</SelectItem>
              <SelectItem value="__unassigned__" disabled>— Owners —</SelectItem>
              {employees.map(e => (
                <SelectItem key={e.user_id} value={e.user_id}>{e.full_name || e.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Advanced filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
              {advApplied ? `Adv: ${advApplied.col}` : 'Filter'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3">
            <h4 className="font-medium text-sm">Advanced Filter</h4>
            <div className="space-y-1.5">
              <Label className="text-xs">Column</Label>
              <Select value={advColumn} onValueChange={setAdvColumn}>
                <SelectTrigger><SelectValue placeholder="Choose column" /></SelectTrigger>
                <SelectContent>
                  {FILTERABLE_COLUMNS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Operator</Label>
              <Select value={advOperator} onValueChange={setAdvOperator}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Value</Label>
              <Input
                type={FILTERABLE_COLUMNS.find(c => c.value === advColumn)?.type === 'date' ? 'date' : 'text'}
                value={advValue}
                onChange={e => setAdvValue(e.target.value)}
                placeholder="Enter value..."
              />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => { setAdvApplied(null); setAdvColumn(''); setAdvValue(''); }}>
                Clear
              </Button>
              <Button size="sm" onClick={applyAdvanced}>Apply</Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Follow-up date picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={filterFollowUpDate ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
            >
              <CalendarIcon className="w-3.5 h-3.5 mr-1" />
              {filterFollowUpDate ? formatDate(filterFollowUpDate, 'MMM d') : 'Follow-up'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={filterFollowUpDate}
              onSelect={d => { setFilterFollowUpDate(d); setPage(0); }}
              initialFocus
            />
            {filterFollowUpDate && (
              <div className="border-t p-2 flex justify-end">
                <Button variant="ghost" size="sm" className="text-xs"
                  onClick={() => { setFilterFollowUpDate(undefined); setPage(0); }}>
                  <X className="w-3 h-3 mr-1" /> Clear
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Overdue toggle */}
        <Button
          variant={filterOverdue ? 'destructive' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => { setFilterOverdue(v => !v); setPage(0); }}
          title="Leads whose follow-up date is in the past and aren't closed/dead"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          Overdue
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllFilters}>
            <X className="w-3 h-3 mr-1" /> Clear all
          </Button>
        )}

        {/* Prominent bulk-delete — only rendered when rows are selected.
            Sits inline with the filter bar so it's always visible at the top
            of the page while making a selection. Uses the same hardened
            confirmAndBulkDelete → deleteSelected path as the toolbars below. */}
        {isAdminOrAbove && selectedLeads.size > 0 && (
          <Button
            size="sm"
            variant="destructive"
            className="h-8 text-xs"
            onClick={confirmAndBulkDelete}
            disabled={deleting}
            title="Delete every lead you've selected"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {deleting
              ? 'Deleting…'
              : `Delete ${selectedLeads.size} Lead${selectedLeads.size === 1 ? '' : 's'}`}
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {totalCount} total • {pageSize === 'all' ? 'Showing all' : `Page ${page + 1}/${totalPages}`}
        </span>

        <Select value={pageSize} onValueChange={v => { setPageSize(v); setPage(0); }}>
          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SELECTION TOOLBAR — Select All / Deselect All visible in EVERY view
          (List, Kanban, Funnel) so bulk-delete works regardless of layout.
         ══════════════════════════════════════════════════════════════════════ */}
      {isAdminOrAbove && leads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={selectedLeads.size === leads.length && leads.length > 0}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-xs font-medium text-muted-foreground">
              {selectedLeads.size === leads.length ? 'Deselect all' : 'Select all'}
              {leads.length > 0 && ` (${leads.length})`}
            </span>
          </label>

          <span className="text-xs text-muted-foreground">
            {selectedLeads.size > 0
              ? `${selectedLeads.size} selected`
              : 'No leads selected'}
          </span>

          {selectedLeads.size > 0 && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={deselectAll}>
                <X className="w-3 h-3 mr-1" /> Clear selection
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs ml-auto"
                onClick={confirmAndBulkDelete}
                disabled={deleting}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {deleting
                  ? 'Deleting…'
                  : `Delete ${selectedLeads.size} Lead${selectedLeads.size === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          BULK ACTION BAR — school-sales-buddy (preserved) + Deselect All.
         ══════════════════════════════════════════════════════════════════════ */}
      {isAdminOrAbove && selectedLeads.size > 0 && (
        <Card className="mb-4">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-3">
            <span className="text-sm font-medium">{selectedLeads.size} selected</span>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="w-full sm:w-60"><SelectValue placeholder="Change Owner..." /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.user_id} value={e.user_id}>{e.full_name || e.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={assignLeads} disabled={!assignTo}>
              <Users className="w-3.5 h-3.5 mr-1" /> Assign
            </Button>
            <Button size="sm" variant="outline" onClick={bulkWhatsApp}>
              <MessageCircle className="w-3.5 h-3.5 mr-1" /> Bulk WhatsApp
            </Button>
            <Button size="sm" variant="destructive" onClick={confirmAndBulkDelete} disabled={deleting}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {deleting
                ? 'Deleting...'
                : `Delete ${selectedLeads.size} Lead${selectedLeads.size === 1 ? '' : 's'}`}
            </Button>
            <Button size="sm" variant="ghost" className="sm:ml-auto" onClick={deselectAll}>
              <X className="w-3.5 h-3.5 mr-1" /> Deselect all
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          BODY: List / Kanban / Funnel
          State priority: ERROR (or kill-switch) > LOADING > EMPTY > views.
         ══════════════════════════════════════════════════════════════════════ */}
      {(isError || (isLoading && loadingExpired)) ? (
        (() => {
          const expired = isLoading && loadingExpired && !isError;
          const missing = !expired && isMissingRelationError(leadsError);
          const msg = expired
            ? `Leads request is still pending after 3 s. The most likely causes are a missing public.leads table, an RLS recursion on profiles, or an unreachable Supabase instance. Check the console for the full breadcrumb trail.`
            : leadsError instanceof Error ? leadsError.message : String(leadsError);
          return (
            <Card className="border-destructive/40">
              <CardContent className="py-10 px-6 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                  {missing ? <Database className="w-6 h-6 text-destructive" /> : <AlertTriangle className="w-6 h-6 text-destructive" />}
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold">
                    {expired ? 'Still loading…' : missing ? 'Leads table not found' : 'Couldn\'t load leads'}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                    {expired
                      ? 'The fetch has been pending for more than 3 seconds. We stopped waiting so you\'re not trapped on a spinner. Retry, or check the console for the full trail.'
                      : missing
                      ? 'The public.leads table doesn\'t exist in this Supabase project yet. Run the setup SQL (in the project docs) in the Supabase SQL Editor — then hit Retry.'
                      : 'Supabase returned an error or the request timed out. The full message is below, and in the browser console.'}
                  </p>
                </div>
                <pre className="text-[11px] bg-muted/40 rounded p-2 max-w-xl mx-auto text-left overflow-auto">
                  {msg}
                </pre>
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setLoadingExpired(false); refetch(); }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-3 py-3">
                <Skeleton className="h-4 w-4 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-8 w-24 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Users className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No leads yet</p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'Nothing matches the current filters. Try clearing them.'
                  : 'Import a CSV from the CSV Upload page or create a lead to get started.'}
              </p>
            </div>
            {hasActiveFilters && (
              <Button size="sm" variant="outline" onClick={clearAllFilters}>
                <X className="w-3.5 h-3.5 mr-1" /> Clear all filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : view === 'list' ? (
        <>
          {/* Select-all lives in the persistent toolbar above — no duplicate here. */}
          <div className="space-y-2">
            {leads.map((lead, idx) => renderLeadRow(lead, idx))}
          </div>

          {pageSize !== 'all' && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0}
                onClick={() => { setPage(p => p - 1); setSelectedLeads(new Set()); }}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1}
                onClick={() => { setPage(p => p + 1); setSelectedLeads(new Set()); }}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      ) : view === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
          {stageBuckets.map(stage => {
            const allStageSelected =
              stage.items.length > 0 && stage.items.every(l => selectedLeads.has(l.id));
            return (
              <div key={stage.key} className="bg-muted/20 border rounded-lg p-2 min-h-40 space-y-2">
                <div className="flex items-center justify-between px-1 py-0.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isAdminOrAbove && stage.items.length > 0 && (
                      <Checkbox
                        checked={allStageSelected}
                        onCheckedChange={() => toggleSelectStage(stage.items)}
                        title={allStageSelected ? 'Deselect stage' : 'Select stage'}
                      />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                      {stage.label}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{stage.items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {stage.items.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground text-center py-4">No leads</p>
                  ) : (
                    stage.items.map(l => renderKanbanCard(l, leads.findIndex(x => x.id === l.id)))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Funnel view */
        <Card>
          <CardContent className="p-4 space-y-2">
            {stageBuckets.map(stage => {
              const pct = Math.round((stage.items.length / funnelMax) * 100);
              const allStageSelected =
                stage.items.length > 0 && stage.items.every(l => selectedLeads.has(l.id));
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  {isAdminOrAbove && (
                    <Checkbox
                      checked={allStageSelected}
                      onCheckedChange={() => toggleSelectStage(stage.items)}
                      disabled={stage.items.length === 0}
                      title={allStageSelected ? 'Deselect stage' : 'Select stage'}
                    />
                  )}
                  <div className="w-24 text-xs font-medium text-muted-foreground shrink-0">
                    {stage.label}
                  </div>
                  <div className="flex-1 h-8 bg-muted/40 rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/80 transition-all flex items-center px-2 text-[11px] font-medium text-primary-foreground"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    >
                      {stage.items.length > 0 && stage.items.length}
                    </div>
                  </div>
                  <div className="w-10 text-right text-xs font-semibold tabular-nums">
                    {stage.items.length}
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground pt-2 border-t mt-3">
              Funnel is computed from the current page's {leads.length} lead{leads.length === 1 ? '' : 's'} — apply filters or raise the page size to widen the slice.
              {isAdminOrAbove && ' Use the checkboxes to bulk-select a stage, then delete from the selection toolbar.'}
            </p>
          </CardContent>
        </Card>
      )}

      {dispositionLead && (
        <DispositionModal
          lead={dispositionLead}
          onClose={() => { setDispositionLeadIdx(null); refetchLeads(); }}
          onSaved={() => { setDispositionLeadIdx(null); refetchLeads(); }}
          onSaveAndNext={handleSaveAndNext}
          hasNext={hasNextLead}
        />
      )}

    </div>
  );
}
