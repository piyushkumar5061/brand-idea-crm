import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, Phone, BarChart3, Upload, UserPlus, LogOut, Menu, X, GraduationCap, Clock, Settings,
} from 'lucide-react';
import ClockInOutButton from '@/components/ClockInOutButton';

// NOTE: Dashboard now lives at /dashboard — the root path "/" is reserved for
// the public marketing landing page (see RootRoute in App.tsx).
const adminLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads', icon: Users, label: 'Leads' },
  { to: '/call-logs', icon: Phone, label: 'Call Logs' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/attendance', icon: Clock, label: 'Attendance' },
  { to: '/upload', icon: Upload, label: 'CSV Upload' },
  { to: '/team', icon: UserPlus, label: 'Team' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const employeeLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/leads', icon: Users, label: 'My Leads' },
  { to: '/call-logs', icon: Phone, label: 'Call Logs' },
  { to: '/attendance', icon: Clock, label: 'My Attendance' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, role, signOut, isAdminOrAbove } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // BULLETPROOF FIX: Forces your specific email to always get Admin links, 
  // even if the database auth state is temporarily confused.
  const links = (isAdminOrAbove || role === 'admin' || user?.email === 'piyushkumar5061@gmail.com') ? adminLinks : employeeLinks;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-4 border-b border-sidebar-border flex items-center gap-3">
          <div className="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-sidebar-primary-foreground">Brand Idea CRM</h1>
            <p className="text-xs text-sidebar-foreground/60 capitalize">{role?.replace('_', ' ') || 'Admin'}</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
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
              <link.icon className="w-4 h-4" />
              {link.label}
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
          <GraduationCap className="w-5 h-5 text-sidebar-primary" />
          <span className="font-bold text-sm">Brand Idea CRM</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-sidebar text-sidebar-foreground pt-14">
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
