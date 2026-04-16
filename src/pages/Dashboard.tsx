import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Phone, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Wraps any promise with a hard timeout. If the promise hasn't resolved by
 * `ms` milliseconds, we return a sentinel error so the caller NEVER hangs.
 *
 * This is the real fix for the "infinite loading spinner" — a Supabase call
 * stuck in flight (RLS recursion, missing table, etc.) used to block the UI
 * forever. Now the worst case is a 6 s wait, then the dashboard renders.
 */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[Dashboard] ${label} timed out after ${ms}ms`)),
      ms,
    );
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

type Stats = {
  totalLeads: number;
  totalCalls: number;
  dealsClosed: number;
  pendingFollowUps: number;
};

export default function Dashboard() {
  const { user, isAdminOrAbove, role } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0, totalCalls: 0, dealsClosed: 0, pendingFollowUps: 0,
  });
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const QUERY_TIMEOUT_MS = 6000;

    const runCount = async (
      label: string,
      build: () => PromiseLike<{ count: number | null; error: unknown }>,
    ): Promise<number> => {
      try {
        const { count, error } = await withTimeout(build(), QUERY_TIMEOUT_MS, label);
        if (error) {
          const msg = (error as { message?: string }).message ?? String(error);
          console.error(`[Dashboard] ${label} error:`, msg);
          if (!cancelled) setErrors((prev) => [...prev, `${label}: ${msg}`]);
          return 0;
        }
        return count ?? 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Dashboard] ${label} threw:`, msg);
        if (!cancelled) setErrors((prev) => [...prev, `${label}: ${msg}`]);
        return 0;
      }
    };

    const fetchStats = async () => {
      setLoading(true);
      setErrors([]);

      // Each query isolated: one failure NEVER blocks the others.
      const results = await Promise.allSettled([
        runCount('leads', () => {
          const q = supabase.from('leads').select('id', { count: 'exact', head: true });
          if (!isAdminOrAbove) q.eq('assigned_to', user.id);
          return q;
        }),
        runCount('call_logs', () => {
          const q = supabase.from('call_logs').select('id', { count: 'exact', head: true });
          if (!isAdminOrAbove) q.eq('called_by', user.id);
          return q;
        }),
        runCount('deals_closed', () => {
          const q = supabase.from('call_logs')
            .select('id', { count: 'exact', head: true })
            .eq('disposition_value', 'Deal closed');
          if (!isAdminOrAbove) q.eq('called_by', user.id);
          return q;
        }),
        runCount('pending_follow_ups', () => {
          const q = supabase.from('call_logs')
            .select('id', { count: 'exact', head: true })
            .gte('follow_up_date', new Date().toISOString().split('T')[0]);
          if (!isAdminOrAbove) q.eq('called_by', user.id);
          return q;
        }),
      ]);

      if (cancelled) return;

      const [leadsR, callsR, closedR, followR] = results;
      setStats({
        totalLeads:       leadsR.status  === 'fulfilled' ? leadsR.value  : 0,
        totalCalls:       callsR.status  === 'fulfilled' ? callsR.value  : 0,
        dealsClosed:      closedR.status === 'fulfilled' ? closedR.value : 0,
        pendingFollowUps: followR.status === 'fulfilled' ? followR.value : 0,
      });
      setLoading(false); // <- always fires, even if all four queries failed.
    };

    fetchStats();
    return () => { cancelled = true; };
  }, [user, isAdminOrAbove]);

  const cards = [
    { label: 'Total Leads',        value: stats.totalLeads,       icon: Users,       color: 'text-primary' },
    { label: 'Total Calls',        value: stats.totalCalls,       icon: Phone,       color: 'text-accent' },
    { label: 'Deals Closed',       value: stats.dealsClosed,      icon: CheckCircle, color: 'text-primary' },
    { label: 'Pending Follow-ups', value: stats.pendingFollowUps, icon: Clock,       color: 'text-destructive' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6 text-sm capitalize">
        Welcome back • {role ? role.replace(/_/g, ' ') : 'Member'}
      </p>

      {errors.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Some stats couldn't load (showing 0 instead):</p>
            <ul className="list-disc list-inside space-y-0.5 opacity-80">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={cn('w-4 h-4', c.color)} />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{c.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
