import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'super_admin' | 'admin' | 'manager' | 'employee';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  isAdminOrAbove: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  loading: true,
  isAdminOrAbove: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRole = useCallback(async (userId: string): Promise<AppRole | null> => {
    try {
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('role')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('Failed to fetch role:', error.message);
        return null;
      }
      return (data?.role as AppRole) ?? null;
    } catch (e) {
      console.error('Role fetch exception:', e);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          // Use setTimeout to avoid potential deadlocks with Supabase auth internals
          setTimeout(async () => {
            if (!mounted) return;
            const r = await fetchRole(newSession.user.id);
            if (mounted) {
              setRole(r);
              setLoading(false);
            }
          }, 0);
        } else {
          setRole(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      if (!mounted) return;
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        const r = await fetchRole(existing.user.id);
        if (mounted) {
          setRole(r);
          setLoading(false);
        }
      } else {
        if (mounted) setLoading(false);
      }
    });

    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 2000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [fetchRole]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Sign out error:', e);
    }
    setUser(null);
    setSession(null);
    setRole(null);
    // Force navigation to login
    window.location.href = '/login';
  }, []);

  const isAdminOrAbove = role === 'super_admin' || role === 'admin' || role === 'manager';

  return (
    <AuthContext.Provider value={{ user, session, role, loading, isAdminOrAbove, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
