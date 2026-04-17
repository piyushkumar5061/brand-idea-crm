import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { GraduationCap, KeyRound, Mail, ArrowLeft, AlertTriangle } from 'lucide-react';

type AuthMode = 'password' | 'otp';

/**
 * Wraps any PromiseLike so it rejects after `ms` instead of hanging forever.
 * Supabase's JS client has been observed to wedge on verifyOtp when the
 * network flaps or the project URL is unreachable — without this, the
 * `finally` block below never runs and the button stays "Verifying…" forever.
 */
const AUTH_TIMEOUT_MS = 10000;
function withAuthTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[auth:${label}] timed out after ${AUTH_TIMEOUT_MS}ms — check your network / Supabase URL.`)),
      AUTH_TIMEOUT_MS,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  /**
   * Inline auth error — rendered above the button in addition to the toast,
   * because toasts disappear and users miss them. This is the surface that
   * tells the user WHY their OTP submit failed.
   */
  const [authError, setAuthError] = useState<string | null>(null);

  // Forgot password modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  // -------------------- Handlers --------------------
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { toast.error('Email and password required'); return; }
    setLoading(true);
    setAuthError(null);
    console.log('[Login] 🔐 Password login started for', email.trim());
    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        'signInWithPassword',
      );
      console.log('[Login] Password login result:', { hasSession: !!data?.session, error });
      if (error) { console.error('[Login] ❌ Password error:', error); throw error; }
      toast.success('Welcome back!');
      // Don't wait for AuthRoute to redirect — do it ourselves so the user
      // lands on /dashboard even if useAuth hydration is slow.
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const msg = err?.message || 'Login failed';
      console.error('[Login] 💥 Password login threw:', err);
      setAuthError(msg);
      toast.error(msg);
    } finally {
      // INVARIANT: button is re-enabled no matter what happens above.
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!email.trim()) { toast.error('Enter your email first'); return; }
    setLoading(true);
    setAuthError(null);
    console.log('[Login] ✉️ signInWithOtp — requesting code for', email.trim());
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: false },
        }),
        'signInWithOtp',
      );
      console.log('[Login] signInWithOtp result — error:', error);
      if (error) { console.error('[Login] ❌ OTP send error:', error); throw error; }
      setOtpSent(true);
      toast.success('Check your email for the login code');
    } catch (err: any) {
      const msg = err?.message || 'Failed to send OTP';
      console.error('[Login] 💥 signInWithOtp threw:', err);
      setAuthError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) { toast.error('Enter the 6-digit code from your email'); return; }
    console.log('[Login] 🔑 OTP Verification started for', email.trim());
    setLoading(true);
    setAuthError(null);
    try {
      // verifyOtp is the call that has wedged in the wild — 10 s timeout so
      // the button can never be stuck on "Verifying…" forever.
      const { data, error } = await withAuthTimeout(
        supabase.auth.verifyOtp({
          email: email.trim(),
          token: otp.trim(),
          type: 'email',
        }),
        'verifyOtp',
      );
      console.log('[Login] OTP Result:', { hasSession: !!data?.session, userId: data?.user?.id, error });
      if (error) {
        console.error('[Login] ❌ OTP Error:', error);
        throw error;
      }
      if (!data?.session) {
        // Supabase sometimes returns { data:{session:null}, error:null } on a
        // silent rate-limit / config issue. Treat that as a failure so the UI
        // doesn't proceed to a dead redirect.
        const synthetic = new Error('Verification succeeded but no session was returned. Double-check the code or request a new one.');
        console.error('[Login] ❌ OTP verified but no session:', synthetic);
        throw synthetic;
      }
      toast.success('Welcome back!');
      // Explicit navigate — don't rely on AuthRoute's user-redirect fallback.
      // If useAuth is still hydrating, the router-level spinner would otherwise
      // keep the login page visible and the user thinks nothing happened.
      console.log('[Login] ✅ OTP verified — navigating to /dashboard');
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const msg = err?.message || 'Invalid or expired code';
      console.error('[Login] 💥 handleVerifyOtp threw:', err);
      setAuthError(msg);
      toast.error(msg);
    } finally {
      // CRITICAL INVARIANT: regardless of success, failure, timeout, or
      // "no session returned" branch above — the button is always re-enabled
      // so the user can retry without having to reload the page.
      console.log('[Login] 🏁 handleVerifyOtp finally — setLoading(false)');
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) { toast.error('Enter your email'); return; }
    setForgotSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/settings?reset=1`,
      });
      if (error) throw error;
      toast.success('Password reset link sent — check your inbox');
      setForgotOpen(false);
      setForgotEmail('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setForgotSending(false);
    }
  };

  // -------------------- Render --------------------
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Brand Idea CRM</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          {authError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{authError}</span>
            </div>
          )}

          <Tabs
            value={mode}
            onValueChange={v => {
              setMode(v as AuthMode);
              setOtpSent(false);
              setOtp('');
              setAuthError(null);
            }}
          >
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="password" className="gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Password
              </TabsTrigger>
              <TabsTrigger value="otp" className="gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email OTP
              </TabsTrigger>
            </TabsList>

            {/* ---------- PASSWORD TAB ---------- */}
            <TabsContent value="password" className="space-y-4">
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>

            {/* ---------- OTP TAB ---------- */}
            <TabsContent value="otp" className="space-y-4">
              {!otpSent ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="otp-email">Email</Label>
                    <Input
                      id="otp-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button onClick={handleSendOtp} className="w-full" disabled={loading || !email}>
                    {loading ? 'Sending...' : 'Send login code'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    We'll email you a 6-digit code — no password needed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. Enter it below.
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="otp-code">Verification code</Label>
                    <Input
                      id="otp-code"
                      inputMode="numeric"
                      placeholder="123456"
                      value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      className="tracking-widest text-center text-lg"
                    />
                  </div>
                  <Button onClick={handleVerifyOtp} className="w-full" disabled={loading || otp.length < 6}>
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => { setOtpSent(false); setOtp(''); }}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="w-3 h-3" /> Use a different email
                    </button>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="text-primary hover:underline"
                    >
                      Resend code
                    </button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ---------- Forgot-password modal ---------- */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              Enter your account email. We'll send a secure link to set a new password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              placeholder="you@example.com"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForgotOpen(false)}>Cancel</Button>
            <Button onClick={handleForgotPassword} disabled={forgotSending || !forgotEmail}>
              {forgotSending ? 'Sending...' : 'Send reset link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
