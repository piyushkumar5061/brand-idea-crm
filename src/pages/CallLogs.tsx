import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

interface CallLog {
  id: string;
  disposition_category: string;
  disposition_value: string;
  follow_up_date: string | null;
  follow_up_time: string | null;
  notes: string | null;
  created_at: string;
  leads: { name: string; phone: string } | null;
}

export default function CallLogs() {
  const { user, isAdminOrAbove } = useAuth();
  const [logs, setLogs] = useState<CallLog[]>([]);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const query = supabase
        .from('call_logs')
        .select('*, leads(name, phone)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (!isAdminOrAbove) query.eq('called_by', user.id);
      const { data } = await query;
      setLogs((data as any) ?? []);
    };
    fetch();
  }, [user, isAdminOrAbove]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Call Logs</h1>
      {logs.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No call logs yet</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <Card key={log.id}>
              <CardContent className="py-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                  <div>
                    <span className="font-medium text-sm">{log.leads?.name ?? 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground ml-2">{log.leads?.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={log.disposition_category === 'contacted' ? 'bg-primary/10 text-primary' : 'bg-muted'}>
                      {log.disposition_value}
                    </Badge>
                    {log.follow_up_date && (
                      <span className="text-xs text-muted-foreground">
                        Follow-up: {format(new Date(log.follow_up_date), 'MMM d')} {log.follow_up_time?.slice(0,5)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{format(new Date(log.created_at), 'MMM d, h:mm a')}</span>
                  </div>
                </div>
                {log.notes && <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
