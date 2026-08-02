import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatAccountName, useAuth } from "../store/AuthContext";

export function AccountMenu() {
  const { account, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!account) return null;

  function closeMenu() {
    setOpen(false);
  }

  async function handleLogout() {
    closeMenu();
    await logout();
  }

  const canAdminister = account.role === "admin" || account.isSystemAdmin;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="hamburger-button"
        aria-label="メニューを開く"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div
          className="menu-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <aside id={drawerId} className="account-drawer" role="dialog" aria-modal="true" aria-label="アカウントメニュー">
            <div className="account-drawer-header">
              <p className="auth-kicker">Square Connect</p>
              <button type="button" className="drawer-close" aria-label="メニューを閉じる" onClick={closeMenu}>×</button>
            </div>
            <div className="drawer-account">
              <div className="drawer-avatar" aria-hidden="true">{account.lastName.slice(0, 1) || "人"}</div>
              <div>
                <p className="drawer-account-name">{formatAccountName(account)}</p>
                <p className="drawer-account-meta">{account.user.email}</p>
                <p className="drawer-account-meta">{account.role === "admin" ? "管理者" : "スタッフ"}</p>
              </div>
            </div>
            <nav className="drawer-navigation" aria-label="メインメニュー">
              <Link to="/" onClick={closeMenu}>商品一覧</Link>
              <Link to="/profile" onClick={closeMenu}>プロフィール</Link>
              {canAdminister && <Link to="/admin" onClick={closeMenu}>管理メニュー</Link>}
            </nav>
            <div className="drawer-footer">
              <button type="button" onClick={() => void handleLogout()}>ログアウト</button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
