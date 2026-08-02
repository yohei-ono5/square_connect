import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authenticatedFetch } from "../lib/authFetch";
import { formatAccountName, useAuth } from "../store/AuthContext";
import { WORKER_BASE_URL } from "../lib/config";
import { ADMIN_UI_PREVIEW } from "../lib/uiPreview";

type StaffMember = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "staff";
  isActive: boolean;
  lastSignInAt: string | null;
};

type AccessRequest = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
};

const PREVIEW_MEMBERS: StaffMember[] = [
  {
    userId: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.com",
    firstName: "太郎",
    lastName: "管理",
    role: "admin",
    isActive: true,
    lastSignInAt: new Date().toISOString(),
  },
  {
    userId: "00000000-0000-4000-8000-000000000003",
    email: "staff@example.com",
    firstName: "花子",
    lastName: "山田",
    role: "staff",
    isActive: true,
    lastSignInAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    userId: "00000000-0000-4000-8000-000000000004",
    email: "stopped@example.com",
    firstName: "次郎",
    lastName: "佐藤",
    role: "staff",
    isActive: false,
    lastSignInAt: null,
  },
];

const PREVIEW_REQUESTS: AccessRequest[] = [
  {
    userId: "00000000-0000-4000-8000-000000000005",
    email: "new.staff@gmail.com",
    firstName: "美咲",
    lastName: "鈴木",
    status: "pending",
    requestedAt: new Date().toISOString(),
  },
  {
    userId: "00000000-0000-4000-8000-000000000006",
    email: "rejected.staff@gmail.com",
    firstName: "健太",
    lastName: "高橋",
    status: "rejected",
    requestedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

export function AdminPage() {
  const { account } = useAuth();
  const [members, setMembers] = useState<StaffMember[]>(ADMIN_UI_PREVIEW ? PREVIEW_MEMBERS : []);
  const [requests, setRequests] = useState<AccessRequest[]>(ADMIN_UI_PREVIEW ? PREVIEW_REQUESTS : []);
  const [loading, setLoading] = useState(!ADMIN_UI_PREVIEW);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);

  const canAdminister = account?.role === "admin" || account?.isSystemAdmin;
  const loadMembers = useCallback(async () => {
    if (ADMIN_UI_PREVIEW) {
      setMembers(PREVIEW_MEMBERS);
      setRequests(PREVIEW_REQUESTS);
      return;
    }
    const [membersResponse, requestsResponse] = await Promise.all([
      authenticatedFetch(`${WORKER_BASE_URL}/api/admin/staff`),
      authenticatedFetch(`${WORKER_BASE_URL}/api/admin/access-requests`),
    ]);
    const membersResult = await membersResponse.json().catch(() => null) as { members?: StaffMember[]; message?: string } | null;
    const requestsResult = await requestsResponse.json().catch(() => null) as { requests?: AccessRequest[]; message?: string } | null;
    if (!membersResponse.ok || !membersResult?.members) throw new Error(membersResult?.message ?? "スタッフ一覧を取得できませんでした");
    if (!requestsResponse.ok || !requestsResult?.requests) throw new Error(requestsResult?.message ?? "利用申請一覧を取得できませんでした");
    setMembers(membersResult.members);
    setRequests(requestsResult.requests);
  }, []);

  useEffect(() => {
    if (ADMIN_UI_PREVIEW) return;
    if (!canAdminister) return setLoading(false);
    loadMembers()
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "スタッフ一覧を取得できませんでした"))
      .finally(() => setLoading(false));
  }, [canAdminister, loadMembers]);

  async function reviewRequest(request: AccessRequest, action: "approve" | "reject" | "reopen") {
    const actionLabel = action === "approve" ? "承認" : action === "reject" ? "却下" : "承認待ちに戻す操作";
    if (!window.confirm(`${request.lastName} ${request.firstName}さんの申請を${actionLabel}しますか？`)) return;
    setReviewingUserId(request.userId);
    setError(null);
    setNotice(null);
    if (ADMIN_UI_PREVIEW) {
      if (action === "approve") {
        setMembers((current) => [...current, {
          userId: request.userId,
          email: request.email,
          firstName: request.firstName,
          lastName: request.lastName,
          role: "staff",
          isActive: true,
          lastSignInAt: null,
        }]);
      }
      setRequests((current) => current.map((candidate) => candidate.userId === request.userId
        ? { ...candidate, status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending" }
        : candidate));
      setNotice(`プレビュー：申請を${actionLabel}しました。実際のデータは変更されません。`);
      setReviewingUserId(null);
      return;
    }
    try {
      const response = await authenticatedFetch(`${WORKER_BASE_URL}/api/admin/access-requests/${encodeURIComponent(request.userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "利用申請を更新できませんでした");
      setNotice(`利用申請を${actionLabel}しました。`);
      await loadMembers();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "利用申請を更新できませんでした");
    } finally {
      setReviewingUserId(null);
    }
  }

  async function disableMember(member: StaffMember) {
    if (!window.confirm(`${member.lastName} ${member.firstName}さんを利用停止にしますか？`)) return;
    if (ADMIN_UI_PREVIEW) {
      setMembers((current) => current.map((candidate) => candidate.userId === member.userId
        ? { ...candidate, isActive: false }
        : candidate));
      setNotice("プレビュー：スタッフを利用停止にしました。実際のデータは変更されません。");
      return;
    }
    setError(null);
    const response = await authenticatedFetch(`${WORKER_BASE_URL}/api/admin/staff/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
    const result = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) return setError(result?.message ?? "スタッフを利用停止にできませんでした");
    setNotice("スタッフを利用停止にしました。");
    await loadMembers();
  }

  if (!canAdminister) return <div className="screen"><div className="header"><Link className="back-link" to="/">← 商品一覧に戻る</Link><h1>管理メニュー</h1></div><div className="content"><p className="form-error">この画面を利用する権限がありません。</p></div></div>;

  return (
    <div className="screen">
      <div className="header"><Link className="back-link" to="/">← 商品一覧に戻る</Link><h1>管理メニュー</h1><p className="subtitle">スタッフ管理</p></div>
      <div className="content admin-content">
        {ADMIN_UI_PREVIEW && <p className="preview-banner" role="status">UIプレビューモード：実際のデータは変更されません</p>}
        <section className="admin-section">
          <h2>利用申請</h2>
          {requests.filter((request) => request.status !== "approved").length === 0 ? <p className="subtitle">確認が必要な申請はありません。</p> : (
            <ul className="staff-list">{requests.filter((request) => request.status !== "approved").map((request) => (
              <li key={request.userId} className="staff-row access-request-row">
                <div>
                  <p>{request.lastName} {request.firstName}</p>
                  <p className="subtitle">{request.email} ・ {request.status === "pending" ? "承認待ち" : "却下済み"}</p>
                </div>
                <div className="staff-actions">
                  {request.status === "pending" ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={reviewingUserId === request.userId} onClick={() => void reviewRequest(request, "approve")}>承認</button>
                      <button type="button" className="btn" disabled={reviewingUserId === request.userId} onClick={() => void reviewRequest(request, "reject")}>却下</button>
                    </>
                  ) : (
                    <button type="button" className="btn" disabled={reviewingUserId === request.userId} onClick={() => void reviewRequest(request, "reopen")}>承認待ちに戻す</button>
                  )}
                </div>
              </li>
            ))}</ul>
          )}
        </section>
        {notice && <p className="list-notice" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="admin-section">
          <h2>スタッフ一覧</h2>
          {loading ? <p className="subtitle">読み込んでいます…</p> : (
            <ul className="staff-list">{members.map((member) => <li key={member.userId} className="staff-row"><div><p>{member.lastName} {member.firstName}{member.userId === account?.user.id ? "（自分）" : ""}</p><p className="subtitle">{member.email} ・ {member.role === "admin" ? "管理者" : "スタッフ"}{!member.isActive ? " ・ 利用停止" : ""}</p></div>{member.role === "staff" && member.isActive && member.userId !== account?.user.id && <button type="button" className="btn" onClick={() => void disableMember(member)}>利用停止</button>}</li>)}</ul>
          )}
        </section>
        {account && <p className="subtitle">ログイン中：{formatAccountName(account)}</p>}
      </div>
    </div>
  );
}
