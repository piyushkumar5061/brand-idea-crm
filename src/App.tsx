import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import LandingPage from "@/pages/LandingPage";
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
// Route guards
// ---------------------------------------------------------------------------

/**
 * Renders the public marketing landing page for unauthenticated visitors
 * and silently redirects authenticated users into the CRM at /dashboard.
 * This lets brandideaonline.com serve BOTH marketing and CRM from one domain.
 */
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

/** Gate CRM routes: unauthenticated -> /login, adminOnly violation -> /dashboard. */
function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdminOrAbove } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Allow access if role says admin OR if it's the known admin email (role fetch may lag)
  const hasAdminAccess = isAdminOrAbove || user?.email === 'piyushkumar5061@gmail.com';
  if (adminOnly && !hasAdminAccess) return <Navigate to="/dashboard" replace />;
  return <AppLayout>{children}</AppLayout>;
}

/** Prevent already-signed-in users from hitting /login. */
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<RootRoute />} />
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />

            {/* Private CRM */}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/leads" element={<ProtectedRoute><Leads /></ProtectedRoute>} />
            <Route path="/leads/:id" element={<ProtectedRoute><LeadDetail /></ProtectedRoute>} />
            <Route path="/call-logs" element={<ProtectedRoute><CallLogs /></ProtectedRoute>} />
            <Route path="/upload" element={<ProtectedRoute adminOnly><CsvUpload /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            {/* Fallback: send unknown paths to the public root so marketing visitors aren't dumped on a 404. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
