import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';
export type ProfileStatus = 'pending' | 'approved' | 'suspended';

interface ProfileData {
  role: AppRole | null;
  status: ProfileStatus | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  /** Account approval status. 'pending' = blocked, 'approved' = active, 'suspended' = banned. */
  profileStatus: ProfileStatus | null;
  loading: boolean;
  isAdminOrAbove: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  profileStatus: null,
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
  const [loading, setLoading] = useState(true);

  /** Fetches both role and status in one round-trip. */
  const fetchProfile = useCallback(async (userId: string): Promise<ProfileData> => {
    try {
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('role, status')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[useAuth] Failed to fetch profile:', error.message);
        return { role: null, status: null };
      }

      return {
        role:   (data?.role   as AppRole       | undefined) ?? null,
        status: (data?.status as ProfileStatus | undefined) ?? null,
      };
    } catch (e) {
      console.error('[useAuth] Profile fetch exception:', e);
      return { role: null, status: null };
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const applyProfile = (p: ProfileData) => {
      if (!mounted) return;
      setRole(p.role);
      setProfileStatus(p.status);
      setLoading(false);
    };

    // Subscribe to auth state changes (login / logout / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Defer profile fetch slightly to avoid Supabase auth internal deadlocks
          setTimeout(async () => {
            const p = await fetchProfile(newSession.user.id);
            applyProfile(p);
          }, 0);
        } else {
          setRole(null);
          setProfileStatus(null);
          setLoading(false);
        }
      }
    );

    // Hydrate on mount from any existing session (page refresh / SSR)
    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      if (!mounted) return;
      setSession(existing);
      setUser(existing?.user ?? null);

      if (existing?.user) {
        const p = await fetchProfile(existing.user.id);
        applyProfile(p);
      } else {
        if (mounted) setLoading(false);
      }
    });

    // Safety valve: never hang the UI forever if Supabase is slow
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('[useAuth] Sign out error:', e);
    }
    setUser(null);
    setSession(null);
    setRole(null);
    setProfileStatus(null);
    window.location.href = '/login';
  }, []);

  const isAdminOrAbove = role === 'super_admin' || role === 'admin' || role === 'manager';

  return (
    <AuthContext.Provider value={{ user, session, role, profileStatus, loading, isAdminOrAbove, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
