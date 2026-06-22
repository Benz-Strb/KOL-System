import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../types.js';

export function getSupabaseAdmin(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
