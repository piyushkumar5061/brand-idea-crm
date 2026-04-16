import { useState } from 'react';
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
import { GraduationCap, KeyRound, Mail, ArrowLeft } from 'lucide-react';

type AuthMode = 'password' | 'otp';

export default function Login() {
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Forgot password modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  // -------------------- Handlers --------------------
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { toast.error('Email and password required'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      toast.success('Welcome back!');
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!email.trim()) { toast.error('Enter your email first'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setOtpSent(true);
      toast.success('Check your email for the login code');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) { toast.error('Enter the 6-digit code from your email'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'email',
      });
      if (error) throw error;
      toast.success('Welcome back!');
    } catch (err: any) {
      toast.error(err.message || 'Invalid or expired code');
    } finally {
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
          <Tabs
            value={mode}
            onValueChange={v => {
              setMode(v as AuthMode);
              setOtpSent(false);
              setOtp('');
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
