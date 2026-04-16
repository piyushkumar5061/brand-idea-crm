import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
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
import { Megaphone, MailCheck, Briefcase, Target, MapPin, FileText, Shield } from "lucide-react";

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

/**
 * Component-local escape hatch — if useAuth is STILL reporting loading=true
 * after 3 seconds (shouldn't happen, but defense in depth), we stop rendering
 * the spinner and render children anyway. The auth gate below will still
 * refuse to hand out admin access, so this is safe.
 */
function useHardLoadingCap(active: boolean, ms = 3000): boolean {
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    if (!active) { setCapped(false); return; }
    const t = setTimeout(() => {
      console.warn(`[App] Hard loading cap hit at ${ms}ms — unblocking route render.`);
      setCapped(true);
    }, ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return capped;
}

/**
 * Returns true if the user should bypass the approval gate.
 *
 * TWO independent checks are intentional — either one alone is enough:
 *  1. email match  — works even if the profiles row is missing / RLS-blocked
 *  2. role match   — works even if user.email is undefined (rare OAuth edge case)
 *
 * This ensures the super-admin can NEVER be permanently locked out by a DB issue.
 */
function isAutoApproved(userEmail: string | undefined, role: string | null): boolean {
  const FOUNDER_EMAIL = 'piyushkumar5061@gmail.com';
  return userEmail === FOUNDER_EMAIL || role === 'super_admin';
}

// ---------------------------------------------------------------------------
// RootRoute — public landing page / smart redirect
// ---------------------------------------------------------------------------
function RootRoute() {
  const { user, loading } = useAuth();
  const capped = useHardLoadingCap(loading);
  // Still loading AND the hard cap hasn't fired → spinner.
  // Once capped or loading is false → render. If we're capped without a user
  // just show the landing page (same as logged-out).
  if (loading && !capped) return <LoadingScreen />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

// ---------------------------------------------------------------------------
// ProtectedRoute — single source of truth for CRM access
// ---------------------------------------------------------------------------
/**
 * Access decision matrix:
 *
 *  State                                    │ Result
 *  ─────────────────────────────────────────┼──────────────────────────────
 *  loading = true                           │ spinner (never block early)
 *  no session                               │ → /login
 *  status = 'suspended'                     │ Suspended screen
 *  status = 'approved'                      │ ✅ enter CRM
 *  role   = 'super_admin'  (auto-approved)  │ ✅ enter CRM (bypass)
 *  email  = founder email  (auto-approved)  │ ✅ enter CRM (bypass)
 *  status = 'pending' OR null               │ Awaiting Approval screen
 *    (null = DB timed-out or row missing)   │
 *
 * The suspended check runs BEFORE the auto-approved check so a suspended
 * super_admin still sees the right screen (admin would fix via SQL directly).
 */
function ProtectedRoute({ children, adminOnly = false }: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { user, loading, profileStatus, role, isAdminOrAbove } = useAuth();
  const capped = useHardLoadingCap(loading);

  // ── 1. Still fetching — but bail after 3 s so we NEVER trap on a spinner.
  //      The downstream checks still enforce auth correctly even if we fall
  //      through with incomplete data (no user → /login, no status → pending).
  if (loading && !capped) return <LoadingScreen />;

  // ── 2. No session ────────────────────────────────────────────────────────
  if (!user) return <Navigate to="/login" replace />;

  // ── 3. Suspended — shown even to super_admins (they must fix via SQL) ────
  if (profileStatus === 'suspended') return <PendingApproval suspended />;

  // ── 4. Gate: must be EXPLICITLY 'approved' ─ OR ─ auto-approved role/email
  //      Founder bypass (piyushkumar5061@gmail.com) is handled by isAutoApproved.
  const approved = profileStatus === 'approved' || isAutoApproved(user.email, role);
  if (!approved) return <PendingApproval />;

  // ── 5. Admin-only routes ─────────────────────────────────────────────────
  const hasAdminAccess = isAdminOrAbove || isAutoApproved(user.email, role);
  if (adminOnly && !hasAdminAccess) return <Navigate to="/dashboard" replace />;

  return <AppLayout>{children}</AppLayout>;
}

// ---------------------------------------------------------------------------
// AuthRoute — stop already-logged-in users from seeing /login
// ---------------------------------------------------------------------------
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const capped = useHardLoadingCap(loading);
  if (loading && !capped) return <LoadingScreen />;
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
