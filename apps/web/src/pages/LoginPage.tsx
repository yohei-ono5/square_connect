import { useState } from "react";
import { useAuth } from "../store/AuthContext";

export function LoginPage() {
  const { loginWithGoogle, error: authenticationError } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithGoogle();
    } catch (loginError) {
      console.error("Google login failed", loginError);
      setError("Googleログインを開始できませんでした。時間をおいてもう一度お試しください。");
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div>
          <p className="auth-kicker">Square Connect</p>
          <h1>ログイン</h1>
          <p className="subtitle">商品を登録・管理するスタッフ向けの画面です。</p>
        </div>
        {(error || authenticationError) && (
          <p className="form-error" role="alert">{error ?? authenticationError}</p>
        )}
        <button
          className="btn google-login-button"
          type="button"
          onClick={() => void handleLogin()}
          disabled={submitting}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.4Z" />
            <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z" />
            <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.2 7.3l3.3 2.6A5.8 5.8 0 0 1 12 5.9Z" />
          </svg>
          {submitting ? "Googleへ移動しています…" : "Googleでログイン"}
        </button>
        <p className="auth-help">初めてログインする場合は、続けて店舗への利用申請を行います。</p>
      </section>
    </main>
  );
}
