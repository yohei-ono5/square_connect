import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabaseClient";
import { clearAuthenticatedImageCache } from "../components/AuthenticatedImage";
import { ADMIN_UI_PREVIEW, UI_PREVIEW_ENABLED } from "../lib/uiPreview";

export type StoreRole = "admin" | "staff";

export type CurrentAccount = {
  user: User;
  firstName: string;
  lastName: string;
  storeId: string;
  role: StoreRole;
  isSystemAdmin: boolean;
};

type AuthContextValue = {
  account: CurrentAccount | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  accessRequestStatus: "pending" | "approved" | "rejected" | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (input: { firstName: string; lastName: string }) => Promise<void>;
  reloadAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatAccountName(account: Pick<CurrentAccount, "lastName" | "firstName">) {
  return `${account.lastName} ${account.firstName}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const previewUser = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.com",
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
  } as User;
  const [session, setSession] = useState<Session | null>(ADMIN_UI_PREVIEW
    ? {
        access_token: "ui-preview",
        refresh_token: "ui-preview",
        expires_in: 3600,
        token_type: "bearer",
        user: previewUser,
      }
    : null);
  const [account, setAccount] = useState<CurrentAccount | null>(ADMIN_UI_PREVIEW
    ? {
        user: previewUser,
        firstName: "太郎",
        lastName: "管理",
        storeId: "00000000-0000-4000-8000-000000000002",
        role: "admin",
        isSystemAdmin: false,
      }
    : null);
  const [loading, setLoading] = useState(!ADMIN_UI_PREVIEW);
  const [error, setError] = useState<string | null>(null);
  const [accessRequestStatus, setAccessRequestStatus] = useState<"pending" | "approved" | "rejected" | null>(null);

  const loadAccount = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (!nextSession) {
      setAccount(null);
      setAccessRequestStatus(null);
      setError(null);
      return;
    }

    const supabase = getSupabase();
    const [profileResult, membershipResult, systemAdminResult, accessRequestResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("first_name,last_name")
        .eq("user_id", nextSession.user.id)
        .maybeSingle(),
      supabase
        .from("store_memberships")
        .select("store_id,role")
        .eq("user_id", nextSession.user.id)
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("system_admins")
        .select("user_id")
        .eq("user_id", nextSession.user.id)
        .maybeSingle(),
      supabase
        .from("store_access_requests")
        .select("status")
        .eq("user_id", nextSession.user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (systemAdminResult.error) throw systemAdminResult.error;
    if (accessRequestResult.error) throw accessRequestResult.error;
    setAccessRequestStatus((accessRequestResult.data?.status as "pending" | "approved" | "rejected" | undefined) ?? null);
    if (!profileResult.data || !membershipResult.data) {
      setAccount(null);
      setError(null);
      return;
    }

    setAccount({
      user: nextSession.user,
      firstName: normalizeName(profileResult.data.first_name),
      lastName: normalizeName(profileResult.data.last_name),
      storeId: membershipResult.data.store_id as string,
      role: membershipResult.data.role as StoreRole,
      isSystemAdmin: Boolean(systemAdminResult.data),
    });
    setError(null);
  }, []);

  const reloadAccount = useCallback(async () => {
    const { data, error: sessionError } = await getSupabase().auth.getSession();
    if (sessionError) throw sessionError;
    await loadAccount(data.session);
  }, [loadAccount]);

  useEffect(() => {
    if (ADMIN_UI_PREVIEW) return;
    let active = true;
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch (loadError) {
      console.error("Authentication configuration loading failed", loadError);
      setError("Supabaseの接続設定がありません。画面確認のみ利用できます。");
      setLoading(false);
      return () => { active = false; };
    }

    supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        if (active) return loadAccount(data.session);
      })
      .catch((loadError: unknown) => {
        console.error("Authentication loading failed", loadError);
        if (active) setError("ログイン情報を確認できませんでした。画面を再読み込みしてください。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      if (!nextSession) void clearAuthenticatedImageCache();
      setLoading(true);
      window.setTimeout(() => {
        if (!active) return;
        loadAccount(nextSession)
          .catch((loadError: unknown) => {
            console.error("Authentication state loading failed", loadError);
            setError("アカウント情報を読み込めませんでした。");
          })
          .finally(() => setLoading(false));
      }, 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadAccount]);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    session,
    loading,
    error,
    accessRequestStatus,
    loginWithGoogle: async () => {
      if (UI_PREVIEW_ENABLED) return;
      setError(null);
      const result = await getSupabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      if (result.error) throw result.error;
    },
    logout: async () => {
      if (UI_PREVIEW_ENABLED) return;
      const result = await getSupabase().auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      await clearAuthenticatedImageCache();
    },
    updateProfile: async ({ firstName, lastName }) => {
      if (UI_PREVIEW_ENABLED) {
        setAccount((current) => current ? { ...current, firstName: firstName.trim(), lastName: lastName.trim() } : current);
        return;
      }
      if (!session) throw new Error("Authentication session is not available");
      const result = await getSupabase()
        .from("profiles")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", session.user.id);
      if (result.error) throw result.error;
      await reloadAccount();
    },
    reloadAccount,
  }), [account, session, loading, error, accessRequestStatus, reloadAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
