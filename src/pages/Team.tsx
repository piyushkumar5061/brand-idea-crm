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
import { UserPlus, LogOut, KeyRound, Trash2, Sparkles } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

export default function Team() {
  const { isAdminOrAbove, user } = useAuth();
  const canManage = isAdminOrAbove || user?.email === 'piyushkumar5061@gmail.com';
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

  const fetchTeam = async () => {
    const { data: roles } = await (supabase.from('profiles') as any).select('user_id, role');
    const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email');
    if (roles && profiles) {
      const merged = roles.map(r => {
        const p = profiles.find(p => p.user_id === r.user_id);
        return { user_id: r.user_id, full_name: p?.full_name ?? null, email: p?.email ?? null, role: r.role };
      });
      setMembers(merged);
    }
  };

  useEffect(() => { fetchTeam(); }, []);

  const generatePassword = () => {
    // 12-char password with mixed alphabet + digits + symbols
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
      // No real URL configured — don't fail account creation, just log it.
      console.warn('[onboarding webhook] VITE_N8N_ONBOARDING_WEBHOOK not set; skipping POST', payload);
      return;
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('[onboarding webhook] failed', err);
      // Non-blocking — account is already created.
    }
  };

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
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Fire-and-forget webhook so n8n can dispatch WhatsApp + Email credentials
      await fireOnboardingWebhook({
        email: newEmail,
        phone: newPhone,
        full_name: newName,
        password: newPassword,
        role: newRole,
      });

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

  const roleBadgeColor = (role: string) => {
    if (role === 'super_admin') return 'bg-destructive/10 text-destructive';
    if (role === 'admin') return 'bg-primary/10 text-primary';
    if (role === 'manager') return 'bg-accent/10 text-accent';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team Management</h1>

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
            <Button onClick={createUser} disabled={creating} className="w-full sm:w-auto">
              {creating ? 'Creating...' : 'Create Account'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {members.map(m => {
          const isSelf = m.user_id === user?.id;
          return (
            <Card key={m.user_id}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 justify-between">
                <div>
                  <span className="font-medium text-sm">{m.full_name || 'No name'}</span>
                  <span className="text-xs text-muted-foreground ml-2">{m.email}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
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
                      <Button
                        size="sm" variant="outline"
                        disabled={actionLoading === `force_logout-${m.user_id}`}
                        onClick={() => manageUser('force_logout', m.user_id)}
                        title="Force Logout"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </Button>

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

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive" title="Delete User">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {m.full_name || m.email}?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete the user account and all their data. This cannot be undone.</AlertDialogDescription>
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
      </div>
    </div>
  );
}
