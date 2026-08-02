import { HashRouter, Route, Routes } from "react-router-dom";
import { ItemsProvider } from "./store/ItemsContext";
import { ItemListPage } from "./pages/ItemListPage";
import { QuickRegisterPage } from "./pages/QuickRegisterPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { AccessRequestPage } from "./pages/AccessRequestPage";
import { ProfilePage } from "./pages/ProfilePage";
import { UiPreviewPage } from "./pages/UiPreviewPage";
import { AuthProvider, useAuth } from "./store/AuthContext";
import { UI_PREVIEW_ENABLED } from "./lib/uiPreview";

function AuthenticatedApp() {
  const { session, account, loading } = useAuth();
  if (UI_PREVIEW_ENABLED) return (
    <Routes>
      <Route path="/preview/items" element={<ItemsProvider><ItemListPage /></ItemsProvider>} />
      <Route path="/preview/login" element={<LoginPage />} />
      <Route path="/preview/register" element={<AccessRequestPage />} />
      <Route path="/preview/admin" element={<AdminPage />} />
      <Route path="/preview/profile" element={<ProfilePage />} />
      <Route path="*" element={<UiPreviewPage />} />
    </Routes>
  );
  if (loading) return <main className="auth-screen"><p>ログイン情報を確認しています…</p></main>;
  if (!session) return <LoginPage />;
  if (!account) return <AccessRequestPage />;
  return (
    <ItemsProvider>
      <Routes>
        <Route path="/" element={<ItemListPage />} />
        <Route path="/items/new" element={<QuickRegisterPage />} />
        <Route path="/items/:id" element={<ItemDetailPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </ItemsProvider>
  );
}

export function App() {
  return <AuthProvider><HashRouter><AuthenticatedApp /></HashRouter></AuthProvider>;
}
