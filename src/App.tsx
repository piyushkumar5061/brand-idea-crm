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
// Shared loading skeleton used by all route guards
// ---------------------------------------------------------------------------
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

// ---------------------------------------------------------------------------
// RootRoute — public landing page for visitors; redirect to CRM if authed
// ---------------------------------------------------------------------------
/**
 * brandideaonline.com "/" serves dual purpose:
 *   - Unauthenticated visitor  → marketing landing page
 *   - Authenticated employee   → bounce to /dashboard (avoids exposing landing to staff)
 *
 * We bypass the status check here deliberately: an authenticated-but-pending
 * user still gets redirected to /dashboard so ProtectedRoute can show the
 * "Awaiting Approval" screen with a proper sign-out option.
 */
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

// ---------------------------------------------------------------------------
// ProtectedRoute — gate for all CRM routes
// ---------------------------------------------------------------------------
/**
 * Three-layer guard:
 *   1. No session              → /login
 *   2. session + status=pending|suspended → PendingApproval / Suspended page
 *   3. session + status=approved + adminOnly violation → /dashboard
 *
 * Edge-case: profile row missing (trigger lag / schema not applied)
 * - role === null && profileStatus === null after loading → treat as pending
 * - EXCEPT for the known founder email, which bypasses status gate as a
 *   last resort to prevent total lockout if the DB is misconfigured.
 */
function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading, profileStatus, isAdminOrAbove } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  // Founder bypass: if DB is broken and status is null, still let them through
  const isFounder = user.email === 'piyushkumar5061@gmail.com';

  if (!isFounder) {
    if (profileStatus === 'suspended') return <PendingApproval suspended />;
    // null = profile row not yet created or status column missing — safe-fail to pending
    if (profileStatus === 'pending' || profileStatus === null) return <PendingApproval />;
  }

  // adminOnly pages: redirect non-admins to dashboard rather than login
  const hasAdminAccess = isAdminOrAbove || isFounder;
  if (adminOnly && !hasAdminAccess) return <Navigate to="/dashboard" replace />;

  return <AppLayout>{children}</AppLayout>;
}

// ---------------------------------------------------------------------------
// AuthRoute — prevent already-signed-in users from seeing /login
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
            {/* ── Public ────────────────────────────────────────────────── */}
            <Route path="/" element={<RootRoute />} />
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />

            {/* ── Protected CRM ─────────────────────────────────────────── */}
            <Route path="/dashboard"  element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/leads"      element={<ProtectedRoute><Leads /></ProtectedRoute>} />
            <Route path="/leads/:id"  element={<ProtectedRoute><LeadDetail /></ProtectedRoute>} />
            <Route path="/call-logs"  element={<ProtectedRoute><CallLogs /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
            <Route path="/settings"   element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            {/* ── Admin-only CRM ────────────────────────────────────────── */}
            <Route path="/upload"  element={<ProtectedRoute adminOnly><CsvUpload /></ProtectedRoute>} />
            <Route path="/team"    element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />

            {/* ── Fallback: unknown URLs → public root ──────────────────── */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
