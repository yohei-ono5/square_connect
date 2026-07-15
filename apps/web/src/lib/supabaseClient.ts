import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// RLSで store_id スコープされるため、通常のCRUDはこのクライアントから直接行う。
// Square/メルカリ連携など秘密情報が絡む処理は apps/worker 経由で行うこと。
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
