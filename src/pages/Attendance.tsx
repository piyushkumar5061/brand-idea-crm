import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format, parseISO, startOfMonth, endOfMonth, subMonths, isAfter,
} from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  CalendarDays, CheckCircle2, XCircle, Plus, Pencil, Save, Users2, Wand2, Filter,
  CalendarCheck, Phone, PhoneCall, Trophy, Timer,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared timeout + logging scaffolding
// ---------------------------------------------------------------------------
// Attendance leans on two RPCs and two tables that DIDN'T EXIST in the new
// Supabase project — a missing relation makes Supabase's JS client hang
// indefinitely, which in turn wedges React Query's `isLoading`. We hard-cap
// every queryFn so the spinner dies within a known budget (5 s per query,
// plus a component-level 3 s kill switch that flips the UI to the error state).
const ATT_QUERY_TIMEOUT_MS = 5000;

function withAttTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[Attendance:${label}] timed out after ${ATT_QUERY_TIMEOUT_MS}ms — the table/RPC may be missing.`)),
      ATT_QUERY_TIMEOUT_MS,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Heuristic — distinguishes "table/RPC missing" from everything else so we
 *  can render a more actionable error state. */
function attMissingSchema(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? '';
  return (
    code === '42P01' ||
    code === 'PGRST202' || // PostgREST "Could not find function in schema"
    /relation .* does not exist/i.test(msg) ||
    /could not find (the )?function/i.test(msg) ||
    /timed out/i.test(msg)
  );
}

/** Tiny inline error card so each tab degrades gracefully. */
function AttErrorCard({ title, error, onRetry }: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const missing = attMissingSchema(error);
  const msg = error instanceof Error ? error.message : String(error ?? 'Unknown');
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-8 text-center space-y-2">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          {missing
            ? 'The Attendance schema (attendance_logs / leave_requests / the two RPCs) looks like it hasn\'t been applied to this Supabase project. Run the brand_idea_attendance.sql migration in the SQL Editor, then retry.'
            : 'The fetch failed or timed out. Check the console for the full breadcrumb trail.'}
        </p>
        <pre className="text-[11px] bg-muted/40 rounded p-2 max-w-xl mx-auto text-left overflow-auto">{msg}</pre>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Arms a 3 s component-level kill switch while `isLoading` is true. Returns
 * `expired=true` when the timer fires so the caller can force-render an
 * error / empty state instead of an eternal skeleton.
 */
function useAttLoadingKillSwitch(isLoading: boolean, label: string): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!isLoading) { setExpired(false); return; }
    console.log(`[Attendance:${label}] ⏳ isLoading=true — arming 3 s kill switch`);
    const t = setTimeout(() => {
      console.warn(`[Attendance:${label}] 🛟 KILL SWITCH — forcing error UI after 3 s`);
      setExpired(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [isLoading, label]);
  return expired;
}

// ---------- status vocabulary ----------
const STATUS_OPTIONS = [
  'Present',
  'Absent',
  'Pending Approval',
  'Holiday',
  'Absconded',
  'Leave Requested',
  'Leave Approved',
  'Week off',
] as const;
type AttendanceStatus = typeof STATUS_OPTIONS[number];

// ---------- types ----------
interface AttendanceMasterRow {
  attendance_id: string | null;
  user_id: string;
  full_name: string | null;
  email: string | null;
  date: string;
  status: string;
  approval_status: string;
  clock_in: string | null;
  clock_out: string | null;
  active_crm_minutes: number;
  notes: string | null;
  total_calls: number;
  connected_calls: number;
  deals_closed: number;
}

interface EmployeeHistoryRow {
  attendance_id: string | null;
  user_id: string;
  date: string;
  status: string;
  approval_status: string;
  clock_in: string | null;
  clock_out: string | null;
  active_crm_minutes: number;
  notes: string | null;
  total_calls: number;
  connected_calls: number;
  deals_closed: number;
}

interface LeaveRow {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

interface ProfileLite {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

// ---------- helpers ----------
const fmtTime = (iso: string | null) =>
  iso ? format(parseISO(iso), 'HH:mm') : '—';

const fmtDuration = (mins: number) => {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Beautiful Tailwind palette per attendance/approval state.
 * Covers the full admin vocabulary + legacy 'Leave' / 'Abscond' rows.
 */
const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    // attendance statuses
    Present:            'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    Absent:             'bg-red-500/10 text-red-600 border-red-500/30',
    'Pending Approval': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    Holiday:            'bg-sky-500/10 text-sky-600 border-sky-500/30',
    Absconded:          'bg-rose-600/15 text-rose-700 border-rose-500/40',
    Abscond:            'bg-rose-600/15 text-rose-700 border-rose-500/40', // legacy
    'Leave Requested':  'bg-violet-500/10 text-violet-600 border-violet-500/30',
    'Leave Approved':   'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
    Leave:              'bg-indigo-500/10 text-indigo-600 border-indigo-500/30', // legacy
    'Week off':         'bg-slate-500/10 text-slate-600 border-slate-500/30',
    // approval statuses
    Approved:           'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    Pending:            'bg-amber-500/10 text-amber-600 border-amber-500/30',
    Rejected:           'bg-red-500/10 text-red-600 border-red-500/30',
  };
  return map[s] || 'bg-muted text-muted-foreground border-muted-foreground/30';
};

// ---------- month picker ----------
/**
 * Builds a list of the last N months (newest first) as { key, label, start, end }
 * suitable for a shadcn <Select>. Keys are 'YYYY-MM' for stability.
 */
const MONTH_OPTIONS_COUNT = 24;

function buildMonthOptions(count = MONTH_OPTIONS_COUNT) {
  const now = new Date();
  return Array.from({ length: count }).map((_, i) => {
    const d = subMonths(now, i);
    const start = startOfMonth(d);
    const end   = endOfMonth(d);
    return {
      key:   format(d, 'yyyy-MM'),
      label: format(d, 'MMMM yyyy'),
      start,
      end,
    };
  });
}

function MonthPicker({
  value, onChange, className,
}: { value: string; onChange: (key: string) => void; className?: string }) {
  const options = useMemo(() => buildMonthOptions(), []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-48 h-9'}>
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {options.map(o => (
          <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function monthRangeFromKey(key: string) {
  // key is 'YYYY-MM'; construct the first-of-month at local midnight.
  const [y, m] = key.split('-').map(Number);
  const first = new Date(y, (m ?? 1) - 1, 1);
  return { start: startOfMonth(first), end: endOfMonth(first) };
}

const CURRENT_MONTH_KEY = format(new Date(), 'yyyy-MM');

// ===========================================================================
// Main page component — routes to Employee or Admin view
// ===========================================================================
export default function Attendance() {
  const { isAdminOrAbove, user } = useAuth();
  const isAdmin = isAdminOrAbove || user?.email === 'piyushkumar5061@gmail.com';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <CalendarDays className="w-6 h-6" /> Attendance & Leave
      </h1>
      {isAdmin ? <AdminView /> : <EmployeeView />}
    </div>
  );
}

// ===========================================================================
// Employee view — uses employee_attendance_history RPC for performance metrics
// ===========================================================================
function EmployeeView() {
  const { user } = useAuth();
  const [monthKey, setMonthKey] = useState<string>(CURRENT_MONTH_KEY);
  const { start, end } = useMemo(() => monthRangeFromKey(monthKey), [monthKey]);
  const startIso = format(start, 'yyyy-MM-dd');
  const endIso   = format(end,   'yyyy-MM-dd');

  // If the user picks a future month, clamp the end date at today so the RPC
  // doesn't emit bogus "future Absent" rows.
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const clampedEnd = isAfter(end, new Date()) ? todayIso : endIso;

  const {
    data: attendance = [],
    isLoading: attLoading,
    isError: attError,
    error: attErrObj,
    refetch: refetchAtt,
  } = useQuery<EmployeeHistoryRow[]>({
    queryKey: ['attendance-self', user?.id, startIso, clampedEnd],
    enabled: !!user,
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Attendance:self] 📥 RPC employee_attendance_history', { user: user?.id, startIso, clampedEnd });
      try {
        const { data, error } = await withAttTimeout(
          (supabase as any).rpc('employee_attendance_history', {
            p_user_id: user!.id,
            p_start: startIso,
            p_end: clampedEnd,
          }),
          'employee_attendance_history',
        );
        if (error) { console.error('[Attendance:self] ❌ rpc error', error); throw error; }
        console.log('[Attendance:self] ✅ rows:', (data as unknown[] | null)?.length ?? 0);
        return (data as EmployeeHistoryRow[]) ?? [];
      } catch (e) {
        console.error('[Attendance:self] 💥 queryFn threw:', e);
        throw e;
      }
    },
  });
  const attExpired = useAttLoadingKillSwitch(attLoading, 'self');

  // An employee's "real" records are days with an attendance_id. Future/empty
  // months still return scaffold rows, so gate the empty-state on whether
  // there's any real activity or call logs.
  const hasRealData = attendance.some(
    a => a.attendance_id || a.total_calls > 0 || a.connected_calls > 0 || a.deals_closed > 0,
  );

  return (
    <Tabs defaultValue="attendance">
      <TabsList>
        <TabsTrigger value="attendance">My Attendance</TabsTrigger>
        <TabsTrigger value="leaves">My Leaves</TabsTrigger>
      </TabsList>

      <TabsContent value="attendance" className="mt-4 space-y-4">
        {/* Monthly Summary — live totals for the selected month */}
        <MonthlySummary
          rows={attendance}
          monthLabel={format(start, 'MMMM yyyy')}
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-lg">My Attendance — {format(start, 'MMMM yyyy')}</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="emp-month" className="text-sm text-muted-foreground">Month</Label>
              <MonthPicker value={monthKey} onChange={setMonthKey} />
            </div>
          </CardHeader>
          <CardContent>
            {(attError || (attLoading && attExpired)) ? (
              <AttErrorCard
                title="Couldn't load your attendance"
                error={attErrObj ?? new Error('Request exceeded 3 s — forcing error UI.')}
                onRetry={() => refetchAtt()}
              />
            ) : attLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !hasRealData ? (
              <div className="py-10 text-center space-y-1">
                <p className="text-sm font-medium">No attendance records found for this month</p>
                <p className="text-xs text-muted-foreground">
                  Pick a different month above, or use the Clock In button in the sidebar to start tracking today.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Connected</TableHead>
                      <TableHead className="text-right">Deals Closed</TableHead>
                      <TableHead>Active CRM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map(a => (
                      <TableRow key={(a.attendance_id ?? '') + a.date}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {format(parseISO(a.date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="tabular-nums">{fmtTime(a.clock_in)}</TableCell>
                        <TableCell className="tabular-nums">{fmtTime(a.clock_out)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusBadge(a.status)}>{a.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.total_calls ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.connected_calls ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.deals_closed ?? 0}</TableCell>
                        <TableCell className="tabular-nums">{fmtDuration(a.active_crm_minutes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="leaves" className="mt-4">
        <EmployeeLeaves />
      </TabsContent>
    </Tabs>
  );
}

function EmployeeLeaves() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [reason, setReason]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    data: leaves = [],
    isLoading,
    isError: leavesError,
    error: leavesErrObj,
    refetch: refetchLeaves,
  } = useQuery<LeaveRow[]>({
    queryKey: ['leave-self', user?.id],
    enabled: !!user,
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Attendance:leaves-self] 📥 SELECT leave_requests for', user?.id);
      try {
        const { data, error } = await withAttTimeout(
          (supabase as any)
            .from('leave_requests')
            .select('id, user_id, start_date, end_date, reason, status, created_at, reviewed_at')
            .eq('user_id', user!.id)
            .order('created_at', { ascending: false }),
          'leave_requests:self',
        );
        if (error) { console.error('[Attendance:leaves-self] ❌', error); throw error; }
        console.log('[Attendance:leaves-self] ✅ rows:', (data as unknown[] | null)?.length ?? 0);
        return (data as LeaveRow[]) ?? [];
      } catch (e) {
        console.error('[Attendance:leaves-self] 💥 threw:', e);
        throw e;
      }
    },
  });
  const leavesExpired = useAttLoadingKillSwitch(isLoading, 'leaves-self');

  const submit = async () => {
    if (!startDate || !endDate || !reason.trim()) { toast.error('All fields are required'); return; }
    if (endDate < startDate) { toast.error('End date must be on or after start date'); return; }
    setSubmitting(true);
    try {
      const { error } = await (supabase as any).from('leave_requests').insert({
        user_id: user!.id, start_date: startDate, end_date: endDate, reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('Leave request submitted');
      setStartDate(''); setEndDate(''); setReason(''); setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['leave-self'] });
    } catch (err: any) { toast.error(err.message || 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    const { error } = await (supabase as any).from('leave_requests').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Request cancelled');
    queryClient.invalidateQueries({ queryKey: ['leave-self'] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">My Leave Requests</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1.5" /> Request Leave</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Leave</DialogTitle>
              <DialogDescription>Submit a leave request for admin approval.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start">Start date</Label>
                  <Input id="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end">End date</Label>
                  <Input id="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason</Label>
                <Textarea id="reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Brief reason for the leave..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Request'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {(leavesError || (isLoading && leavesExpired)) ? (
          <AttErrorCard
            title="Couldn't load leave requests"
            error={leavesErrObj ?? new Error('Request exceeded 3 s — forcing error UI.')}
            onRetry={() => refetchLeaves()}
          />
        ) : isLoading ? <Skeleton className="h-40 w-full" /> : leaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaves.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(parseISO(l.start_date), 'MMM d')} — {format(parseISO(l.end_date), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{l.reason}</TableCell>
                  <TableCell><Badge variant="outline" className={statusBadge(l.status)}>{l.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(parseISO(l.created_at), 'MMM d, HH:mm')}</TableCell>
                  <TableCell>
                    {l.status === 'Pending' && (
                      <Button variant="ghost" size="sm" onClick={() => cancel(l.id)}>Cancel</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Admin view — Master / Bulk Update / Leave Requests
// ===========================================================================
function AdminView() {
  const [monthKey, setMonthKey] = useState<string>(CURRENT_MONTH_KEY);

  return (
    <Tabs defaultValue="master">
      <TabsList>
        <TabsTrigger value="master">Attendance Master</TabsTrigger>
        <TabsTrigger value="bulk">Bulk Update</TabsTrigger>
        <TabsTrigger value="leaves">Leave Requests</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="mt-4 space-y-4">
        <AdminMasterTable monthKey={monthKey} setMonthKey={setMonthKey} />
      </TabsContent>

      <TabsContent value="bulk" className="mt-4">
        <AdminBulkUpdate />
      </TabsContent>

      <TabsContent value="leaves" className="mt-4">
        <AdminLeaveRequests />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Admin: Monthly Master Table + Employee/Status filters
// ---------------------------------------------------------------------------
function AdminMasterTable({
  monthKey, setMonthKey,
}: { monthKey: string; setMonthKey: (k: string) => void }) {
  const queryClient = useQueryClient();
  const [employeeFilter, setEmployeeFilter] = useState<string>('_all_');
  const [statusFilter,   setStatusFilter]   = useState<string>('_all_');

  const { start, end } = useMemo(() => monthRangeFromKey(monthKey), [monthKey]);
  const startIso = format(start, 'yyyy-MM-dd');
  const endIso   = format(end,   'yyyy-MM-dd');

  // Clamp the end of the current/future month to today so the master table
  // doesn't show fake "future Absent" rows for dates that haven't happened.
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const clampedEnd = isAfter(end, new Date()) ? todayIso : endIso;

  const {
    data: rows = [],
    isLoading,
    isError: masterError,
    error: masterErrObj,
    refetch: refetchMaster,
  } = useQuery<AttendanceMasterRow[]>({
    queryKey: ['attendance-master', startIso, clampedEnd],
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Attendance:master] 📥 RPC admin_attendance_for_range', { startIso, clampedEnd });
      try {
        const { data, error } = await withAttTimeout(
          (supabase as any).rpc('admin_attendance_for_range', {
            p_start: startIso,
            p_end:   clampedEnd,
          }),
          'admin_attendance_for_range',
        );
        if (error) { console.error('[Attendance:master] ❌ rpc error', error); throw error; }
        console.log('[Attendance:master] ✅ rows:', (data as unknown[] | null)?.length ?? 0);
        return (data as AttendanceMasterRow[]) ?? [];
      } catch (e) {
        console.error('[Attendance:master] 💥 queryFn threw:', e);
        throw e;
      }
    },
  });
  const masterExpired = useAttLoadingKillSwitch(isLoading, 'master');

  const hasAnyRealData = rows.some(
    r => r.attendance_id || r.total_calls > 0 || r.connected_calls > 0 || r.deals_closed > 0,
  );

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (employeeFilter !== '_all_' && r.user_id !== employeeFilter) return false;
      if (statusFilter   !== '_all_' && r.status !== statusFilter)    return false;
      return true;
    });
  }, [rows, employeeFilter, statusFilter]);

  // Scope label for the monthly-summary hint (e.g. "Team" or a specific employee)
  const scopeLabel = useMemo(() => {
    if (employeeFilter === '_all_') return 'Team total';
    const e = rows.find(r => r.user_id === employeeFilter);
    return e ? (e.full_name || e.email || 'Employee') : 'Employee';
  }, [rows, employeeFilter]);

  const approve = async (id: string) => {
    const { error } = await (supabase as any).from('attendance_logs')
      .update({ approval_status: 'Approved', reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Approved');
    queryClient.invalidateQueries({ queryKey: ['attendance-master'] });
  };

  const reject = async (id: string) => {
    const { error } = await (supabase as any).from('attendance_logs')
      .update({ approval_status: 'Rejected', reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Rejected');
    queryClient.invalidateQueries({ queryKey: ['attendance-master'] });
  };

  // employees list built from the rows (profiles already joined by the RPC).
  // Dedupe by user_id since the month view yields one row per user per day.
  const employeeOptions = useMemo(() => {
    const seen = new Set<string>();
    const uniq: AttendanceMasterRow[] = [];
    for (const r of rows) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      uniq.push(r);
    }
    return uniq.sort(
      (a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''),
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Attendance Master — {format(start, 'MMMM yyyy')}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="att-month" className="text-sm text-muted-foreground">Month</Label>
            <MonthPicker value={monthKey} onChange={setMonthKey} />
          </div>
        </div>
        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Filter className="w-3.5 h-3.5" /> Filters:
          </div>
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-56 h-9"><SelectValue placeholder="All employees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All employees</SelectItem>
              {employeeOptions.map(e => (
                <SelectItem key={e.user_id} value={e.user_id}>{e.full_name || e.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All statuses</SelectItem>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(employeeFilter !== '_all_' || statusFilter !== '_all_') && (
            <Button variant="ghost" size="sm" onClick={() => { setEmployeeFilter('_all_'); setStatusFilter('_all_'); }}>
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live summary — recalculates whenever month/filters change */}
        <MonthlySummary
          rows={filtered}
          monthLabel={format(start, 'MMMM yyyy')}
          scopeLabel={scopeLabel}
        />

        {(masterError || (isLoading && masterExpired)) ? (
          <AttErrorCard
            title="Couldn't load the attendance master"
            error={masterErrObj ?? new Error('Request exceeded 3 s — forcing error UI.')}
            onRetry={() => refetchMaster()}
          />
        ) : isLoading ? <Skeleton className="h-60 w-full" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Calls</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Deals Closed</TableHead>
                  <TableHead>Active CRM</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.user_id + r.date}>
                    <TableCell className="whitespace-nowrap">{format(parseISO(r.date), 'MMM d')}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{r.full_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.clock_in)}</TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.clock_out)}</TableCell>
                    <TableCell><Badge variant="outline" className={statusBadge(r.status)}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_calls ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.connected_calls ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.deals_closed ?? 0}</TableCell>
                    <TableCell className="tabular-nums">{fmtDuration(r.active_crm_minutes)}</TableCell>
                    <TableCell><Badge variant="outline" className={statusBadge(r.approval_status)}>{r.approval_status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.attendance_id && r.approval_status === 'Pending' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approve(r.attendance_id!)} title="Approve">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reject(r.attendance_id!)} title="Reject">
                              <XCircle className="w-4 h-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        <EditRecordDialog row={r} date={r.date} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        No attendance records found for {format(start, 'MMMM yyyy')}
                      </p>
                      <p className="text-xs">
                        {rows.length === 0
                          ? 'Pick a different month above.'
                          : !hasAnyRealData
                            ? 'No team member clocked in this month. Try another month.'
                            : 'No rows match the current filters.'}
                      </p>
                    </div>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin: Bulk calendar update — pick employee + multiple dates + status
// ---------------------------------------------------------------------------
function AdminBulkUpdate() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string>('');
  const [dates, setDates]           = useState<Date[] | undefined>([]);
  const [status, setStatus]         = useState<AttendanceStatus>('Week off');
  const [saving, setSaving]         = useState(false);

  const { data: profiles = [] } = useQuery<ProfileLite[]>({
    queryKey: ['profiles-for-bulk'],
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Attendance:bulk-profiles] 📥');
      try {
        const { data, error } = await withAttTimeout(
          supabase.from('profiles').select('user_id, full_name, email'),
          'profiles',
        );
        if (error) { console.error('[Attendance:bulk-profiles] ❌', error); throw error; }
        return (data as ProfileLite[]) ?? [];
      } catch (e) {
        console.error('[Attendance:bulk-profiles] 💥 threw:', e);
        return [];
      }
    },
  });

  const selectedCount = dates?.length ?? 0;

  const apply = async () => {
    if (!employeeId) { toast.error('Select an employee'); return; }
    if (!dates || dates.length === 0) { toast.error('Pick at least one date'); return; }
    setSaving(true);
    try {
      const rows = dates.map(d => ({
        user_id: employeeId,
        date: format(d, 'yyyy-MM-dd'),
        status,
        // Leave Requested / Pending Approval → keep approval Pending;
        // everything an admin sets in bulk is effectively "Approved".
        approval_status: (status === 'Leave Requested' || status === 'Pending Approval') ? 'Pending' : 'Approved',
        reviewed_at: new Date().toISOString(),
      }));

      const { error } = await (supabase as any)
        .from('attendance_logs')
        .upsert(rows, { onConflict: 'user_id,date' });

      if (error) throw error;

      toast.success(`${rows.length} day${rows.length === 1 ? '' : 's'} updated to "${status}"`);
      setDates([]);
      queryClient.invalidateQueries({ queryKey: ['attendance-master'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-self'] });
    } catch (err: any) {
      toast.error(err.message || 'Bulk update failed');
    } finally {
      setSaving(false);
    }
  };

  const selectedEmployee = profiles.find(p => p.user_id === employeeId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wand2 className="w-5 h-5" /> Bulk Attendance Update
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Quickly mark week-offs, holidays, or corrections for one employee across many dates.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Users2 className="w-3.5 h-3.5" /> Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {profiles
                  .slice()
                  .sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''))
                  .map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status to apply</Label>
            <Select value={status} onValueChange={v => setStatus(v as AttendanceStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Summary</Label>
            <div className="h-10 px-3 flex items-center rounded-md border border-input bg-background text-sm">
              <span className="truncate">
                <span className="font-medium">{selectedCount}</span> day{selectedCount === 1 ? '' : 's'} selected
                {selectedEmployee && <> · <span className="text-muted-foreground">{selectedEmployee.full_name || selectedEmployee.email}</span></>}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border p-2 flex justify-center">
          <Calendar
            mode="multiple"
            selected={dates}
            onSelect={setDates}
            numberOfMonths={2}
            className="pointer-events-auto"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={apply} disabled={saving || !employeeId || selectedCount === 0}>
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? 'Applying...' : `Apply "${status}" to ${selectedCount} day${selectedCount === 1 ? '' : 's'}`}
          </Button>
          {selectedCount > 0 && (
            <Button variant="ghost" onClick={() => setDates([])}>Clear selection</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin: Edit single-row dialog (full status vocabulary)
// ---------------------------------------------------------------------------
function EditRecordDialog({ row, date }: { row: AttendanceMasterRow; date: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus]   = useState(row.status);
  const [approval, setApproval] = useState(row.approval_status);
  const [clockIn, setClockIn]   = useState(row.clock_in ? row.clock_in.slice(0, 16) : '');
  const [clockOut, setClockOut] = useState(row.clock_out ? row.clock_out.slice(0, 16) : '');
  const [mins, setMins]       = useState(row.active_crm_minutes ?? 0);
  const [notes, setNotes]     = useState(row.notes ?? '');
  const [saving, setSaving]   = useState(false);

  const reset = () => {
    setStatus(row.status);
    setApproval(row.approval_status);
    setClockIn(row.clock_in ? row.clock_in.slice(0, 16) : '');
    setClockOut(row.clock_out ? row.clock_out.slice(0, 16) : '');
    setMins(row.active_crm_minutes ?? 0);
    setNotes(row.notes ?? '');
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status,
        approval_status: approval,
        clock_in: clockIn ? new Date(clockIn).toISOString() : null,
        clock_out: clockOut ? new Date(clockOut).toISOString() : null,
        active_crm_minutes: Number(mins) || 0,
        notes: notes || null,
        reviewed_at: new Date().toISOString(),
      };
      if (row.attendance_id) {
        const { error } = await (supabase as any).from('attendance_logs').update(payload).eq('id', row.attendance_id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('attendance_logs').insert({
          ...payload, user_id: row.user_id, date,
        });
        if (error) throw error;
      }
      toast.success('Record saved');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['attendance-master'] });
    } catch (err: any) { toast.error(err.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title="Edit Record"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Attendance — {row.full_name || row.email}</DialogTitle>
          <DialogDescription>{format(parseISO(row.date), 'EEEE, MMM d, yyyy')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Approval</Label>
            <Select value={approval} onValueChange={setApproval}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Pending','Approved','Rejected'].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Clock In</Label>
            <Input type="datetime-local" value={clockIn} onChange={e => setClockIn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Clock Out</Label>
            <Input type="datetime-local" value={clockOut} onChange={e => setClockOut(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Active CRM Minutes</Label>
            <Input type="number" min={0} value={mins} onChange={e => setMins(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional admin note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1.5" /> {saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Admin: Leave requests tab
// ---------------------------------------------------------------------------
function AdminLeaveRequests() {
  const queryClient = useQueryClient();

  const {
    data: leaves = [],
    isLoading,
    isError: adminLeavesError,
    error: adminLeavesErrObj,
    refetch: refetchAdminLeaves,
  } = useQuery<LeaveRow[]>({
    queryKey: ['leave-admin-all'],
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      console.log('[Attendance:leaves-admin] 📥 SELECT leave_requests (all)');
      try {
        const { data, error } = await withAttTimeout(
          (supabase as any)
            .from('leave_requests')
            .select('id, user_id, start_date, end_date, reason, status, created_at, reviewed_at')
            .order('created_at', { ascending: false }),
          'leave_requests:all',
        );
        if (error) { console.error('[Attendance:leaves-admin] ❌', error); throw error; }
        console.log('[Attendance:leaves-admin] ✅ rows:', (data as unknown[] | null)?.length ?? 0);
        return (data as LeaveRow[]) ?? [];
      } catch (e) {
        console.error('[Attendance:leaves-admin] 💥 threw:', e);
        throw e;
      }
    },
  });
  const adminLeavesExpired = useAttLoadingKillSwitch(isLoading, 'leaves-admin');

  const { data: profiles = [] } = useQuery<ProfileLite[]>({
    queryKey: ['profiles-basic'],
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      try {
        const { data } = await withAttTimeout(
          supabase.from('profiles').select('user_id, full_name, email'),
          'profiles-basic',
        );
        return (data as ProfileLite[]) ?? [];
      } catch (e) {
        console.error('[Attendance:profiles-basic] 💥 threw:', e);
        return [];
      }
    },
  });
  const nameFor = (uid: string) => {
    const p = profiles.find(p => p.user_id === uid);
    return p?.full_name || p?.email || uid.slice(0, 6);
  };

  const decide = async (id: string, status: 'Approved' | 'Rejected') => {
    const { error } = await (supabase as any).from('leave_requests')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Leave ${status.toLowerCase()}`);
    queryClient.invalidateQueries({ queryKey: ['leave-admin-all'] });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Leave Requests</CardTitle></CardHeader>
      <CardContent>
        {(adminLeavesError || (isLoading && adminLeavesExpired)) ? (
          <AttErrorCard
            title="Couldn't load leave requests"
            error={adminLeavesErrObj ?? new Error('Request exceeded 3 s — forcing error UI.')}
            onRetry={() => refetchAdminLeaves()}
          />
        ) : isLoading ? <Skeleton className="h-40 w-full" /> : leaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaves.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{nameFor(l.user_id)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(parseISO(l.start_date), 'MMM d')} — {format(parseISO(l.end_date), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="max-w-md"><span className="text-sm text-muted-foreground">{l.reason}</span></TableCell>
                  <TableCell><Badge variant="outline" className={statusBadge(l.status)}>{l.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(parseISO(l.created_at), 'MMM d, HH:mm')}</TableCell>
                  <TableCell className="text-right">
                    {l.status === 'Pending' ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => decide(l.id, 'Approved')}><CheckCircle2 className="w-4 h-4 text-emerald-600" /></Button>
                        <Button size="sm" variant="outline" onClick={() => decide(l.id, 'Rejected')}><XCircle className="w-4 h-4 text-red-600" /></Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Done</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Monthly Summary — totals derived from the currently-rendered rows.
// Shared by Employee "My Attendance" and the Admin "Attendance Master" view
// (when scoped to a single employee via the Employee filter).
// ===========================================================================
interface SummarizableRow {
  status: string;
  active_crm_minutes: number;
  total_calls: number;
  connected_calls: number;
  deals_closed: number;
}

function MonthlySummary({
  rows, monthLabel, scopeLabel,
}: { rows: SummarizableRow[]; monthLabel: string; scopeLabel?: string }) {
  const summary = useMemo(() => {
    let presentDays = 0;
    let totalCalls  = 0;
    let connected   = 0;
    let deals       = 0;
    let activeMins  = 0;
    for (const r of rows) {
      if (r.status === 'Present') presentDays += 1;
      totalCalls += Number(r.total_calls ?? 0);
      connected  += Number(r.connected_calls ?? 0);
      deals      += Number(r.deals_closed ?? 0);
      activeMins += Number(r.active_crm_minutes ?? 0);
    }
    const h = Math.floor(activeMins / 60);
    const m = activeMins % 60;
    const activeLabel = activeMins === 0
      ? '0m'
      : h > 0
        ? `${h}h ${m}m`
        : `${m}m`;
    return { presentDays, totalCalls, connected, deals, activeLabel };
  }, [rows]);

  const hint = scopeLabel ? `${scopeLabel} · ${monthLabel}` : monthLabel;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <MiniKpi
        label="Total Present Days"
        value={summary.presentDays}
        tone="emerald"
        icon={CalendarCheck}
        hint={hint}
      />
      <MiniKpi
        label="Total Calls"
        value={summary.totalCalls}
        tone="blue"
        icon={Phone}
        hint={hint}
      />
      <MiniKpi
        label="Total Connected"
        value={summary.connected}
        tone="sky"
        icon={PhoneCall}
        hint={hint}
      />
      <MiniKpi
        label="Total Deals Closed"
        value={summary.deals}
        tone="indigo"
        icon={Trophy}
        hint={hint}
      />
      <MiniKpi
        label="Total Active Time"
        value={summary.activeLabel}
        tone="violet"
        icon={Timer}
        hint={hint}
      />
    </div>
  );
}

// ---------- mini KPI ----------
type KpiTone = 'emerald' | 'red' | 'amber' | 'blue' | 'indigo' | 'sky' | 'violet' | 'rose';

function MiniKpi({
  label, value, tone, icon: Icon, hint,
}: {
  label: string;
  value: number | string;
  tone: KpiTone;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  const toneMap: Record<KpiTone, string> = {
    emerald: 'text-emerald-600',
    red:     'text-red-600',
    amber:   'text-amber-600',
    blue:    'text-blue-600',
    indigo:  'text-indigo-600',
    sky:     'text-sky-600',
    violet:  'text-violet-600',
    rose:    'text-rose-600',
  };
  const bgMap: Record<KpiTone, string> = {
    emerald: 'bg-emerald-500/10',
    red:     'bg-red-500/10',
    amber:   'bg-amber-500/10',
    blue:    'bg-blue-500/10',
    indigo:  'bg-indigo-500/10',
    sky:     'bg-sky-500/10',
    violet:  'bg-violet-500/10',
    rose:    'bg-rose-500/10',
  };
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon && (
            <span className={`w-7 h-7 rounded-md flex items-center justify-center ${bgMap[tone]}`}>
              <Icon className={`w-3.5 h-3.5 ${toneMap[tone]}`} />
            </span>
          )}
        </div>
        <p className={`text-2xl font-bold ${toneMap[tone]}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}
