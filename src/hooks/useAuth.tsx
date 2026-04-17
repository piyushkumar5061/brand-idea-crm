import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

// ─────────────────────────────────────────────────────────────────────────────
// 100 % DATABASE-DRIVEN
// ─────────────────────────────────────────────────────────────────────────────
// No hardcoded email overrides, no "god-mode" short-circuits. The auth state
// is derived exclusively from:
//   1. supabase.auth.getSession()          → session + user
//   2. public.profiles WHERE user_id = …   → role + status
// If either step fails, role/status stay null — consumers surface that as
// "awaiting approval" / "unauthorized". No silent upgrade to super_admin.
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileData {
  role: AppRole | null;
  status: ProfileStatus | null;
  fetched: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profileStatus: ProfileStatus | null;
  /**
   * True until BOTH getSession AND the profile SELECT have definitively
   * resolved. Never flips to false while a profile fetch is still pending —
   * protected routes block on this, so no "default to Team" flash.
   */
  loading: boolean;
  profileFetched: boolean;
  isAdminOrAbove: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  profileStatus: null,
  loading: true,
  profileFetched: false,
  isAdminOrAbove: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ─────────────────────────────────────────────────────────────────────────────
// Timing budgets. Longer than before — the previous short fuse was racing the
// real DB response on slow networks and masquerading as "auth broken".
// ─────────────────────────────────────────────────────────────────────────────
const GET_SESSION_TIMEOUT_MS   = 5000;
const PROFILE_FETCH_TIMEOUT_MS = 5000;

/** Race a promise against a hard timer — never hangs past `ms`. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[useAuth:${label}] timed out after ${ms}ms`)),
      ms,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Fetch the authenticated user's profile row — SELECT role, status FROM
 * public.profiles WHERE user_id = userId. Never rejects: any failure (RLS,
 * missing table, timeout, exception) resolves to `{role:null, status:null,
 * fetched:true}`. The caller always gets a terminal answer.
 */
async function fetchProfile(userId: string): Promise<ProfileData> {
  console.log('[useAuth] 🔍 fetchProfile — user_id =', userId);
  try {
    const { data, error } = await withTimeout(
      supabase.from('profiles').select('role, status').eq('user_id', userId).maybeSingle(),
      PROFILE_FETCH_TIMEOUT_MS,
      'profiles',
    );
    if (error) {
      console.error('[useAuth] ❌ profiles SELECT error:', error);
      return { role: null, status: null, fetched: true };
    }
    if (!data) {
      console.warn('[useAuth] ⚠️ no profiles row for user_id', userId);
      return { role: null, status: null, fetched: true };
    }
    const r = (data.role   as AppRole       | undefined) ?? null;
    const s = (data.status as ProfileStatus | undefined) ?? null;
    console.info('[useAuth] ✅ profile loaded →', { role: r, status: s });
    return { role: r, status: s, fetched: true };
  } catch (e) {
    console.error('[useAuth] 💥 fetchProfile threw:', e);
    return { role: null, status: null, fetched: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                     = useState<User | null>(null);
  const [session, setSession]               = useState<Session | null>(null);
  const [role, setRole]                     = useState<AppRole | null>(null);
  const [profileStatus, setProfileStatus]   = useState<ProfileStatus | null>(null);
  const [profileFetched, setProfileFetched] = useState(false);
  const [loading, setLoading]               = useState(true);

  const mountedRef = useRef(true);

  /**
   * The ONLY setter path. Writes the DB-returned role/status verbatim.
   * React 18 auto-batches the six setState calls, so every consumer of
   * useAuth() sees a coherent snapshot the moment loading flips to false.
   */
  const applyAuthState = useCallback((
    newSession: Session | null,
    profile: ProfileData,
  ) => {
    if (!mountedRef.current) return;

    setSession(newSession);
    setUser(newSession?.user ?? null);
    setRole(profile.role);
    setProfileStatus(profile.status);
    setProfileFetched(profile.fetched);
    setLoading(false);

    console.log('[useAuth] 🏁 applyAuthState', {
      user: newSession?.user?.email ?? null,
      role: profile.role,
      status: profile.status,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // ── Hydration (on page load / refresh) ──────────────────────────────
    const hydrate = async () => {
      console.log('[useAuth] 🚀 hydrate start');

      // Step 1: who are we?
      let sess: Session | null = null;
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          GET_SESSION_TIMEOUT_MS,
          'getSession',
        );
        if (error) throw error;
        sess = data?.session ?? null;
        console.log('[useAuth] ← getSession', { hasSession: !!sess, email: sess?.user?.email });
      } catch (e) {
        console.error('[useAuth] ❌ getSession failed — treating as logged-out:', e);
        sess = null;
      }

      if (!mountedRef.current) return;

      // Step 2: no session → settle as logged-out.
      if (!sess?.user) {
        applyAuthState(null, { role: null, status: null, fetched: true });
        return;
      }

      // Step 3: fetch the profile BEFORE flipping loading=false.
      // loading stays true through this await — no "default to Team" window.
      const profile = await fetchProfile(sess.user.id);
      if (!mountedRef.current) return;
      applyAuthState(sess, profile);
    };

    // ── Auth events (sign-in, sign-out, token refresh) ──────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mountedRef.current) return;
        console.log('[useAuth] 🔔 auth event', event, newSession?.user?.email);

        // hydrate() owns INITIAL_SESSION; ignoring prevents a double-settle race.
        if (event === 'INITIAL_SESSION') return;

        // Sign-out / session ended → clear.
        if (!newSession?.user) {
          applyAuthState(null, { role: null, status: null, fetched: true });
          return;
        }

        // Signed-in / token-refreshed → fetch the profile before updating.
        // Flip loading=true so protected routes block on the central loader
        // instead of briefly rendering with stale role data.
        setLoading(true);
        setTimeout(async () => {
          const profile = await fetchProfile(newSession.user.id);
          if (!mountedRef.current) return;
          applyAuthState(newSession, profile);
        }, 0);
      },
    );

    hydrate();

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { console.error('[useAuth] signOut threw:', e); }
    if (mountedRef.current) {
      setSession(null);
      setUser(null);
      setRole(null);
      setProfileStatus(null);
    }
    window.location.href = '/login';
  }, []);

  // Derived: strictly from the role column. No email overrides.
  const isAdminOrAbove =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'manager';

  return (
    <AuthContext.Provider
      value={{ user, session, role, profileStatus, loading, profileFetched, isAdminOrAbove, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
