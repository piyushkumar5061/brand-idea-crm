# Brand Idea CRM

Internal sales CRM for **crm.brandideaonline.com** — React + Vite + TypeScript + Tailwind + shadcn/ui, backed by Supabase (Postgres + Auth + RLS).

## Stack
- React 18 + Vite 5 + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query v5
- React Router v6
- Supabase JS v2 (Auth + PostgREST)

## First-time setup

1. **Create a new Supabase project** at https://supabase.com.
2. **Build the schema** — open the Supabase SQL editor and paste the consolidated blueprint shipped in this repo:
   ```
   brand_idea_init.sql
   ```
   It creates every table, RLS policy, trigger, and RPC the frontend expects.
3. **Populate environment** — copy your Supabase project URL + anon key into `.env`:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-public-key>
   ```
   The legacy `VITE_SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PUBLISHABLE_KEY` keys in `.env` are also read by `src/integrations/supabase/client.ts` — fill those in too.
4. **Install + run**:
   ```bash
   npm install
   npm run dev
   ```

## Scripts
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run test` — Vitest

## Super-admin bootstrap
The `handle_new_user()` Postgres trigger auto-grants `super_admin` role to the email listed in the `SUPER_ADMIN_EMAIL` constant at the top of that function inside `brand_idea_init.sql`. Edit that constant **before** running the SQL so the first sign-up becomes admin.
