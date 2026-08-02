// UI確認専用。import.meta.env.DEVも必須にし、本番ビルドでは環境変数が誤って
// 設定されても認証を迂回できないようにする。従来のadmin指定も互換性のため残す。
const previewMode = import.meta.env.VITE_UI_PREVIEW_MODE;

export const UI_PREVIEW_ENABLED =
  import.meta.env.DEV && (previewMode === "all" || previewMode === "admin");

export const ADMIN_UI_PREVIEW = UI_PREVIEW_ENABLED;
