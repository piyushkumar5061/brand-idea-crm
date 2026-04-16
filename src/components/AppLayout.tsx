import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, Phone, BarChart3, Upload, UserPlus, LogOut, Menu, X,
  Sparkles, Clock, Settings, Megaphone, MailCheck, Briefcase, Target,
  MapPin, FileText, Shield,
} from 'lucide-react';
import ClockInOutButton from '@/components/ClockInOutButton';

const FOUNDER_EMAIL = 'piyushkumar5061@gmail.com';

// ---------------------------------------------------------------------------
// Sidebar link definitions
// ---------------------------------------------------------------------------
// Admins (super_admin / admin / manager) see BOTH the digital-marketing agency
// modules AND the full CRM module set. Grouped for readability.
const adminLinks = [
  // — Core —
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard' },

  // — CRM —
  { to: '/leads',           icon: Users,           label: 'Leads' },
  { to: '/call-logs',       icon: Phone,           label: 'Call Logs' },
  { to: '/attendance',      icon: Clock,           label: 'Attendance' },
  { to: '/upload',          icon: Upload,          label: 'CSV Upload' },

  // — Agency modules —
  { to: '/marketing',       icon: Megaphone,       label: 'Marketing' },
  { to: '/email-validator', icon: MailCheck,       label: 'Email Validator' },
  { to: '/projects',        icon: Briefcase,       label: 'Projects' },
  { to: '/lead-scraper',    icon: Target,          label: 'Lead Scraper' },
  { to: '/field-visits',    icon: MapPin,          label: 'Field Visits' },
  { to: '/invoices',        icon: FileText,        label: 'Invoices' },

  // — Admin —
  { to: '/reports',         icon: BarChart3,       label: 'Reports' },
  { to: '/team',            icon: UserPlus,        label: 'Team' },
  { to: '/access-control',  icon: Shield,          label: 'Access Control' },
  { to: '/settings',        icon: Settings,        label: 'Settings' },
];

const employeeLinks = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads',       icon: Users,           label: 'My Leads' },
  { to: '/call-logs',   icon: Phone,           label: 'Call Logs' },
  { to: '/field-visits',icon: MapPin,          label: 'Field Visits' },
  { to: '/attendance',  icon: Clock,           label: 'My Attendance' },
  { to: '/settings',    icon: Settings,        label: 'Settings' },
];

// ---------------------------------------------------------------------------
// Role badge resolver — NEVER shows the wrong role.
// Order: founder-email override → explicit role → safe fallback.
// ---------------------------------------------------------------------------
function resolveRoleLabel(email: string | undefined, role: string | null): string {
  if (email === FOUNDER_EMAIL) return 'Super Admin';
  if (!role) return 'Member';
  return role.replace(/_/g, ' ');
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, role, signOut, isAdminOrAbove } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Bulletproof: founder email OR any admin+ role sees the full sidebar.
  const isAdmin =
    isAdminOrAbove ||
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'manager' ||
    user?.email === FOUNDER_EMAIL;

  const links = isAdmin ? adminLinks : employeeLinks;
  const roleLabel = resolveRoleLabel(user?.email, role);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-4 border-b border-sidebar-border flex items-center gap-3">
          <div className="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-sidebar-primary-foreground">Brand Idea</h1>
            <p className="text-xs text-sidebar-foreground/60 capitalize">{roleLabel}</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                location.pathname === link.to
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              )}
            >
              <link.icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{link.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <ClockInOutButton />
          <p className="text-xs text-sidebar-foreground/50 mb-2 px-3 truncate">{user?.email}</p>
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar text-sidebar-foreground border-b border-sidebar-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sidebar-primary" />
          <span className="font-bold text-sm">Brand Idea</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-sidebar text-sidebar-foreground pt-14 overflow-y-auto">
          <nav className="p-4 space-y-1">
            {links.map(link => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-lg text-sm',
                  location.pathname === link.to
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/70'
                )}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="p-4 border-t border-sidebar-border">
            <ClockInOutButton />
            <p className="text-xs text-sidebar-foreground/50 mb-2">{user?.email}</p>
            <Button variant="ghost" size="sm" onClick={signOut} className="text-sidebar-foreground/70">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:overflow-y-auto pt-14 md:pt-0">
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
