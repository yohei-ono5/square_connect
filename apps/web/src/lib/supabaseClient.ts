import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let client: SupabaseClient<any> | null = null;

// テスト運用中はログインなしで、Publishable keyを使って通常のCRUDを行う。
// Square連携など秘密情報が絡む処理は、引き続き apps/worker 経由で行うこと。
export function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabaseの接続設定（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）がありません");
  }
  client ??= createClient<any>(supabaseUrl, supabaseAnonKey);
  return client;
}
