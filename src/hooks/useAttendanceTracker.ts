import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';

// If the user has been idle for longer than this window we DON'T tick the
// active-CRM-minute counter. 15 minutes as per spec.
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
// How often we evaluate idleness + push an update to the DB (1 min).
const TICK_INTERVAL_MS  = 60 * 1000;

export interface AttendanceTodayRow {
  id: string;
  user_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: string;
  approval_status: string;
  active_crm_minutes: number;
}

interface UseAttendanceTrackerResult {
  today: AttendanceTodayRow | null;
  isClockedIn: boolean;
  activeMinutes: number;
  loading: boolean;
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Global attendance tracker used by the sidebar button and the Attendance page.
 * - On mount: fetches today's attendance row for the signed-in user.
 * - While clocked in: every minute, if the user was active within the last
 * 15 minutes, increment active_crm_minutes and persist to the DB.
 * - clockOut stamps clock_out and flips approval_status to 'Pending'.
 */
export function useAttendanceTracker(): UseAttendanceTrackerResult {
  const { user } = useAuth();
  const [today, setToday]               = useState<AttendanceTodayRow | null>(null);
  const [loading, setLoading]           = useState(true);
  const [activeMinutes, setActiveMinutes] = useState(0);

  const lastActivityAt = useRef<number>(Date.now());
  const minutesRef     = useRef<number>(0);
  const rowIdRef       = useRef<string | null>(null);
  const clockedInRef   = useRef<boolean>(false);

  const today_iso = format(new Date(), 'yyyy-MM-dd');

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    
    const REFRESH_TIMEOUT_MS = 3000;
    const guarded = new Promise<{ data: unknown | null; error: unknown }>((resolve) => {
      const t = setTimeout(() => {
        resolve({ data: null, error: new Error('attendance_logs fetch timed out') });
      }, REFRESH_TIMEOUT_MS);
      (supabase as any)
        .from('attendance_logs')
        .select('id, user_id, date, clock_in, clock_out, status, approval_status, active_crm_minutes')
        .eq('user_id', user.id)
        .eq('date', today_iso)
        .maybeSingle()
        .then((res: { data: unknown | null; error: unknown }) => {
          clearTimeout(t);
          resolve(res);
        }, (err: unknown) => {
          clearTimeout(t);
          resolve({ data: null, error: err });
        });
    });

    try {
      const { data, error } = await guarded;
      if (data) {
        const row = data as AttendanceTodayRow;
        setToday(row);
        rowIdRef.current     = row.id;
        minutesRef.current   = row.active_crm_minutes ?? 0;
        setActiveMinutes(minutesRef.current);
        clockedInRef.current = !!row.clock_in && !row.clock_out;
      } else {
        setToday(null);
        rowIdRef.current     = null;
        minutesRef.current   = 0;
        setActiveMinutes(0);
        clockedInRef.current = false;
      }
    } catch (e) {
      setToday(null);
      rowIdRef.current     = null;
      clockedInRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [user, today_iso]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const bump = () => { lastActivityAt.current = Date.now(); };
    window.addEventListener('mousemove', bump);
    window.addEventListener('keydown',   bump);
    window.addEventListener('click',     bump);
    window.addEventListener('scroll',    bump, { passive: true });
    return () => {
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('keydown',   bump);
      window.removeEventListener('click',     bump);
      window.removeEventListener('scroll',    bump);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(async () => {
      if (!clockedInRef.current || !rowIdRef.current) return;
      const idle = Date.now() - lastActivityAt.current > IDLE_THRESHOLD_MS;
      if (idle) return;
      minutesRef.current += 1;
      setActiveMinutes(minutesRef.current);
      await (supabase as any)
        .from('attendance_logs')
        .update({ active_crm_minutes: minutesRef.current })
        .eq('id', rowIdRef.current);
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const clockIn = useCallback(async () => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    const { data: existing } = await (supabase as any)
      .from('attendance_logs')
      .select('id, clock_in')
      .eq('user_id', user.id)
      .eq('date', today_iso)
      .maybeSingle();

    if (existing) {
      const { data, error } = await (supabase as any)
        .from('attendance_logs')
        .update({ clock_in: existing.clock_in ?? nowIso, clock_out: null, status: 'Present', approval_status: 'Pending' })
        .eq('id', existing.id)
        .select('id, user_id, date, clock_in, clock_out, status, approval_status, active_crm_minutes')
        .single();
      if (error) throw error;
      setToday(data as AttendanceTodayRow);
      rowIdRef.current     = data.id;
      minutesRef.current   = data.active_crm_minutes ?? 0;
      setActiveMinutes(minutesRef.current);
      clockedInRef.current = true;
      lastActivityAt.current = Date.now();
      return;
    }

    const { data, error } = await (supabase as any)
      .from('attendance_logs')
      .insert({
        user_id: user.id,
        date: today_iso,
        clock_in: nowIso,
        status: 'Present',
        approval_status: 'Pending',
        active_crm_minutes: 0,
      })
      .select('id, user_id, date, clock_in, clock_out, status, approval_status, active_crm_minutes')
      .single();
    if (error) throw error;
    setToday(data as AttendanceTodayRow);
    rowIdRef.current     = data.id;
    minutesRef.current   = 0;
    setActiveMinutes(0);
    clockedInRef.current = true;
    lastActivityAt.current = Date.now();
  }, [user, today_iso]);

  const clockOut = useCallback(async () => {
    if (!rowIdRef.current) {
      await refresh(); 
      return; 
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await (supabase as any)
      .from('attendance_logs')
      .update({
        clock_out: nowIso,
        active_crm_minutes: minutesRef.current,
        approval_status: 'Pending',
      })
      .eq('id', rowIdRef.current) 
      .select('id, user_id, date, clock_in, clock_out, status, approval_status, active_crm_minutes')
      .single();
      
    if (error) throw error;
    
    setToday(data as AttendanceTodayRow);
    clockedInRef.current = false;
  }, [refresh]);

  const isClockedIn = !!today?.clock_in && !today?.clock_out;

  return { today, isClockedIn, activeMinutes, loading, clockIn, clockOut, refresh };
}
