import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { 
  UserPlus, Shield, Settings2, Trash2, ShieldAlert, 
  Search, CheckCircle2, XCircle, LogOut, KeyRound, Sparkles, Clock 
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// --- Types ---
type ProfileStatus = 'pending' | 'approved' | 'suspended';

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: ProfileStatus;
  designation: string | null;
  modules: string[];
}

const MODULE_OPTIONS = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave Management' },
  { id: 'crm', label: 'CRM' },
  { id: 'crm_leads', label: 'CRM Leads' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'projects', label: 'Projects' },
  { id: 'lead_scraper', label: 'Lead Scraper' },
  { id: 'field_visits', label: 'Field Visits' },
  { id: 'reports', label: 'Reports' },
];

export default function Team() {
  const { user, isAdminOrAbove } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // --- Modal & Form States ---
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [tempRole, setTempRole] = useState('employee');
  const [tempDesignation, setTempDesignation] = useState('');
  const [tempModules, setTempModules] = useState<string[]>([]);
  
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('employee');
  
  const [isSaving, setIsSaving] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // --- Data Fetching ---
  const fetchTeam = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, role, status, designation, modules')
      .order('status', { ascending: true }) // pending first
      .order('full_name', { ascending: true });

    if (error) {
      toast.error("Failed to load team: " + error.message);
    } else {
      setMembers(data as TeamMember[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTeam(); }, []);

  // --- Action Handlers ---
  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&';
    const arr = crypto.getRandomValues(new Uint32Array(14));
    const pw = Array.from(arr).map(n => chars[n % chars.length]).join('');
    setNewPassword(pw);
    toast.success('Secure password generated');
  };

  const createUser = async () => {
    if (!newEmail || !newPassword || !newName) { toast.error('Fill all fields'); return; }
    setActionLoading('creating');
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: newEmail, password: newPassword, full_name: newName,
          phone: newPhone || undefined, role: newRole, status: 'approved',
        },
      });
      if (error || data?.error) throw error || new Error(data.error);

      toast.success(`Account created for ${newEmail}`);
      setNewEmail(''); setNewPassword(''); setNewName(''); setNewPhone('');
      fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    } finally { setActionLoading(null); }
  };

  const openManagementModal = (member: TeamMember) => {
    setSelectedMember(member);
    setTempRole(member.role);
    setTempDesignation(member.designation || '');
    setTempModules(member.modules || []);
    setIsManageModalOpen(true);
  };

  const handleSaveModules = async () => {
    if (!selectedMember) return;
    setIsSaving(true);
    
    const { error } = await supabase
      .from('profiles')
      .update({ 
        role: tempRole,
        designation: tempDesignation,
        modules: tempModules 
      })
      .eq('user_id', selectedMember.user_id);

    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success("Permissions updated");
      setIsManageModalOpen(false);
      fetchTeam();
    }
    setIsSaving(false);
  };

  const toggleModule = (moduleId: string) => {
    setTempModules(prev => 
      prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]
    );
  };

  const setUserStatus = async (userId: string, status: ProfileStatus) => {
    setActionLoading(`status-${userId}`);
    const { error } = await supabase.from('profiles').update({ status }).eq('user_id', userId);
    if (error) toast.error(error.message);
    else { toast.success(`Status updated`); fetchTeam(); }
    setActionLoading(null);
  };

  const filteredMembers = useMemo(() => members.filter(m => 
    m.full_name?.toLowerCase().includes(search.toLowerCase()) || 
    m.email?.toLowerCase().includes(search.toLowerCase())
  ), [members, search]);

  const pendingMembers = members.filter(m => m.status === 'pending');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Team Management</h1>

      {/* --- Pending Approval Banner --- */}
      {isAdminOrAbove && pendingMembers.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-600">
              <Clock className="w-4 h-4" /> Pending Approval ({pendingMembers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingMembers.map(m => (
              <div key={m.user_id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                <span className="text-sm font-medium">{m.full_name || m.email}</span>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-emerald-600" onClick={() => setUserStatus(m.user_id, 'approved')}>Approve</Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setUserStatus(m.user_id, 'suspended')}>Reject</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* --- Add Employee Card --- */}
      {isAdminOrAbove && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Add Employee</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input placeholder="Full Name" value={newName} onChange={e => setNewName(e.target.value)} />
            <Input placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            <div className="flex gap-2">
              <Input placeholder="Password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <Button variant="outline" size="icon" onClick={generatePassword}><Sparkles className="w-4 h-4" /></Button>
            </div>
            <Button onClick={createUser} disabled={actionLoading === 'creating'} className="bg-orange-500">Create Account</Button>
          </CardContent>
        </Card>
      )}

      {/* --- Main Team Table --- */}
      <Card>
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search team..." className="pl-9 bg-muted/40" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant="ghost" size="icon" onClick={fetchTeam}><Settings2 className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>NAME</TableHead>
                <TableHead>EMAIL</TableHead>
                <TableHead>DESIGNATION</TableHead>
                <TableHead>ROLE</TableHead>
                <TableHead>STATUS</TableHead>
                <TableHead className="text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((member) => (
                <TableRow key={member.user_id}>
                  <TableCell className="font-medium">{member.full_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>{member.designation || "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{member.role.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>
                    <Badge variant="outline" className={member.status === 'approved' ? 'text-emerald-600 border-emerald-500/30' : 'text-amber-600'}>
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right flex justify-end gap-1">
                    {isAdminOrAbove && (
                      <Button variant="ghost" size="icon" onClick={() => openManagementModal(member)}>
                        <Shield className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* --- Assign Role & Modules Modal --- */}
      <Dialog open={isManageModalOpen} onOpenChange={setIsManageModalOpen}>
        <DialogContent className="max-w-md bg-sidebar border-sidebar-border">
          <DialogHeader><DialogTitle>Assign Role & Modules</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={tempRole} onValueChange={setTempRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Designation</Label>
              <Input value={tempDesignation} onChange={(e) => setTempDesignation(e.target.value)} placeholder="e.g. Sales Executive" />
            </div>
            <div className="space-y-3">
              <Label>Module Access</Label>
              <div className="grid grid-cols-1 gap-2">
                {MODULE_OPTIONS.map((m) => (
                  <div key={m.id} className="flex items-center space-x-3">
                    <Checkbox id={m.id} checked={tempModules.includes(m.id)} onCheckedChange={() => toggleModule(m.id)} />
                    <label htmlFor={m.id} className="text-sm cursor-pointer">{m.label}</label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full bg-orange-500" onClick={handleSaveModules} disabled={isSaving}>
              {isSaving ? "Saving..." : "Assign Role & Modules"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
