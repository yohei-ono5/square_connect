import { useState, type FormEvent } from "react";
import { authenticatedFetch } from "../lib/authFetch";
import { WORKER_BASE_URL } from "../lib/config";
import { UI_PREVIEW_ENABLED } from "../lib/uiPreview";
import { useAuth } from "../store/AuthContext";

export function AccessRequestPage() {
  const { session, accessRequestStatus, logout, reloadAccount } = useAuth();
  const metadata = session?.user.user_metadata ?? {};
  const [lastName, setLastName] = useState(
    typeof metadata.family_name === "string" ? metadata.family_name : "",
  );
  const [firstName, setFirstName] = useState(
    typeof metadata.given_name === "string" ? metadata.given_name : "",
  );
  const [storeCode, setStoreCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    if (UI_PREVIEW_ENABLED) {
      setPreviewNotice("プレビュー：利用申請を送信しました。実際のデータは変更されません。");
      setSubmitting(false);
      return;
    }
    try {
      const response = await authenticatedFetch(`${WORKER_BASE_URL}/api/access-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastName: lastName.trim(), firstName: firstName.trim(), storeCode: storeCode.trim() }),
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "利用申請を送信できませんでした");
      await reloadAccount();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "利用申請を送信できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  async function checkApproval() {
    setReloading(true);
    setError(null);
    try {
      await reloadAccount();
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "承認状況を確認できませんでした");
    } finally {
      setReloading(false);
    }
  }

  if (accessRequestStatus === "pending") {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div>
            <p className="auth-kicker">Square Connect</p>
            <h1>管理者の承認待ちです</h1>
            <p className="subtitle">店舗の管理者が申請を確認すると、商品管理を利用できるようになります。</p>
          </div>
          <p className="account-email">{session?.user.email}</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="button" onClick={() => void checkApproval()} disabled={reloading}>
            {reloading ? "確認中…" : "承認状況を確認"}
          </button>
          <button className="btn" type="button" onClick={() => void logout()}>ログアウト</button>
        </section>
      </main>
    );
  }

  if (accessRequestStatus === "approved") {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div>
            <p className="auth-kicker">Square Connect</p>
            <h1>アカウントは利用停止中です</h1>
            <p className="subtitle">利用を再開する場合は、店舗の管理者へご連絡ください。</p>
          </div>
          <button className="btn" type="button" onClick={() => void logout()}>ログアウト</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submitRequest}>
        <div>
          <p className="auth-kicker">Square Connect</p>
          <h1>{accessRequestStatus === "rejected" ? "もう一度利用申請する" : "店舗への利用申請"}</h1>
          <p className="subtitle">
            {accessRequestStatus === "rejected"
              ? "前回の申請は承認されませんでした。入力内容を確認して再申請できます。"
              : "初回のみ、氏名と管理者から案内された店舗コードを入力してください。"}
          </p>
        </div>
        <p className="account-email">Googleアカウント：{session?.user.email}</p>
        <div className="admin-name-fields">
          <label className="field">
            <span>姓</span>
            <input className="input" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} autoComplete="family-name" />
          </label>
          <label className="field">
            <span>名</span>
            <input className="input" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} autoComplete="given-name" />
          </label>
        </div>
        <label className="field">
          <span>店舗コード</span>
          <input
            className="input"
            value={storeCode}
            onChange={(event) => setStoreCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            required
            minLength={6}
            maxLength={6}
            pattern="[A-Z0-9]{6}"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            placeholder="例：AB23CD"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {previewNotice && <p className="list-notice" role="status">{previewNotice}</p>}
        <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
          {submitting ? "送信中…" : "利用申請を送信"}
        </button>
        <button className="btn" type="button" onClick={() => void logout()}>ログアウト</button>
      </form>
    </main>
  );
}
