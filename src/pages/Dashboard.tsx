import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Phone, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { user, isAdminOrAbove, role } = useAuth();
  const [stats, setStats] = useState({ totalLeads: 0, totalCalls: 0, dealsClosed: 0, pendingFollowUps: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      setLoading(true);
      try {
        const leadsQuery = supabase.from('leads').select('id', { count: 'exact', head: true });
        if (!isAdminOrAbove) leadsQuery.eq('assigned_to', user.id);
        const { count: totalLeads, error: e1 } = await leadsQuery;
        if (e1) console.error('Leads query error:', e1.message);

        const callsQuery = supabase.from('call_logs').select('id', { count: 'exact', head: true });
        if (!isAdminOrAbove) callsQuery.eq('called_by', user.id);
        const { count: totalCalls, error: e2 } = await callsQuery;
        if (e2) console.error('Calls query error:', e2.message);

        const closedQuery = supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('disposition_value', 'Deal closed');
        if (!isAdminOrAbove) closedQuery.eq('called_by', user.id);
        const { count: dealsClosed, error: e3 } = await closedQuery;
        if (e3) console.error('Closed query error:', e3.message);

        const followUpQuery = supabase.from('call_logs').select('id', { count: 'exact', head: true }).gte('follow_up_date', new Date().toISOString().split('T')[0]);
        if (!isAdminOrAbove) followUpQuery.eq('called_by', user.id);
        const { count: pendingFollowUps, error: e4 } = await followUpQuery;
        if (e4) console.error('FollowUp query error:', e4.message);

        setStats({
          totalLeads: totalLeads ?? 0,
          totalCalls: totalCalls ?? 0,
          dealsClosed: dealsClosed ?? 0,
          pendingFollowUps: pendingFollowUps ?? 0,
        });
      } catch (e) {
        console.error('Dashboard fetch error:', e);
        setStats({ totalLeads: 0, totalCalls: 0, dealsClosed: 0, pendingFollowUps: 0 });
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [user, isAdminOrAbove]);

  const cards = [
    { label: 'Total Leads', value: stats.totalLeads, icon: Users, color: 'text-primary' },
    { label: 'Total Calls', value: stats.totalCalls, icon: Phone, color: 'text-accent' },
    { label: 'Deals Closed', value: stats.dealsClosed, icon: CheckCircle, color: 'text-primary' },
    { label: 'Pending Follow-ups', value: stats.pendingFollowUps, icon: Clock, color: 'text-destructive' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6 text-sm capitalize">Welcome back • {role?.replace('_', ' ')}</p>
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
