import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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

// Hard timeout so a hung call_logs query can't freeze the UI.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[CallLogs] ${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export default function CallLogs() {
  const { user, isAdminOrAbove } = useAuth();
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('call_logs')
          .select('*, leads(name, phone)')
          .order('created_at', { ascending: false })
          .limit(200);
        if (!isAdminOrAbove) query = query.eq('called_by', user.id);
        const { data, error: qErr } = await withTimeout(query, 5000, 'select');
        if (cancelled) return;
        if (qErr) {
          console.error('[CallLogs] supabase error:', qErr);
          setError(qErr.message || 'Failed to load call logs');
          setLogs([]);
        } else {
          setLogs((data as unknown as CallLog[]) ?? []);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[CallLogs] threw:', e);
        setError(msg);
        setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [user, isAdminOrAbove, reload]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Call Logs</h1>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-8 px-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
            <div>
              <h3 className="font-semibold">Couldn&apos;t load call logs</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Supabase returned an error or the request timed out. Check the console for details.
              </p>
            </div>
            <pre className="text-[11px] bg-muted/40 rounded p-2 max-w-xl mx-auto text-left overflow-auto">
              {error}
            </pre>
            <Button size="sm" variant="outline" onClick={() => setReload(n => n + 1)}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : logs.length === 0 ? (
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
