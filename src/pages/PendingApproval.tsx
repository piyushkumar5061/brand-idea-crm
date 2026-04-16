import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Clock, LogOut, Mail } from 'lucide-react';

/**
 * Shown when a user has successfully authenticated with Supabase Auth
 * but their profiles.status is still 'pending' or 'suspended'.
 *
 * A super_admin / admin must flip their status to 'approved' via the
 * Team Management page before they can access the CRM.
 */
export default function PendingApproval({ suspended = false }: { suspended?: boolean }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">

        {/* Icon */}
        <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${
          suspended
            ? 'bg-destructive/10'
            : 'bg-amber-500/10'
        }`}>
          <Clock className={`w-8 h-8 ${suspended ? 'text-destructive' : 'text-amber-600'}`} />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">
            {suspended ? 'Account Suspended' : 'Awaiting Approval'}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {suspended ? (
              <>
                Your account (<span className="font-medium text-foreground">{user?.email}</span>) has been suspended.
                Please contact your administrator to reinstate access.
              </>
            ) : (
              <>
                Your account (<span className="font-medium text-foreground">{user?.email}</span>) has been
                created and is pending review. You'll be able to access the CRM as soon as an
                administrator approves your account.
              </>
            )}
          </p>
        </div>

        {/* Info box */}
        <div className={`p-4 rounded-xl text-xs border ${
          suspended
            ? 'bg-destructive/5 border-destructive/20 text-destructive'
            : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
        }`}>
          {suspended
            ? 'Contact your team administrator to re-enable your access.'
            : 'If you think this is taking too long, reach out to your team administrator.'}
        </div>

        {/* Contact hint */}
        <a
          href="mailto:piyushkumar5061@gmail.com"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Mail className="w-4 h-4" /> Contact Administrator
        </a>

        {/* Sign out */}
        <div>
          <Button variant="outline" onClick={signOut} className="gap-2">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>

      </div>
    </div>
  );
}
