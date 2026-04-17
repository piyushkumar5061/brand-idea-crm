import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

// ─────────────────────────────────────────────────────────────────────────────
// Founder god-mode constant.
// This email is ALWAYS treated as a super_admin in the client, regardless of
// what the profiles table says (or doesn't say). It's a hardcoded absolute
// override, intentionally declared at module scope so every branch of the
// auth flow — hydrate, onAuthStateChange, derived flags — reads the same
// value and cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────
export const FOUNDER_EMAIL = 'piyushkumar5061@gmail.com';

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
   * True once the hydration handshake (getSession + profile fetch, OR the
   * god-mode short-circuit) has completed. Loading is only ever flipped to
   * false inside the single atomic `applyAuthState` call — so any component
   * that reads `loading === false` is guaranteed to see consistent values
   * for user, session, role, and profileStatus at the same time.
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
// Timing budgets. Chosen so the worst-case hydration is ~5 s end-to-end —
// long enough to cover a slow network, short enough that the user isn't stuck
// behind a spinner if Supabase is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
const GET_SESSION_TIMEOUT_MS = 3000;
const PROFILE_FETCH_TIMEOUT_MS = 2500;

/**
 * Race a promise against a hard timer. Always resolves/rejects within `ms`;
 * never hangs. Required because Supabase's JS client has been observed to
 * wedge on both getSession() and .select() calls against unreachable DBs.
 */
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
 * Fetch the authenticated user's profile row. Can never reject — any failure
 * (RLS block, missing table, timeout, exception) resolves to `{role:null,
 * status:null, fetched:true}` so the caller always gets a terminal answer.
 *
 * IMPORTANT: this is skipped entirely for the founder email. See hydrate().
 */
async function fetchProfileSafe(userId: string): Promise<ProfileData> {
  console.log('[useAuth] 🔍 fetchProfileSafe start — userId:', userId);
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
      console.warn('[useAuth] ⚠️ no profiles row for', userId);
      return { role: null, status: null, fetched: true };
    }
    const r = (data.role   as AppRole       | undefined) ?? null;
    const s = (data.status as ProfileStatus | undefined) ?? null;
    console.info('[useAuth] ✅ profile loaded →', { role: r, status: s });
    return { role: r, status: s, fetched: true };
  } catch (e) {
    console.error('[useAuth] 💥 fetchProfileSafe threw:', e);
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
   * The ONLY setter path. Applies session + profile atomically, with the
   * founder god-mode override baked in. After this runs, every consumer of
   * useAuth() sees a coherent snapshot — there is no intermediate render
   * where user is set but role isn't.
   *
   * Founder god-mode: if the session's email is the founder, we FORCE
   * role='super_admin' and status='approved', regardless of what the
   * profiles table returned. The DB is advisory for this account; the
   * client is the authority. This is the single line that permanently
   * fixes the "downgraded to Team on refresh" bug.
   */
  const applyAuthState = useCallback((
    newSession: Session | null,
    profile: ProfileData,
  ) => {
    if (!mountedRef.current) return;
    const email = newSession?.user?.email;
    const isFounder = email === FOUNDER_EMAIL;

    const effectiveRole: AppRole | null =
      isFounder ? 'super_admin' : profile.role;
    const effectiveStatus: ProfileStatus | null =
      isFounder ? 'approved' : profile.status;

    if (isFounder && (profile.role !== 'super_admin' || profile.status !== 'approved')) {
      console.warn(
        '[useAuth] 🔑 FOUNDER GOD-MODE — overriding DB profile',
        { dbRole: profile.role, dbStatus: profile.status },
        '→ { role: super_admin, status: approved }',
      );
    }

    // Batch: all six setState calls flush in the same React tick because
    // we're inside a synchronous function (React 18 auto-batches).
    setSession(newSession);
    setUser(newSession?.user ?? null);
    setRole(effectiveRole);
    setProfileStatus(effectiveStatus);
    setProfileFetched(true);
    setLoading(false);

    console.log('[useAuth] 🏁 applyAuthState', {
      user: email ?? null,
      role: effectiveRole,
      status: effectiveStatus,
      isFounder,
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

      // Step 2a: no session → settle as logged-out.
      if (!sess?.user) {
        applyAuthState(null, { role: null, status: null, fetched: true });
        return;
      }

      // Step 2b: FOUNDER GOD-MODE SHORT-CIRCUIT.
      // We don't even hit the profiles table. The founder is ALWAYS
      // super_admin in the client. Settle immediately — hydration done
      // in one tick, no race window where role could be null.
      if (sess.user.email === FOUNDER_EMAIL) {
        console.log('[useAuth] 🔑 founder detected at hydrate — god-mode short-circuit');
        applyAuthState(sess, { role: 'super_admin', status: 'approved', fetched: true });
        return;
      }

      // Step 2c: everyone else → fetch profile, then settle.
      const profile = await fetchProfileSafe(sess.user.id);
      if (!mountedRef.current) return;
      applyAuthState(sess, profile);
    };

    // ── Auth events (sign-in, sign-out, token refresh) ──────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mountedRef.current) return;
        console.log('[useAuth] 🔔 auth event', event, newSession?.user?.email);

        // The INITIAL_SESSION event fires once immediately; hydrate() is
        // already handling it. Ignoring it here prevents a double-settle race.
        if (event === 'INITIAL_SESSION') return;

        // Sign-out or session ended → clear and settle.
        if (!newSession?.user) {
          applyAuthState(null, { role: null, status: null, fetched: true });
          return;
        }

        // Founder sign-in / token refresh → god-mode, no profile fetch.
        if (newSession.user.email === FOUNDER_EMAIL) {
          applyAuthState(newSession, { role: 'super_admin', status: 'approved', fetched: true });
          return;
        }

        // Non-founder: defer the profile fetch to the next microtask to
        // avoid deadlocking Supabase's auth lock (documented gotcha).
        // While we're fetching, we flip loading=true to keep the UI honest —
        // protected routes will show the central loader until the new role
        // is confirmed. NO intermediate "signed in but role unknown" render.
        setLoading(true);
        setTimeout(async () => {
          const profile = await fetchProfileSafe(newSession.user.id);
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
    // Force-clear local state so the router redirects to /login immediately.
    if (mountedRef.current) {
      setSession(null);
      setUser(null);
      setRole(null);
      setProfileStatus(null);
    }
    window.location.href = '/login';
  }, []);

  // Derived: isAdminOrAbove honours BOTH the role column AND the founder
  // email. Either condition alone is enough. If a UI element is gated on
  // this, the founder always passes.
  const isAdminOrAbove =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'manager' ||
    user?.email === FOUNDER_EMAIL;

  return (
    <AuthContext.Provider
      value={{ user, session, role, profileStatus, loading, profileFetched, isAdminOrAbove, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
