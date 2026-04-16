import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useAttendanceTracker } from '@/hooks/useAttendanceTracker';

/**
 * Compact sidebar widget that shows the current attendance status, the live
 * active-CRM minute counter, and a single Clock In / Clock Out button.
 * Idle-aware pausing is handled inside useAttendanceTracker.
 */
export default function ClockInOutButton() {
  const { today, isClockedIn, activeMinutes, loading, clockIn, clockOut } = useAttendanceTracker();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || loading) return;
    setBusy(true);
    try {
      if (isClockedIn) {
        await clockOut();
        toast.success('Clocked out — sent for admin approval');
      } else {
        await clockIn();
        toast.success('Clocked in — have a great shift');
      }
    } catch (err: any) {
      toast.error(err.message || 'Attendance action failed');
    } finally {
      setBusy(false);
    }
  };

  const hours   = Math.floor(activeMinutes / 60);
  const minutes = activeMinutes % 60;
  const activeLabel = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-2.5 mb-2">
      <div className="flex items-center justify-between text-xs mb-2 px-1">
        <div className="flex items-center gap-1.5 text-sidebar-foreground/70">
          <Clock className="w-3.5 h-3.5" />
          <span>Active CRM</span>
        </div>
        <span className="font-medium text-sidebar-primary-foreground">{activeLabel}</span>
      </div>
      {today?.clock_in && (
        <div className="text-[10px] text-sidebar-foreground/50 px-1 mb-2 flex justify-between">
          <span>In {new Date(today.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {today.clock_out && (
            <span>Out {new Date(today.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
      )}
      <Button
        size="sm"
        variant={isClockedIn ? 'destructive' : 'default'}
        className="w-full h-8"
        onClick={handleClick}
        disabled={busy || loading}
      >
        {isClockedIn
          ? <><LogOut className="w-3.5 h-3.5 mr-1.5" /> Clock Out</>
          : <><LogIn  className="w-3.5 h-3.5 mr-1.5" /> Clock In</>}
      </Button>
    </div>
  );
}
