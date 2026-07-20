import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// テスト運用中はログインなしで、anonキーを使って通常のCRUDを行う。
// Square連携など秘密情報が絡む処理は、引き続き apps/worker 経由で行うこと。
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
