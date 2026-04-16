import { useState, useMemo, useCallback } from 'react';
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
import {
  Phone, Search, Filter, X, Trash2, ChevronLeft, ChevronRight,
  MessageCircle, Users, SlidersHorizontal, CalendarIcon, AlertTriangle,
} from 'lucide-react';

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

export default function Leads() {
  const { user, isAdminOrAbove } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
  const [pageSize, setPageSize] = useState<string>('50'); // '10'|'50'|'100'|'500'|'all'
  const [page, setPage] = useState(0);

  // ---------- Queries ----------
  const leadsQueryKey = [
    'leads',
    { search, filterSource, filterStatus, filterDisposition, filterOwner,
      filterFollowUpDate: filterFollowUpDate ? formatDate(filterFollowUpDate, 'yyyy-MM-dd') : null,
      filterOverdue, advApplied, pageSize, page,
      role: isAdminOrAbove ? 'admin' : 'employee', userId: user?.id ?? null },
  ];

  const { data: leadsData, isLoading } = useQuery({
    queryKey: leadsQueryKey,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select(
          'id, name, phone, email, source, assigned_to, current_status, disposition, category, latest_disposition, created_at, custom_fields',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });

      if (!isAdminOrAbove && user) query = query.eq('assigned_to', user.id);

      if (search) {
        // OR search on name / phone / email
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (filterSource) query = query.eq('source', filterSource);
      if (filterStatus) query = query.eq('current_status', filterStatus);
      if (filterDisposition) query = query.eq('disposition', filterDisposition);
      if (filterOwner) query = query.eq('assigned_to', filterOwner);

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

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data as Lead[]) ?? [], total: count ?? 0 };
    },
  });

  const leads = leadsData?.rows ?? [];
  const totalCount = leadsData?.total ?? 0;

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
  const refetchLeads = () => queryClient.invalidateQueries({ queryKey: ['leads'] });

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

  const deleteSelected = async () => {
    if (selectedLeads.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedLeads);
    const { error } = await supabase.from('leads').delete().in('id', ids);
    if (error) { toast.error(error.message); setDeleting(false); return; }
    toast.success(`${ids.length} leads deleted`);
    setSelectedLeads(new Set());
    setDeleting(false);
    refetchLeads();
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
  const toggleSelectAll = () => {
    if (selectedLeads.size === leads.length) setSelectedLeads(new Set());
    else setSelectedLeads(new Set(leads.map(l => l.id)));
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

  return (
    <div>
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

      {/* Filter Bar */}
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

      {/* Admin bulk actions */}
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
            <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={deleting}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
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
        <Card><CardContent className="py-12 text-center text-muted-foreground">No leads found</CardContent></Card>
      ) : (
        <>
          {isAdminOrAbove && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <Checkbox
                checked={selectedLeads.size === leads.length && leads.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-xs text-muted-foreground">Select All</span>
            </div>
          )}

          <div className="space-y-2">
            {leads.map((lead, idx) => (
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
                      className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
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
            ))}
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
