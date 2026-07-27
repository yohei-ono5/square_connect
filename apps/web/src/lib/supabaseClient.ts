import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./appError";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let client: SupabaseClient<any> | null = null;

// テスト運用中はログインなしで、Publishable keyを使って通常のCRUDを行う。
// Square連携など秘密情報が絡む処理は、引き続き apps/worker 経由で行うこと。
export function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AppError("CONFIG", {
      missingUrl: !supabaseUrl,
      missingKey: !supabaseAnonKey,
    });
  }
  client ??= createClient<any>(supabaseUrl, supabaseAnonKey);
  return client;
}
