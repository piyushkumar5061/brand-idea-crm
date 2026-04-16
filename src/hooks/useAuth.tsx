import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

interface ProfileData {
  role: AppRole | null;
  status: ProfileStatus | null;
  /** true once the DB round-trip has completed (even if the row is missing / timed out) */
  fetched: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  /**
   * Account gate status fetched directly from public.profiles:
   *   'approved'  → user may enter the CRM
   *   'pending'   → awaiting admin approval
   *   'suspended' → account blocked
   *   null        → no row found OR fetch timed out / failed
   */
  profileStatus: ProfileStatus | null;
  /**
   * Becomes true once the profiles SELECT has resolved — even if the row was
   * missing, or the query errored, or we hit the hard 3 s safety cap.
   *
   * INVARIANT: profileFetched === true is ALWAYS accompanied by loading === false.
   * Guards should only need to branch on `loading`. We expose this flag so
   * diagnostics can tell whether we got a real answer vs. a timeout fallback.
   */
  profileFetched: boolean;
  loading: boolean;
  isAdminOrAbove: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  profileStatus: null,
  profileFetched: false,
  loading: true,
  isAdminOrAbove: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ---------------------------------------------------------------------------
// Timing constants — chosen so the inner timeouts ALWAYS fire before the
// outer safety cap, giving the nice "real data or null, never wedged" guarantee.
// ---------------------------------------------------------------------------
const PROFILE_FETCH_TIMEOUT_MS = 2000;  // per profiles SELECT
const HARD_LOADING_CAP_MS      = 3000;  // outermost "you are unblocked NOW" fuse

/** Fetcher can only resolve (never reject) — caller never needs try/catch. */
async function fetchProfileSafe(userId: string): Promise<ProfileData> {
  const timeoutPromise = new Promise<ProfileData>((resolve) =>
    setTimeout(() => {
      console.warn(
        `[useAuth] profile fetch timed out after ${PROFILE_FETCH_TIMEOUT_MS}ms ` +
        '— proceeding with null role (session remains valid)'
      );
      resolve({ role: null, status: null, fetched: true });
    }, PROFILE_FETCH_TIMEOUT_MS),
  );

  const queryPromise: Promise<ProfileData> = (async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, status')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error(
          '[useAuth] profiles SELECT error — table may not exist or RLS is blocking it.\n' +
          'Run brand_idea_init.sql in Supabase SQL Editor. Raw error:', error,
        );
        return { role: null, status: null, fetched: true };
      }

      if (!data) {
        console.warn(
          '[useAuth] No profiles row found for user', userId,
          '— INSERT a row via the emergency SQL or re-run brand_idea_init.sql',
        );
        return { role: null, status: null, fetched: true };
      }

      const r = (data.role   as AppRole       | undefined) ?? null;
      const s = (data.status as ProfileStatus | undefined) ?? null;
      console.info('[useAuth] profile loaded →', { role: r, status: s, userId });
      return { role: r, status: s, fetched: true };
    } catch (e) {
      console.error('[useAuth] fetchProfile threw unexpectedly:', e);
      return { role: null, status: null, fetched: true };
    }
  })();

  return Promise.race([queryPromise, timeoutPromise]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                   = useState<User | null>(null);
  const [session, setSession]             = useState<Session | null>(null);
  const [role, setRole]                   = useState<AppRole | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [profileFetched, setProfileFetched] = useState(false);
  const [loading, setLoading]             = useState(true);

  /** Prevents the 3 s fallback toast from firing if we already resolved cleanly. */
  const hasSettledRef = useRef(false);

  const fetchProfile = useCallback((userId: string) => fetchProfileSafe(userId), []);

  useEffect(() => {
    let mounted = true;

    /**
     * Atomically flip us out of the loading state.
     * INVARIANT: once this runs, the spinner WILL die.
     */
    const settle = (p: ProfileData) => {
      if (!mounted) return;
      hasSettledRef.current = true;
      setRole(p.role);
      setProfileStatus(p.status);
      setProfileFetched(true);     // always true — the fetch round-trip is done
      setLoading(false);            // always false — spinner dies
    };

    /**
     * Same as settle() but for the "no session at all" case. Role/status stay null.
     */
    const settleNoSession = () => {
      if (!mounted) return;
      hasSettledRef.current = true;
      setRole(null);
      setProfileStatus(null);
      setProfileFetched(true);
      setLoading(false);
    };

    // ── (1) Hydrate on page load from persisted session ────────────────────
    // This is the critical path for the refresh bug. We MUST exit loading,
    // regardless of whether getSession() resolves, rejects, or hangs.
    const hydrate = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.error('[useAuth] getSession() returned an error:', error);
          settleNoSession();
          return;
        }

        const existing = data.session;
        setSession(existing);
        setUser(existing?.user ?? null);

        if (!existing?.user) {
          settleNoSession();
          return;
        }

        // Session exists → fetch profile (itself bounded by 2 s).
        const profile = await fetchProfile(existing.user.id);
        if (!mounted) return;
        settle(profile);
      } catch (e) {
        // getSession() itself threw (rare, but possible on corrupted localStorage).
        console.error('[useAuth] hydrate() threw:', e);
        if (mounted) settleNoSession();
      } finally {
        // Belt-and-suspenders: even if every branch above were to forget to
        // settle, this guarantees loading dies. No infinite spinner — ever.
        if (mounted && !hasSettledRef.current) {
          console.warn('[useAuth] hydrate finally: force-settling (no branch settled)');
          settleNoSession();
        }
      }
    };

    // ── (2) Subscribe to future auth events ────────────────────────────────
    // Supabase fires INITIAL_SESSION once immediately — we intentionally
    // IGNORE that one (hydrate() above is the source of truth for the
    // initial state). We only react to post-initial transitions:
    // SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;
        console.debug('[useAuth] auth event:', event, newSession?.user?.email);

        if (event === 'INITIAL_SESSION') return; // handled by hydrate()

        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (!newSession?.user) {
          // SIGNED_OUT or session ended
          settleNoSession();
          return;
        }

        // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED — refresh the profile.
        // Deferred with setTimeout(0) to avoid deadlocks with Supabase's
        // internal auth lock (documented gotcha).
        setTimeout(async () => {
          try {
            const profile = await fetchProfile(newSession.user.id);
            if (!mounted) return;
            settle(profile);
          } catch (e) {
            console.error('[useAuth] onAuthStateChange profile fetch threw:', e);
            if (mounted) settleNoSession();
          } finally {
            // Guarantee: spinner dies after any SIGNED_IN event, even if
            // the profile fetch path somehow failed to settle above.
            // Unconditional set is safe — React dedupes identical values.
            if (mounted) {
              setLoading(false);
              setProfileFetched(true);
            }
          }
        }, 0);
      },
    );

    // ── (3) Hard 3 s loading cap ───────────────────────────────────────────
    // Last line of defense: if we are STILL loading after 3 s (getSession
    // hung, profile fetch hung past its own 2 s fuse, browser threw, etc.)
    // we force-exit loading and surface a toast so the user knows to refresh
    // or check the console. Never traps the UI.
    const hardCap = setTimeout(() => {
      if (!mounted) return;
      if (hasSettledRef.current) return;
      console.error(
        `[useAuth] HARD CAP: still loading after ${HARD_LOADING_CAP_MS}ms — ` +
        'forcing loading=false. Likely causes: profiles table missing, RLS ' +
        'recursion, or unreachable Supabase. Check the network tab and run ' +
        'brand_idea_init.sql if the profiles table is absent.',
      );
      toast.error(
        "Auth took too long to load. If you see this often, check the console — " +
        "there's likely a profiles table / RLS issue.",
        { duration: 6000 },
      );
      settleNoSession();
    }, HARD_LOADING_CAP_MS);

    // Kick off hydration.
    hydrate();

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(hardCap);
    };
    // fetchProfile is useCallback-stable; re-running this effect would
    // duplicate the subscription, so we intentionally use an empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { console.error('[useAuth] sign out error:', e); }
    setUser(null);
    setSession(null);
    setRole(null);
    setProfileStatus(null);
    setProfileFetched(false);
    window.location.href = '/login';
  }, []);

  const isAdminOrAbove = role === 'super_admin' || role === 'admin' || role === 'manager';

  return (
    <AuthContext.Provider
      value={{ user, session, role, profileStatus, profileFetched, loading, isAdminOrAbove, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
