import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Single shared Supabase client for the app.
 *
 * Configuration comes from environment variables (see `.env.example`):
 *   VITE_SUPABASE_URL       — your project URL
 *   VITE_SUPABASE_ANON_KEY  — the public anon key (safe in the frontend; RLS protects data)
 *
 * The service_role key must NEVER appear here — privileged actions (creating
 * users, resetting passwords) run server-side in the `admin-users` Edge Function.
 *
 * When the env vars are absent (e.g. before setup) `supabase` is null and the app
 * falls back to its local stores, so it never hard-crashes during the transition.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured: boolean = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/** Throwing accessor for code paths that must have Supabase configured. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env')
  }
  return supabase
}
