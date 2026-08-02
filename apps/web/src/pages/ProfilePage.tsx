import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../store/AuthContext";

export function ProfilePage() {
  const { account, updateProfile, logout } = useAuth();
  const [lastName, setLastName] = useState(account?.lastName ?? "");
  const [firstName, setFirstName] = useState(account?.firstName ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await updateProfile({ lastName, firstName });
      setNotice("氏名を変更しました。");
    } catch (saveError) {
      console.error("Profile update failed", saveError);
      setError("氏名を変更できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setSaving(false);
    }
  }

  if (!account) return null;

  return (
    <div className="screen">
      <div className="header">
        <Link className="back-link" to="/">← 商品一覧に戻る</Link>
        <h1>プロフィール</h1>
      </div>
      <div className="content profile-content">
        <form className="admin-section profile-form" onSubmit={saveProfile}>
          <h2>氏名</h2>
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
          {notice && <p className="list-notice" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving || (!lastName.trim() || !firstName.trim())}>
            {saving ? "保存中…" : "氏名を保存"}
          </button>
        </form>

        <section className="admin-section profile-details">
          <h2>アカウント</h2>
          <dl>
            <div><dt>Googleアカウント</dt><dd>{account.user.email}</dd></div>
            <div><dt>権限</dt><dd>{account.role === "admin" ? "管理者" : "スタッフ"}</dd></div>
          </dl>
          <p className="subtitle">メールアドレスやパスワードはGoogleアカウント側で管理されます。</p>
        </section>

        <button className="btn" type="button" onClick={() => void logout()}>この端末からログアウト</button>
      </div>
    </div>
  );
}
