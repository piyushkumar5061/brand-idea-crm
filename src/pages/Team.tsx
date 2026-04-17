import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { UserPlus, LogOut, KeyRound, Trash2, Sparkles, CheckCircle2, XCircle, Clock, ShieldAlert } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type ProfileStatus = 'pending' | 'approved' | 'suspended';

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: ProfileStatus;
}

export default function Team() {
  const { isAdminOrAbove, user } = useAuth();
  const canManage = isAdminOrAbove;
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('employee');
  const [creating, setCreating] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchTeam = async () => {
    const { data } = await (supabase
      .from('profiles') as any)
      .select('user_id, full_name, email, role, status')
      .order('status', { ascending: true })   // pending first
      .order('full_name', { ascending: true });

    if (data) {
      setMembers(data as TeamMember[]);
    }
  };

  useEffect(() => { fetchTeam(); }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&';
    const arr = crypto.getRandomValues(new Uint32Array(14));
    const pw = Array.from(arr).map(n => chars[n % chars.length]).join('');
    setNewPassword(pw);
    toast.success('Secure password generated');
  };

  const fireOnboardingWebhook = async (payload: {
    email: string; phone: string; full_name: string; password: string; role: string;
  }) => {
    const url = (import.meta.env.VITE_N8N_ONBOARDING_WEBHOOK as string | undefined)
      || 'https://n8n.example.com/webhook/onboard-employee';
    if (!url || url.includes('example.com')) {
      console.warn('[onboarding webhook] VITE_N8N_ONBOARDING_WEBHOOK not set; skipping POST', payload);
      return;
    }
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (err) {
      console.error('[onboarding webhook] failed', err);
    }
  };

  // ── CRUD actions ──────────────────────────────────────────────────────────

  const createUser = async () => {
    if (!newEmail || !newPassword || !newName) { toast.error('Fill all fields'); return; }
    if (newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: newEmail,
          password: newPassword,
          full_name: newName,
          phone: newPhone || undefined,
          role: newRole,
          // Admin-created accounts skip pending — they're explicitly invited
          status: 'approved',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await fireOnboardingWebhook({ email: newEmail, phone: newPhone, full_name: newName, password: newPassword, role: newRole });

      toast.success(`Account created for ${newEmail} — credentials dispatched`);
      setNewEmail(''); setNewPassword(''); setNewName(''); setNewPhone(''); setNewRole('employee');
      fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    } finally { setCreating(false); }
  };

  const manageUser = async (action: string, userId: string, extra?: Record<string, string>) => {
    setActionLoading(`${action}-${userId}`);
    try {
      const { data, error } = await supabase.functions.invoke('manage-user', {
        body: { action, user_id: userId, ...extra },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data.message || 'Done');
      if (action === 'delete') fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setActionLoading(null);
      setResetPasswordId(null);
      setResetPassword('');
    }
  };

  const changeRole = async (userId: string, role: string) => {
    const { error } = await (supabase.from('profiles') as any).update({ role }).eq('user_id', userId);
    if (error) { toast.error(error.message); return; }
    toast.success('Role updated');
    fetchTeam();
  };

  /**
   * Approve or suspend a user directly on their profiles row.
   * Uses the profiles_update_admin RLS policy (admin or above can update any row).
   */
  const setUserStatus = async (userId: string, status: ProfileStatus, displayName: string) => {
    setActionLoading(`status-${userId}`);
    try {
      const { error } = await (supabase.from('profiles') as any)
        .update({ status })
        .eq('user_id', userId);
      if (error) throw error;

      const label = status === 'approved' ? 'approved' : status === 'suspended' ? 'suspended' : 'set to pending';
      toast.success(`${displayName || 'User'} ${label}`);
      fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Display helpers ────────────────────────────────────────────────────────

  const roleBadgeColor = (role: string) => {
    if (role === 'super_admin') return 'bg-destructive/10 text-destructive';
    if (role === 'admin')       return 'bg-primary/10 text-primary';
    if (role === 'manager')     return 'bg-accent/10 text-accent';
    return 'bg-muted text-muted-foreground';
  };

  const statusBadge = (s: ProfileStatus) => {
    if (s === 'approved')  return { label: 'Approved',  className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' };
    if (s === 'suspended') return { label: 'Suspended', className: 'bg-destructive/10 text-destructive border-destructive/30' };
    return                        { label: 'Pending',   className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' };
  };

  const pendingMembers  = members.filter(m => m.status === 'pending');
  const activeMembers   = members.filter(m => m.status !== 'pending');

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team Management</h1>

      {/* ── Pending Approval Section ──────────────────────────────────────── */}
      {canManage && pendingMembers.length > 0 && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Clock className="w-4 h-4" />
              Pending Approval
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 ml-1">
                {pendingMembers.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These users have signed up but cannot access the CRM until you approve them.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingMembers.map(m => (
              <div
                key={m.user_id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between p-3 bg-background rounded-lg border"
              >
                <div>
                  <span className="font-medium text-sm">{m.full_name || 'No name'}</span>
                  <span className="text-xs text-muted-foreground ml-2">{m.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    disabled={actionLoading === `status-${m.user_id}`}
                    onClick={() => setUserStatus(m.user_id, 'approved', m.full_name || m.email || 'User')}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5"
                    disabled={actionLoading === `status-${m.user_id}`}
                    onClick={() => setUserStatus(m.user_id, 'suspended', m.full_name || m.email || 'User')}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Create New Account ────────────────────────────────────────────── */}
      {canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="w-5 h-5" /> Create Employee Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" placeholder="John Doe" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="john@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone (with country code)</Label>
                <Input id="phone" type="tel" placeholder="+91 98765 43210" value={newPhone} onChange={e => setNewPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="flex gap-2">
                  <Input id="password" type="text" placeholder="Min 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  <Button type="button" variant="outline" size="icon" title="Generate secure password" onClick={generatePassword}>
                    <Sparkles className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Admin-created accounts are automatically <span className="text-emerald-600 font-medium">approved</span> — no manual review needed.
            </p>
            <Button onClick={createUser} disabled={creating} className="w-full sm:w-auto">
              {creating ? 'Creating...' : 'Create Account'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Active / Suspended Members ────────────────────────────────────── */}
      <div className="space-y-2">
        {activeMembers.map(m => {
          const isSelf = m.user_id === user?.id;
          const sb = statusBadge(m.status);
          return (
            <Card key={m.user_id}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 justify-between">
                <div className="flex items-center gap-3">
                  {/* Suspended indicator */}
                  {m.status === 'suspended' && (
                    <ShieldAlert className="w-4 h-4 text-destructive flex-shrink-0" title="Account suspended" />
                  )}
                  <div>
                    <span className="font-medium text-sm">{m.full_name || 'No name'}</span>
                    <span className="text-xs text-muted-foreground ml-2">{m.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status badge */}
                  <Badge variant="outline" className={sb.className}>{sb.label}</Badge>

                  {/* Role selector */}
                  {canManage ? (
                    <Select value={m.role} onValueChange={v => changeRole(m.user_id, v)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="super_admin">Super Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className={roleBadgeColor(m.role)}>{m.role.replace('_', ' ')}</Badge>
                  )}

                  {canManage && !isSelf && (
                    <>
                      {/* Suspend / Reinstate toggle */}
                      {m.status === 'approved' ? (
                        <Button
                          size="sm" variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={actionLoading === `status-${m.user_id}`}
                          title="Suspend user"
                          onClick={() => setUserStatus(m.user_id, 'suspended', m.full_name || m.email || 'User')}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="outline"
                          className="text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                          disabled={actionLoading === `status-${m.user_id}`}
                          title="Reinstate user"
                          onClick={() => setUserStatus(m.user_id, 'approved', m.full_name || m.email || 'User')}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {/* Force logout */}
                      <Button
                        size="sm" variant="outline"
                        disabled={actionLoading === `force_logout-${m.user_id}`}
                        onClick={() => manageUser('force_logout', m.user_id)}
                        title="Force Logout"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </Button>

                      {/* Reset password */}
                      <AlertDialog open={resetPasswordId === m.user_id} onOpenChange={o => { if (!o) { setResetPasswordId(null); setResetPassword(''); } }}>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => setResetPasswordId(m.user_id)} title="Reset Password">
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reset Password for {m.full_name || m.email}</AlertDialogTitle>
                            <AlertDialogDescription>Enter a new password (min 6 chars).</AlertDialogDescription>
                          </AlertDialogHeader>
                          <Input type="password" placeholder="New password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              disabled={resetPassword.length < 6 || actionLoading === `reset_password-${m.user_id}`}
                              onClick={() => manageUser('reset_password', m.user_id, { new_password: resetPassword })}
                            >
                              Reset
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      {/* Delete */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive" title="Delete User">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {m.full_name || m.email}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the user account and all their data. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              disabled={actionLoading === `delete-${m.user_id}`}
                              onClick={() => manageUser('delete', m.user_id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {activeMembers.length === 0 && pendingMembers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No team members yet.</p>
        )}
      </div>
    </div>
  );
}
