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
  if (loading) return <LoadingScreen />;
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
  const { user, loading, profileStatus, profileFetched, role, isAdminOrAbove } = useAuth();

  // ── 1. Still fetching — never render a gate decision while loading ───────
  if (loading && !profileFetched) return <LoadingScreen />;

  // ── 2. No session ────────────────────────────────────────────────────────
  if (!user) return <Navigate to="/login" replace />;

  // ── 3. Suspended — shown even to super_admins (they must fix via SQL) ────
  if (profileStatus === 'suspended') return <PendingApproval suspended />;

  // ── 4. Gate: must be EXPLICITLY 'approved' ─ OR ─ auto-approved role/email
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
  if (loading) return <LoadingScreen />;
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

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
