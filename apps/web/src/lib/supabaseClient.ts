import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./appError";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let client: SupabaseClient<any> | null = null;

export function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AppError("CONFIG", {
      missingUrl: !supabaseUrl,
      missingKey: !supabaseAnonKey,
    });
  }
  client ??= createClient<any>(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return client;
}
