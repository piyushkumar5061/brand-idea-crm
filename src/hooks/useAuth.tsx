import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

// ─────────────────────────────────────────────────────────────────────────────
// 100 % DATABASE-DRIVEN — permanent fix
// ─────────────────────────────────────────────────────────────────────────────
// Earlier revisions called `supabase.auth.getSession()` directly AND subscribed
// to `onAuthStateChange`. That combination had three failure modes:
//
//   1. getSession() has been observed to hang indefinitely on some networks
//      (Supabase issue tracker has many reports). Its 5 s timeout would then
//      treat the user as logged-out, even when they weren't.
//   2. Calling supabase.from(...).select() inside the auth listener could
//      deadlock the auth lock. We masked it with setTimeout(0) but the code
//      path was fragile.
//   3. Double-settling when INITIAL_SESSION and hydrate() both fired.
//
// The new implementation follows the Supabase-recommended pattern exactly:
//   - onAuthStateChange is the SINGLE source of truth.
//   - INITIAL_SESSION (fired once immediately on subscribe) handles hydration.
//   - SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED handle changes.
//   - Every Supabase call that could block is wrapped in withTimeout + setTimeout
//     so the listener itself never holds the auth lock.
//
// Plus a definitive SAFETY CAP: if `loading` is still true after 12 seconds,
// we forcibly flip it to false so the user is NEVER permanently stuck on the
// full-screen loader.
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
// Timing budgets.
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_FETCH_TIMEOUT_MS = 4000;   // single DB select
const HARD_HYDRATION_CAP_MS    = 12000;  // absolute maximum time on the loader

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
 * SELECT role, status FROM public.profiles WHERE user_id = :userId
 * Never rejects. On any failure (RLS, missing row, timeout, throw) returns
 * `{role:null, status:null, fetched:true}`.
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

  const mountedRef    = useRef(true);
  const lastUserIdRef = useRef<string | null>(null);
  // Monotonic counter so stale profile fetches (e.g. a slow fetch for a
  // previous user id) never clobber the current state.
  const fetchTokenRef = useRef(0);

  /** Atomic setter. All consumers see a coherent snapshot when loading flips. */
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
    lastUserIdRef.current = newSession?.user?.id ?? null;
    console.log('[useAuth] 🏁 applyAuthState', {
      user: newSession?.user?.email ?? null,
      role: profile.role,
      status: profile.status,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    console.log('[useAuth] 🚀 provider mount — subscribing to onAuthStateChange');

    // ── Absolute safety cap ─────────────────────────────────────────────
    // If anything below wedges and `loading` is still true after 12 s,
    // force it false so the app can at least render /login. No permanent
    // full-screen-loader trap is possible.
    const safetyTimer = setTimeout(() => {
      if (!mountedRef.current) return;
      setLoading(prev => {
        if (!prev) return prev;
        console.error('[useAuth] 🛟 SAFETY CAP — loading still true after', HARD_HYDRATION_CAP_MS, 'ms, forcing false');
        return false;
      });
      // If we're uncorking with no session resolved, make sure downstream
      // consumers see a terminal profileFetched=true so ProtectedRoute can
      // route to /login (no user) rather than a blank page.
      setProfileFetched(true);
    }, HARD_HYDRATION_CAP_MS);

    // ── onAuthStateChange IS the source of truth ────────────────────────
    // Supabase fires INITIAL_SESSION once immediately on subscribe, carrying
    // whatever session is in localStorage. That's our hydration signal — we
    // no longer call getSession() separately (it has been observed to hang).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mountedRef.current) return;
        console.log('[useAuth] 🔔 auth event', event, newSession?.user?.email ?? '(none)');

        // Sign-out / no session → settle as logged-out.
        if (!newSession?.user) {
          applyAuthState(null, { role: null, status: null, fetched: true });
          return;
        }

        const incomingUid = newSession.user.id;
        const sameUser = lastUserIdRef.current === incomingUid;

        // Background refresh: same user, token rotated. Don't flash the
        // loader; just update session and refetch the profile silently.
        if (sameUser && event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') {
          console.log('[useAuth] ↻ background refresh — no loader');
          setSession(newSession);
          setUser(newSession.user);
          const token = ++fetchTokenRef.current;
          setTimeout(async () => {
            const profile = await fetchProfile(incomingUid);
            if (!mountedRef.current) return;
            if (token !== fetchTokenRef.current) return; // stale
            if (profile.role !== null || profile.status !== null) {
              setRole(profile.role);
              setProfileStatus(profile.status);
            }
            setProfileFetched(true);
            lastUserIdRef.current = incomingUid;
          }, 0);
          return;
        }

        // Fresh identity (INITIAL_SESSION with a session, or SIGNED_IN) →
        // block with the loader, fetch the profile, settle atomically.
        // setTimeout(0) is critical: it drops us out of the auth listener
        // BEFORE we call supabase.from(...), which avoids the known
        // auth-lock deadlock.
        setLoading(true);
        const token = ++fetchTokenRef.current;
        setTimeout(async () => {
          const profile = await fetchProfile(incomingUid);
          if (!mountedRef.current) return;
          if (token !== fetchTokenRef.current) return; // stale — newer event superseded us
          applyAuthState(newSession, profile);
        }, 0);
      },
    );

    return () => {
      mountedRef.current = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { console.error('[useAuth] signOut (remote) threw:', e); }
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('sb-') || k.startsWith('supabase.'))) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      if (keys.length) console.log('[useAuth] 🧹 cleared', keys.length, 'local auth key(s)');
    } catch (e) {
      console.warn('[useAuth] localStorage cleanup threw:', e);
    }
    if (mountedRef.current) {
      setSession(null);
      setUser(null);
      setRole(null);
      setProfileStatus(null);
      lastUserIdRef.current = null;
    }
    window.location.href = '/login';
  }, []);

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
