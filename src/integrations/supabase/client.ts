import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Accept either env-var name — VITE_SUPABASE_ANON_KEY (current Supabase convention)
// or VITE_SUPABASE_PUBLISHABLE_KEY (legacy Lovable/school-sales-buddy convention).
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly in dev — silent failure = confused "why doesn't anything load" reports.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars. Check your .env file or Vercel project env settings.'
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = createClient<Database>(
  SUPABASE_URL as string,
  SUPABASE_ANON_KEY as string,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);