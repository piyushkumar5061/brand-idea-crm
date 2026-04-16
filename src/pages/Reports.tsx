import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area,
} from 'recharts';
import { subDays, startOfDay, format } from 'date-fns';
import { ALL_DISPOSITIONS } from '@/lib/dispositions';

type RangeKey = 'today' | '7d' | 'month' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  '7d':  'Last 7 days',
  month: 'Last 30 days',
  all:   'All time',
};

const rangeStart = (r: RangeKey): Date | null => {
  const now = new Date();
  if (r === 'today') return startOfDay(now);
  if (r === '7d')    return startOfDay(subDays(now, 7));
  if (r === 'month') return startOfDay(subDays(now, 30));
  return null; // all
};

interface Employee { user_id: string; full_name: string | null; email: string | null; }
interface CallLog {
  id: string;
  lead_id: string;
  called_by: string;
  disposition_category: 'non_contact' | 'contacted';
  disposition_value: string;
  created_at: string;
}
interface LeadLite { id: string; assigned_to: string | null; created_at: string; }

export default function Reports() {
  const [range, setRange]       = useState<RangeKey>('7d');
  const [employee, setEmployee] = useState<string>('_all_');

  const since = rangeStart(range);

  // --- Employees list for the filter ---
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['profiles-for-reports'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, full_name, email');
      return (data as Employee[]) ?? [];
    },
  });

  const employeeName = (uid: string | null) => {
    if (!uid) return 'Unassigned';
    const e = employees.find(e => e.user_id === uid);
    return e?.full_name || e?.email || uid.slice(0, 6);
  };

  // --- Call logs (with optional range + employee filter) ---
  const { data: callLogs = [], isLoading: logsLoading } = useQuery<CallLog[]>({
    queryKey: ['reports-call-logs', range, employee],
    queryFn: async () => {
      let q = supabase
        .from('call_logs')
        .select('id, lead_id, called_by, disposition_category, disposition_value, created_at')
        .order('created_at', { ascending: true });
      if (since) q = q.gte('created_at', since.toISOString());
      if (employee !== '_all_') q = q.eq('called_by', employee);
      const { data, error } = await q;
      if (error) throw error;
      return (data as CallLog[]) ?? [];
    },
  });

  // --- Leads (for "total assigned" KPI) ---
  const { data: leads = [] } = useQuery<LeadLite[]>({
    queryKey: ['reports-leads', range, employee],
    queryFn: async () => {
      let q = supabase.from('leads').select('id, assigned_to, created_at');
      if (employee !== '_all_') q = q.eq('assigned_to', employee);
      if (since) q = q.gte('created_at', since.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return (data as LeadLite[]) ?? [];
    },
  });

  // ---- Derived metrics ----
  const totalAssigned = leads.length;
  const totalCalls    = callLogs.length;
  const contacted     = callLogs.filter(l => l.disposition_category === 'contacted').length;
  const dealsClosed   = callLogs.filter(l => l.disposition_value === 'Deal closed').length;
  const contactRate   = totalCalls > 0 ? ((contacted / totalCalls) * 100).toFixed(1) : '0';

  // Disposition funnel — count each exact disposition
  const dispositionData = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_DISPOSITIONS.filter(d => d !== 'new').forEach(d => { counts[d] = 0; });
    callLogs.forEach(l => {
      counts[l.disposition_value] = (counts[l.disposition_value] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [callLogs]);

  // Team leaderboard — calls + deals per employee
  const leaderboardData = useMemo(() => {
    const agg: Record<string, { name: string; calls: number; deals: number }> = {};
    callLogs.forEach(l => {
      const key = l.called_by;
      if (!agg[key]) agg[key] = { name: employeeName(key), calls: 0, deals: 0 };
      agg[key].calls += 1;
      if (l.disposition_value === 'Deal closed') agg[key].deals += 1;
    });
    return Object.values(agg).sort((a, b) => b.calls - a.calls);
  }, [callLogs, employees]);

  // Activity over time — calls per day
  const activityData = useMemo(() => {
    const perDay: Record<string, number> = {};
    callLogs.forEach(l => {
      const day = format(new Date(l.created_at), 'MMM d');
      perDay[day] = (perDay[day] || 0) + 1;
    });
    return Object.entries(perDay).map(([name, calls]) => ({ name, calls }));
  }, [callLogs]);

  return (
    <div>
      {/* Header + global filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v: RangeKey) => setRange(v)}>
            <SelectTrigger className="w-40 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map(k => (
                <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger className="w-48 h-9 text-sm">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All employees</SelectItem>
              {employees.map(e => (
                <SelectItem key={e.user_id} value={e.user_id}>{e.full_name || e.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Leads Assigned" value={totalAssigned} />
        <KpiCard label="Total Calls Logged"   value={totalCalls} />
        <KpiCard label="Contact Rate"         value={`${contactRate}%`} />
        <KpiCard label="Deals Closed"         value={dealsClosed} />
      </div>

      {/* Activity Over Time */}
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-lg">Activity Over Time</CardTitle></CardHeader>
        <CardContent>
          {logsLoading ? <Skeleton className="h-[260px] w-full" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="grad-calls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="hsl(220,72%,50%)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(220,72%,50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="hsl(220,72%,50%)" fill="url(#grad-calls)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Disposition Funnel */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Disposition Funnel</CardTitle></CardHeader>
          <CardContent>
            {logsLoading ? <Skeleton className="h-[300px] w-full" /> : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={dispositionData} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                  <XAxis type="number" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" fontSize={11} width={160} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(220,72%,50%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Team Leaderboard */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Team Leaderboard</CardTitle></CardHeader>
          <CardContent>
            {logsLoading ? <Skeleton className="h-[300px] w-full" /> : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={leaderboardData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="calls" name="Calls" fill="hsl(220,72%,50%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="deals" name="Deals Closed" fill="hsl(160,60%,45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
