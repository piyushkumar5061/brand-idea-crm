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

const ATT_QUERY_TIMEOUT_MS = 5000;

function withAttTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[Attendance:${label}] timed out after ${ATT_QUERY_TIMEOUT_MS}ms`)),
      ATT_QUERY_TIMEOUT_MS,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

function attMissingSchema(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? '';
  return (
    code === '42P01' || code === 'PGRST202' || 
    /relation .* does not exist/i.test(msg) || /timed out/i.test(msg)
  );
}

function AttErrorCard({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void; }) {
  const missing = attMissingSchema(error);
  const msg = error instanceof Error ? error.message : String(error ?? 'Unknown');
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-8 text-center space-y-2">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {missing ? 'Attendance schema missing. Apply migrations in Supabase SQL Editor.' : 'The fetch failed or timed out.'}
        </p>
        <pre className="text-[11px] bg-muted/40 rounded p-2 max-w-xl mx-auto overflow-auto">{msg}</pre>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
      </CardContent>
    </Card>
  );
}

function useAttLoadingKillSwitch(isLoading: boolean, label: string): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!isLoading) { setExpired(false); return; }
    const t = setTimeout(() => setExpired(true), 3000);
    return () => clearTimeout(t);
  }, [isLoading, label]);
  return expired;
}

const STATUS_OPTIONS = [
  'Present', 'Absent', 'Pending Approval', 'Holiday', 'Absconded', 'Leave Requested', 'Leave Approved', 'Week off',
] as const;
type AttendanceStatus = typeof STATUS_OPTIONS[number];

interface AttendanceMasterRow {
  attendance_id: string | null; user_id: string; full_name: string | null; email: string | null;
  date: string; status: string; approval_status: string; clock_in: string | null; clock_out: string | null;
  active_crm_minutes: number; notes: string | null; total_calls: number; connected_calls: number; deals_closed: number;
}

interface EmployeeHistoryRow {
  attendance_id: string | null; user_id: string; date: string; status: string; approval_status: string;
  clock_in: string | null; clock_out: string | null; active_crm_minutes: number; notes: string | null;
  total_calls: number; connected_calls: number; deals_closed: number;
}

interface LeaveRow {
  id: string; user_id: string; start_date: string; end_date: string; reason: string; status: string; created_at: string; reviewed_at: string | null;
}

interface ProfileLite { user_id: string; full_name: string | null; email: string | null; }

const fmtTime = (iso: string | null) => iso ? format(parseISO(iso), 'HH:mm') : '—';
const fmtDuration = (mins: number) => {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Present: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    Absent: 'bg-red-500/10 text-red-600 border-red-500/30',
    'Pending Approval': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    Holiday: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
    Approved: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    Rejected: 'bg-red-500/10 text-red-600 border-red-500/30',
  };
  return map[s] || 'bg-muted text-muted-foreground border-muted-foreground/30';
};

function MonthPicker({ value, onChange, className }: { value: string; onChange: (key: string) => void; className?: string }) {
  const options = useMemo(() => buildMonthOptions(), []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-48 h-9'}><SelectValue placeholder="Select month" /></SelectTrigger>
      <SelectContent className="max-h-80">
        {options?.map(o => <SelectItem key={o?.key} value={o?.key}>{o?.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function buildMonthOptions() {
  return Array.from({ length: 24 }).map((_, i) => {
    const d = subMonths(new Date(), i);
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy'), start: startOfMonth(d), end: endOfMonth(d) };
  });
}

function monthRangeFromKey(key: string) {
  const [y, m] = key.split('-').map(Number);
  const first = new Date(y, (m ?? 1) - 1, 1);
  return { start: startOfMonth(first), end: endOfMonth(first) };
}

const CURRENT_MONTH_KEY = format(new Date(), 'yyyy-MM');

export default function Attendance() {
  const { isAdminOrAbove } = useAuth();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <CalendarDays className="w-6 h-6" /> Attendance & Leave
      </h1>
      {isAdminOrAbove ? <AdminView /> : <EmployeeView />}
    </div>
  );
}

function EmployeeView() {
  const { user } = useAuth();
  const [monthKey, setMonthKey] = useState<string>(CURRENT_MONTH_KEY);
  const { start, end } = useMemo(() => monthRangeFromKey(monthKey), [monthKey]);
  const startIso = format(start, 'yyyy-MM-dd');
  const endIso = format(end, 'yyyy-MM-dd');
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const clampedEnd = isAfter(end, new Date()) ? todayIso : endIso;

  const { data: attendance = [], isLoading, isError, error, refetch } = useQuery<EmployeeHistoryRow[]>({
    queryKey: ['attendance-self', user?.id, startIso, clampedEnd],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await withAttTimeout((supabase as any).rpc('employee_attendance_history', {
        p_user_id: user!.id, p_start: startIso, p_end: clampedEnd,
      }), 'history');
      if (error) throw error;
      return (data as EmployeeHistoryRow[]) ?? [];
    },
  });
  const expired = useAttLoadingKillSwitch(isLoading, 'self');
  const hasData = attendance?.some(a => a?.attendance_id || a?.total_calls > 0);

  return (
    <Tabs defaultValue="attendance">
      <TabsList><TabsTrigger value="attendance">My Attendance</TabsTrigger><TabsTrigger value="leaves">My Leaves</TabsTrigger></TabsList>
      <TabsContent value="attendance" className="mt-4 space-y-4">
        <MonthlySummary rows={attendance} monthLabel={format(start, 'MMMM yyyy')} />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">My Attendance — {format(start, 'MMMM yyyy')}</CardTitle>
            <MonthPicker value={monthKey} onChange={setMonthKey} />
          </CardHeader>
          <CardContent>
            {(isError || (isLoading && expired)) ? <AttErrorCard title="Couldn't load attendance" error={error} onRetry={refetch} /> :
              isLoading ? <Skeleton className="h-40 w-full" /> : !hasData ? <p className="text-center py-10 text-sm">No records found.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Clock In</TableHead><TableHead>Clock Out</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Calls</TableHead></TableRow></TableHeader>
                <TableBody>
                  {attendance?.map(a => (
                    <TableRow key={(a?.attendance_id ?? '') + a?.date}>
                      <TableCell>{a?.date ? format(parseISO(a.date), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>{fmtTime(a?.clock_in)}</TableCell><TableCell>{fmtTime(a?.clock_out)}</TableCell>
                      <TableCell><Badge variant="outline" className={statusBadge(a?.status || '')}>{a?.status}</Badge></TableCell>
                      <TableCell className="text-right">{a?.total_calls ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="leaves" className="mt-4"><EmployeeLeaves /></TabsContent>
    </Tabs>
  );
}

function EmployeeLeaves() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: leaves = [], isLoading, isError, error, refetch } = useQuery<LeaveRow[]>({
    queryKey: ['leave-self', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await withAttTimeout(supabase.from('leave_requests').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }), 'leaves');
      if (error) throw error;
      return (data as LeaveRow[]) ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">My Leave Requests</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Request Leave</Button>
      </CardHeader>
      <CardContent>
        {isError ? <AttErrorCard title="Couldn't load leaves" error={error} onRetry={refetch} /> :
          isLoading ? <Skeleton className="h-40 w-full" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Dates</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {leaves?.map(l => (
                <TableRow key={l?.id}>
                  <TableCell>{l?.start_date && format(parseISO(l.start_date), 'MMM d')} — {l?.end_date && format(parseISO(l.end_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="max-w-xs truncate">{l?.reason}</TableCell>
                  <TableCell><Badge variant="outline" className={statusBadge(l?.status || '')}>{l?.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AdminView() {
  const [monthKey, setMonthKey] = useState<string>(CURRENT_MONTH_KEY);
  return (
    <Tabs defaultValue="master">
      <TabsList><TabsTrigger value="master">Attendance Master</TabsTrigger><TabsTrigger value="bulk">Bulk Update</TabsTrigger><TabsTrigger value="leaves">Leave Requests</TabsTrigger></TabsList>
      <TabsContent value="master" className="mt-4"><AdminMasterTable monthKey={monthKey} setMonthKey={setMonthKey} /></TabsContent>
      <TabsContent value="bulk" className="mt-4"><AdminBulkUpdate /></TabsContent>
      <TabsContent value="leaves" className="mt-4"><AdminLeaveRequests /></TabsContent>
    </Tabs>
  );
}

function AdminMasterTable({ monthKey, setMonthKey }: { monthKey: string; setMonthKey: (k: string) => void }) {
  const { start, end } = useMemo(() => monthRangeFromKey(monthKey), [monthKey]);
  const startIso = format(start, 'yyyy-MM-dd');
  const clampedEnd = isAfter(end, new Date()) ? format(new Date(), 'yyyy-MM-dd') : format(end, 'yyyy-MM-dd');

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery<AttendanceMasterRow[]>({
    queryKey: ['attendance-master', startIso, clampedEnd],
    queryFn: async () => {
      const { data, error } = await withAttTimeout((supabase as any).rpc('admin_attendance_for_range', { p_start: startIso, p_end: clampedEnd }), 'admin_master');
      if (error) throw error;
      return (data as AttendanceMasterRow[]) ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Attendance Master — {format(start, 'MMMM yyyy')}</CardTitle>
        <MonthPicker value={monthKey} onChange={setMonthKey} />
      </CardHeader>
      <CardContent>
        {isError ? <AttErrorCard title="Couldn't load master" error={error} onRetry={refetch} /> :
          isLoading ? <Skeleton className="h-60 w-full" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Calls</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows?.map(r => (
                  <TableRow key={r?.user_id + r?.date}>
                    <TableCell>{r?.date ? format(parseISO(r.date), 'MMM d') : '—'}</TableCell>
                    <TableCell><div>{r?.full_name || '—'}</div><div className="text-xs text-muted-foreground">{r?.email}</div></TableCell>
                    <TableCell><Badge variant="outline" className={statusBadge(r?.status || '')}>{r?.status}</Badge></TableCell>
                    <TableCell className="text-right">{r?.total_calls ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminBulkUpdate() { return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Select an employee and multiple dates in the calendar to bulk apply status.</CardContent></Card>; }
function AdminLeaveRequests() { return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Admin review for pending employee leave requests.</CardContent></Card>; }

function MonthlySummary({ rows, monthLabel }: { rows: SummarizableRow[]; monthLabel: string; }) {
  const summary = useMemo(() => {
    let present = 0; let calls = 0;
    for (const r of rows || []) {
      if (r?.status === 'Present') present += 1;
      calls += Number(r?.total_calls ?? 0);
    }
    return { present, calls };
  }, [rows]);
  return (
    <div className="grid grid-cols-2 gap-3">
      <MiniKpi label="Present Days" value={summary.present} tone="emerald" icon={CalendarCheck} hint={monthLabel} />
      <MiniKpi label="Total Calls" value={summary.calls} tone="blue" icon={Phone} hint={monthLabel} />
    </div>
  );
}

function MiniKpi({ label, value, tone, icon: Icon, hint }: { label: string; value: number | string; tone: string; icon?: any; hint?: string; }) {
  return (
    <Card><CardContent className="pt-4 pb-4">
      <div className="flex justify-between items-start"><p className="text-xs text-muted-foreground">{label}</p><Icon className={`w-4 h-4 text-${tone}-600`} /></div>
      <p className={`text-2xl font-bold text-${tone}-600`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </CardContent></Card>
  );
}
