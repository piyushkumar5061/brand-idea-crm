import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Clock, LogOut, Mail, Database } from 'lucide-react';

/**
 * Shown when a user has successfully authenticated with Supabase Auth but
 * cannot yet access the CRM. Three variants:
 *   - default    → profiles.status = 'pending' (awaiting admin approval)
 *   - suspended  → profiles.status = 'suspended'
 *   - profileMissing → no row in public.profiles (or RLS blocked the SELECT)
 *
 * profileMissing is critical: since useAuth is 100 % DB-driven with no email
 * overrides, a missing/blocked profile row hard-locks the account. The
 * screen surfaces that explicitly so the user knows to fix the schema or
 * RLS, not to wait for a phantom admin approval.
 */
export default function PendingApproval({
  suspended = false,
  profileMissing = false,
}: { suspended?: boolean; profileMissing?: boolean }) {
  const { user, signOut } = useAuth();

  const tone = suspended
    ? 'destructive'
    : profileMissing
    ? 'profile'
    : 'amber';

  const iconBg =
    tone === 'destructive' ? 'bg-destructive/10' :
    tone === 'profile'     ? 'bg-red-500/10'     :
                             'bg-amber-500/10';
  const iconColor =
    tone === 'destructive' ? 'text-destructive' :
    tone === 'profile'     ? 'text-red-600'     :
                             'text-amber-600';
  const Icon = profileMissing ? Database : Clock;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">

        {/* Icon */}
        <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-8 h-8 ${iconColor}`} />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">
            {suspended
              ? 'Account Suspended'
              : profileMissing
              ? 'Profile Not Found'
              : 'Awaiting Approval'}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {suspended ? (
              <>
                Your account (<span className="font-medium text-foreground">{user?.email}</span>) has been suspended.
                Please contact your administrator to reinstate access.
              </>
            ) : profileMissing ? (
              <>
                You are signed in as <span className="font-medium text-foreground">{user?.email}</span>, but no row
                was found in <code className="font-mono text-[11px] bg-muted px-1 rounded">public.profiles</code> for
                your user id. Either the seed migration hasn&apos;t run, or an RLS policy is blocking the SELECT.
              </>
            ) : (
              <>
                Your account (<span className="font-medium text-foreground">{user?.email}</span>) has been
                created and is pending review. You&apos;ll be able to access the CRM as soon as an
                administrator approves your account.
              </>
            )}
          </p>
        </div>

        {/* Info box */}
        <div className={`p-4 rounded-xl text-xs border text-left ${
          suspended
            ? 'bg-destructive/5 border-destructive/20 text-destructive'
            : profileMissing
            ? 'bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400 space-y-1'
            : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
        }`}>
          {suspended ? (
            'Contact your team administrator to re-enable your access.'
          ) : profileMissing ? (
            <>
              <p className="font-semibold">To fix this as an admin, run in the Supabase SQL Editor:</p>
              <pre className="bg-background/60 rounded p-2 text-[10px] overflow-auto whitespace-pre-wrap">{`INSERT INTO public.profiles (user_id, email, role, status)
VALUES ('${user?.id ?? '<your-auth-uid>'}',
        '${user?.email ?? ''}',
        'super_admin',
        'approved')
ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, status = EXCLUDED.status;`}</pre>
              <p>Then sign out and back in.</p>
            </>
          ) : (
            'If you think this is taking too long, reach out to your team administrator.'
          )}
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
