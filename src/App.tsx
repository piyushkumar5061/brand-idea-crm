import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import LandingPage from "@/pages/LandingPage";
import PendingApproval from "@/pages/PendingApproval";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import LeadDetail from "@/pages/LeadDetail";
import CallLogs from "@/pages/CallLogs";
import CsvUpload from "@/pages/CsvUpload";
import Team from "@/pages/Team";
import Reports from "@/pages/Reports";
import Attendance from "@/pages/Attendance";
import Settings from "@/pages/Settings";
import ComingSoon from "@/pages/ComingSoon";
import { Megaphone, MailCheck, Briefcase, Target, MapPin, FileText, Shield, Sparkles } from "lucide-react";

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// FullScreenLoader
// ---------------------------------------------------------------------------
// The ONLY loading UI shown before auth hydration completes. Every protected
// route funnels through here. No "hard cap" escape hatch — useAuth is
// architecturally bounded (getSession 5 s + profile 5 s = ~10 s worst case),
// so a stuck spinner is no longer a possibility we need to defend against
// in the router.
// ---------------------------------------------------------------------------
function FullScreenLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <Sparkles className="h-8 w-8 animate-pulse text-primary" aria-hidden />
      <p className="text-sm tracking-wide">Loading your workspace…</p>
    </div>
  );
}

/**
 * Auto-approved if the user's DB role is super_admin. 100 % database-driven —
 * no hardcoded email overrides. A super_admin never needs a separate
 * profile.status='approved' flag to enter the CRM.
 */
function isAutoApproved(role: string | null): boolean {
  return role === 'super_admin';
}

// ---------------------------------------------------------------------------
// RootRoute — public landing page / smart redirect
// ---------------------------------------------------------------------------
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

// ---------------------------------------------------------------------------
// ProtectedRoute — single source of truth for CRM access
// ---------------------------------------------------------------------------
/**
 * Access decision matrix — evaluated AFTER hydration is complete:
 *
 *  State                                    │ Result
 *  ─────────────────────────────────────────┼──────────────────────────────
 *  loading = true                           │ FullScreenLoader (block)
 *  no session                               │ → /login
 *  status = 'suspended'                     │ Suspended screen
 *  status = 'approved'                      │ ✅ enter CRM
 *  role   = 'super_admin'  (auto-approved)  │ ✅ enter CRM (bypass)
 *  email  = founder email  (auto-approved)  │ ✅ enter CRM (bypass)
 *  status = 'pending' OR null               │ Awaiting Approval screen
 *
 * Because useAuth's `applyAuthState` is atomic, when `loading === false`
 * every field below (user / role / profileStatus) is guaranteed coherent —
 * there is no intermediate render where user is set but role isn't.
 */
function ProtectedRoute({ children, adminOnly = false }: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { user, loading, profileStatus, role, isAdminOrAbove, profileFetched } = useAuth();

  // 1. Block until hydration is 100 % complete. No escape hatch.
  if (loading) return <FullScreenLoader />;

  // 2. No session → login.
  if (!user) return <Navigate to="/login" replace />;

  // 3. Suspended — shown even to super_admins (fixed via SQL).
  if (profileStatus === 'suspended') return <PendingApproval suspended />;

  // 4. Profile row missing / RLS-blocked — distinct screen so the user
  //    knows to fix the schema / RLS, not to wait for an admin approval.
  //    We ONLY hit this branch after profileFetched=true, i.e. the SELECT
  //    actually ran and returned nothing (or errored out).
  if (profileFetched && role === null && profileStatus === null) {
    return <PendingApproval profileMissing />;
  }

  // 5. Approved — DB says so, OR role=super_admin bypasses the status gate.
  const approved = profileStatus === 'approved' || isAutoApproved(role);
  if (!approved) return <PendingApproval />;

  // 6. Admin-only gate.
  if (adminOnly && !isAdminOrAbove) return <Navigate to="/dashboard" replace />;

  return <AppLayout>{children}</AppLayout>;
}

// ---------------------------------------------------------------------------
// AuthRoute — stop already-logged-in users from seeing /login
// ---------------------------------------------------------------------------
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/"      element={<RootRoute />} />
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />

            {/* Protected CRM — requires approved profile */}
            <Route path="/dashboard"  element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/leads"      element={<ProtectedRoute><Leads /></ProtectedRoute>} />
            <Route path="/leads/:id"  element={<ProtectedRoute><LeadDetail /></ProtectedRoute>} />
            <Route path="/call-logs"  element={<ProtectedRoute><CallLogs /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
            <Route path="/settings"   element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            {/* Admin-only CRM */}
            <Route path="/upload"  element={<ProtectedRoute adminOnly><CsvUpload /></ProtectedRoute>} />
            <Route path="/team"    element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />

            {/* Agency modules — placeholder UIs, sidebar-visible */}
            <Route path="/marketing"       element={<ProtectedRoute><ComingSoon title="Marketing" icon={Megaphone} description="Campaigns, social calendars, and content briefs." /></ProtectedRoute>} />
            <Route path="/email-validator" element={<ProtectedRoute><ComingSoon title="Email Validator" icon={MailCheck} description="Bulk-verify outbound lists before a send." /></ProtectedRoute>} />
            <Route path="/projects"        element={<ProtectedRoute><ComingSoon title="Projects" icon={Briefcase} description="Client delivery workspaces and milestones." /></ProtectedRoute>} />
            <Route path="/lead-scraper"    element={<ProtectedRoute><ComingSoon title="Lead Scraper" icon={Target} description="Automated prospect discovery pipeline." /></ProtectedRoute>} />
            <Route path="/field-visits"    element={<ProtectedRoute><ComingSoon title="Field Visits" icon={MapPin} description="On-site check-ins with GPS + photos." /></ProtectedRoute>} />
            <Route path="/invoices"        element={<ProtectedRoute adminOnly><ComingSoon title="Invoices" icon={FileText} description="Generate and track client billing." /></ProtectedRoute>} />
            <Route path="/access-control"  element={<ProtectedRoute adminOnly><ComingSoon title="Access Control" icon={Shield} description="Fine-grained permission management." /></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
