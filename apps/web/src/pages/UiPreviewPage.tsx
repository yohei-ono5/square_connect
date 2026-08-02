import { Link } from "react-router-dom";

const previewPages = [
  { to: "/preview/items", title: "商品一覧・メニュー", description: "一段ヘッダーとハンバーガーメニューを確認" },
  { to: "/preview/login", title: "ログインページ", description: "Googleログインボタンを確認" },
  { to: "/preview/register", title: "初回登録ページ", description: "氏名と6文字の店舗コード入力を確認" },
  { to: "/preview/admin", title: "管理者ページ", description: "利用申請の承認・却下とスタッフ一覧を確認" },
  { to: "/preview/profile", title: "プロフィールページ", description: "氏名、Googleアカウント、権限を確認" },
];

export function UiPreviewPage() {
  return (
    <main className="auth-screen">
      <section className="auth-card preview-menu-card">
        <div>
          <p className="auth-kicker">Square Connect</p>
          <h1>UIプレビュー</h1>
          <p className="subtitle">Supabaseへ接続せず、各画面の表示と操作感を確認できます。</p>
        </div>
        <nav className="preview-menu" aria-label="プレビュー画面一覧">
          {previewPages.map((page) => (
            <Link key={page.to} className="preview-menu-link" to={page.to}>
              <span>{page.title}</span>
              <small>{page.description}</small>
            </Link>
          ))}
        </nav>
        <p className="preview-banner" role="status">実際の認証・データ更新は行われません</p>
      </section>
    </main>
  );
}
