import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

interface ProfileData {
  role: AppRole | null;
  status: ProfileStatus | null;
  /** true once the DB round-trip has completed (even if the row is missing) */
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
   *   null        → DB round-trip has not yet completed (or row missing)
   */
  profileStatus: ProfileStatus | null;
  /**
   * Becomes true once the profiles SELECT has resolved — even if
   * the row was missing or an error occurred.
   * Use this in guards to distinguish "still loading" from "load complete, no row".
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [profileFetched, setProfileFetched] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * Fetches role + status from public.profiles in a single query.
   * Uses the typed client (no `as any`) now that types.ts includes role + status.
   * Always returns {fetched: true} — even on error — so guards can stop waiting.
   */
  const fetchProfile = useCallback(async (userId: string): Promise<ProfileData> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, status')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // Most likely cause: RLS blocking the row OR profiles table doesn't exist.
        console.error(
          '[useAuth] profiles SELECT error — table may not exist or RLS is blocking it.\n' +
          'Run brand_idea_init.sql in Supabase SQL Editor. Error:', error.message
        );
        return { role: null, status: null, fetched: true };
      }

      if (!data) {
        // Authenticated but no profile row — trigger hasn't run yet, or schema not applied.
        console.warn(
          '[useAuth] No profiles row found for user', userId,
          '— INSERT a row via the emergency SQL or re-run brand_idea_init.sql'
        );
        return { role: null, status: null, fetched: true };
      }

      // ✅ Happy path: row found, cast values safely
      const r = (data.role   as AppRole       | undefined) ?? null;
      const s = (data.status as ProfileStatus | undefined) ?? null;
      console.info('[useAuth] profile loaded →', { role: r, status: s, userId });
      return { role: r, status: s, fetched: true };

    } catch (e) {
      console.error('[useAuth] fetchProfile threw an unexpected exception:', e);
      return { role: null, status: null, fetched: true };
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const applyProfile = (p: ProfileData) => {
      if (!mounted) return;
      setRole(p.role);
      setProfileStatus(p.status);
      setProfileFetched(p.fetched);
      setLoading(false);
    };

    // ── Listen for sign-in / sign-out / token-refresh ──────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Defer slightly to avoid Supabase auth-internal deadlocks
          setTimeout(async () => {
            const p = await fetchProfile(newSession.user.id);
            applyProfile(p);
          }, 0);
        } else {
          setRole(null);
          setProfileStatus(null);
          setProfileFetched(true);   // "fetched" = we know there's no user
          setLoading(false);
        }
      }
    );

    // ── Hydrate on page load from persisted session ───────────────────────
    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      if (!mounted) return;
      setSession(existing);
      setUser(existing?.user ?? null);

      if (existing?.user) {
        const p = await fetchProfile(existing.user.id);
        applyProfile(p);
      } else {
        if (mounted) {
          setProfileFetched(true);
          setLoading(false);
        }
      }
    });

    // ── Safety valve: stop the spinner after 5 s if DB is completely unreachable
    // Note: profileFetched stays false so guards know we timed out, not resolved.
    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn('[useAuth] 5 s timeout: profile fetch did not complete — proceeding with null status');
        setLoading(false);
        // Do NOT setProfileFetched(true) here — guards can distinguish timeout vs resolved.
      }
    }, 5000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { console.error('[useAuth] sign out error:', e); }
    setUser(null); setSession(null); setRole(null);
    setProfileStatus(null); setProfileFetched(false);
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
