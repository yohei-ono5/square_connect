import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item } from "@square-connect/shared";
import type { MeasurePoints } from "@square-connect/measure";
import { WORKER_BASE_URL } from "../lib/config";
import { authenticatedFetch } from "../lib/authFetch";
import { AppError, toUserErrorMessage } from "../lib/appError";
import { UI_PREVIEW_ENABLED } from "../lib/uiPreview";
import {
  createItem as createStoredItem,
  deleteItemPhoto as deleteStoredPhoto,
  archiveItem as archiveStoredItem,
  discardUnregisteredItem,
  getDefaultCompanyName,
  listItemPhotos,
  listItems,
  markItemSquareSynced,
  refreshActiveItemsFromSquare as refreshStoredActiveItemsFromSquare,
  refreshItemFromSquare as refreshStoredItemFromSquare,
  saveItem as persistItem,
  saveItemPhotoDeletionDraft,
  saveSquareRegistration as persistSquareRegistration,
  syncItemPhotosToSquare as syncStoredPhotosToSquare,
  type StoredPhoto,
  type PhotoSquareSyncResult,
  type SquareListRefreshResult,
  uploadItemPhoto,
} from "../lib/itemRepository";

export type { MeasurePointKey, MeasurePoint, MeasurePoints } from "@square-connect/measure";

// 正面写真だけが自動採寸のトリガーになる特別な役割。それ以外は撮る/撮らないが商品によって
// 違うため、背面・タグ・襟元…のような固定カテゴリを設けず「追加写真」として自由に足せる。
export type PhotoRole = "main" | "sub";
export type MockPhoto = StoredPhoto;

// 商品本体・写真情報はSupabaseへ、画像ファイル本体はCloudflare R2へ保存する。
export type MockItem = Item & { photos: MockPhoto[]; measurePoints?: MeasurePoints };

// 管理番号（SKU）はスタッフの手入力。共有カウンタでの自動採番はやめた。
export type QuickRegisterInput = {
  mgmtNo: string;
  title: string;
  price: number;
  inventoryCount: number;
  category?: string | null;
  categoryId?: string | null;
  photoFiles?: File[];
};

// Square側で設定済みのカテゴリ。中カテゴリは親カテゴリのIDと名前を保持する。
export type SquareCategory = {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
};

type ItemsContextValue = {
  companyName: string | null;
  items: MockItem[];
  itemsLoading: boolean;
  itemsError: string | null;
  reloadItems: () => Promise<void>;
  getItem: (id: string) => MockItem | undefined;
  addItem: (input: QuickRegisterInput) => Promise<MockItem>;
  archiveItem: (id: string) => Promise<void>;
  discardItem: (id: string) => Promise<void>;
  updateItem: (id: string, patch: Partial<MockItem>) => void;
  saveItem: (id: string, pendingPhotoDeletionIds?: string[]) => Promise<void>;
  saveSquareRegistration: (
    id: string,
    squareObjectId: string,
    squareVariationId: string,
    description?: string,
  ) => Promise<void>;
  syncPhotosToSquare: (id: string) => Promise<PhotoSquareSyncResult>;
  addPhoto: (id: string, role: PhotoRole, file: File) => Promise<void>;
  refreshActiveItemsFromSquare: () => Promise<SquareListRefreshResult>;
  refreshItemFromSquare: (id: string) => Promise<void>;
  markSquareSynced: (id: string, description: string) => Promise<void>;
  isMgmtNoTaken: (mgmtNo: string, excludeId?: string) => boolean;
  squareCategories: SquareCategory[] | null;
  categoriesLoading: boolean;
  categoriesError: string | null;
  loadSquareCategories: () => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

function normalizeMgmtNo(mgmtNo: string): string {
  return mgmtNo.trim().toLowerCase();
}

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [companyName, setCompanyName] = useState<string | null>(UI_PREVIEW_ENABLED ? "Rosso&Nero" : null);
  const [items, setItems] = useState<MockItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(!UI_PREVIEW_ENABLED);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [squareCategories, setSquareCategories] = useState<SquareCategory[] | null>(UI_PREVIEW_ENABLED ? [] : null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const categoriesRequestedRef = useRef(false);

  useEffect(() => {
    if (UI_PREVIEW_ENABLED) return;
    let active = true;
    getDefaultCompanyName()
      .then((name) => {
        if (active) setCompanyName(name);
      })
      .catch((error: unknown) => {
        console.error("Company name loading failed", error);
      });
    return () => {
      active = false;
    };
  }, []);

  const reloadItems = useCallback(async () => {
    if (UI_PREVIEW_ENABLED) {
      setItems([]);
      setItemsError(null);
      setItemsLoading(false);
      return;
    }
    const [storedItems, storedPhotos] = await Promise.all([listItems(), listItemPhotos()]);
    setItems(storedItems.map((item) => ({
      ...item,
      photos: storedPhotos.filter((photo) => photo.itemId === item.id),
    })));
    setItemsError(null);
  }, []);

  useEffect(() => {
    if (UI_PREVIEW_ENABLED) return;
    let active = true;
    setItemsLoading(true);
    reloadItems()
      .catch((error: unknown) => {
        if (!active) return;
        setItemsError(toUserErrorMessage(error, "ITEM_LOAD"));
      })
      .finally(() => {
        if (active) setItemsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadItems]);

  // 詳細画面のuseEffectから安全に呼べるよう参照を固定する。失敗時も自動で再試行を
  // 繰り返さず、画面を開いている間は結果（成功・空・失敗）をそのまま表示する。
  const loadSquareCategories = useCallback(() => {
    if (UI_PREVIEW_ENABLED) {
      setSquareCategories([]);
      return;
    }
    if (categoriesRequestedRef.current) return;
    categoriesRequestedRef.current = true;
    setCategoriesLoading(true);
    setCategoriesError(null);
    authenticatedFetch(`${WORKER_BASE_URL}/api/square/categories`)
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as
          | { categories?: SquareCategory[]; message?: string }
          | null;
        if (!response.ok || !Array.isArray(result?.categories)) {
          throw new AppError("SQUARE_CATEGORIES", result, result?.message);
        }
        setSquareCategories(result.categories);
      })
      .catch((error: unknown) => {
        setCategoriesError(toUserErrorMessage(error, "SQUARE_CATEGORIES"));
      })
      .finally(() => setCategoriesLoading(false));
  }, []);

  const value = useMemo<ItemsContextValue>(
    () => ({
      companyName,
      items,
      itemsLoading,
      itemsError,
      reloadItems,
      getItem: (id) => items.find((it) => it.id === id),
      addItem: async (input) => {
        const storedItem = await createStoredItem({
          mgmtNo: input.mgmtNo.trim(),
          title: input.title.trim(),
          price: input.price,
          inventoryCount: input.inventoryCount,
          category: input.category ?? null,
          categoryId: input.categoryId ?? null,
        });
        let item: MockItem = {
          ...storedItem,
          photos: [],
        };
        setItems((prev) => [item, ...prev]);
        if (input.photoFiles?.length) {
          const uploadedPhotos: MockPhoto[] = [];
          try {
            for (const [index, file] of input.photoFiles.entries()) {
              const { photo } = await uploadItemPhoto(item.id, index === 0 ? "main" : "sub", file);
              uploadedPhotos.push(photo);
            }
            item = { ...item, photos: uploadedPhotos };
            setItems((prev) => prev.map((candidate) => candidate.id === item.id ? item : candidate));
          } catch (error) {
            const photoCleanup = await Promise.allSettled(
              uploadedPhotos.map((photo) => deleteStoredPhoto(item.id, photo.id)),
            );
            for (const result of photoCleanup) {
              if (result.status === "rejected") console.error("Temporary photo cleanup failed", result.reason);
            }
            await discardUnregisteredItem(item.id).catch((cleanupError) => {
              console.error("Temporary item cleanup failed", cleanupError);
            });
            setItems((prev) => prev.filter((candidate) => candidate.id !== item.id));
            throw error;
          }
        }
        return item;
      },
      archiveItem: async (id) => {
        // アーカイブではSquareやR2のデータを変更せず、Supabase上で一覧から
        // 非表示にするだけに留める。Squareの商品IDと写真はそのまま保持する。
        await archiveStoredItem(id);
        setItems((prev) => prev.filter((it) => it.id !== id));
      },
      discardItem: async (id) => {
        // 呼び出し元が商品作成直後の古いstateを参照していても、保存済み写真を
        // 取りこぼさないようリポジトリから最新一覧を取得して削除する。
        const storedPhotos = await listItemPhotos();
        const photoCleanup = await Promise.allSettled(
          storedPhotos
            .filter((photo) => photo.itemId === id)
            .map((photo) => deleteStoredPhoto(id, photo.id)),
        );
        for (const result of photoCleanup) {
          if (result.status === "rejected") {
            console.error("Temporary photo cleanup failed", result.reason);
            throw result.reason;
          }
        }
        await discardUnregisteredItem(id);
        setItems((prev) => prev.filter((candidate) => candidate.id !== id));
      },
      updateItem: (id, patch) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      },
      saveItem: async (id, pendingPhotoDeletionIds) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) throw new AppError("ITEM_NOT_FOUND");
        const nextPendingIds = pendingPhotoDeletionIds
          ?? item.photos.filter((photo) => photo.pendingDelete).map((photo) => photo.id);
        await saveItemPhotoDeletionDraft(id, nextPendingIds);
        await persistItem(item);
        await reloadItems();
      },
      saveSquareRegistration: async (id, squareObjectId, squareVariationId, description) => {
        const syncedAt = await persistSquareRegistration(
          id,
          squareObjectId,
          squareVariationId,
          description,
        );
        const storedPhotos = await listItemPhotos();
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "pushed",
                  squareObjectId,
                  ...(description !== undefined ? { description } : {}),
                  updatedAt: syncedAt,
                  squareSyncedAt: syncedAt,
                  squareDeletedAt: null,
                  photos: storedPhotos.filter((photo) => photo.itemId === id),
                }
              : item,
          ),
        );
      },
      syncPhotosToSquare: async (id) => {
        const synced = await syncStoredPhotosToSquare(id);
        const storedPhotos = await listItemPhotos();
        setItems((prev) => prev.map((item) => item.id === id
          ? { ...item, photos: storedPhotos.filter((photo) => photo.itemId === id) }
          : item));
        return synced;
      },
      addPhoto: async (id, role, file) => {
        const { photo } = await uploadItemPhoto(id, role, file);
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it;
            // 新しい正面写真を先頭に表示し、古い正面写真はSquare更新が成功するまで
            // 内部に保持する。更新失敗時もSquare・R2・Supabaseの対応を崩さない。
            return { ...it, photos: role === "main" ? [photo, ...it.photos] : [...it.photos, photo] };
          }),
        );
      },
      refreshActiveItemsFromSquare: async () => {
        const result = await refreshStoredActiveItemsFromSquare();
        await reloadItems();
        return result;
      },
      refreshItemFromSquare: async (id) => {
        const latest = await refreshStoredItemFromSquare(id);
        setItems((prev) => prev.map((item) => {
          if (item.id !== id) return item;
          if (latest.isDeleted) {
            return {
              ...item,
              ...(latest.changed ? { updatedAt: latest.syncedAt } : {}),
              squareSyncedAt: latest.syncedAt,
              squareDeletedAt: latest.syncedAt,
            };
          }
          return {
            ...item,
            ...(latest.mgmtNo !== undefined ? { mgmtNo: latest.mgmtNo } : {}),
            ...(latest.title !== undefined ? { title: latest.title } : {}),
            ...(latest.price !== undefined ? { price: latest.price } : {}),
            ...(latest.inventoryCount !== undefined ? { inventoryCount: latest.inventoryCount } : {}),
            description: latest.description,
            categoryId: latest.categoryId,
            ...(latest.changed ? { updatedAt: latest.syncedAt } : {}),
            squareSyncedAt: latest.syncedAt,
            squareDeletedAt: null,
          };
        }));
        if (latest.isDeleted) {
          throw new AppError(
            "SQUARE_ITEM_REFRESH",
            undefined,
            "Square側ではこの商品が削除されています。",
          );
        }
      },
      markSquareSynced: async (id, description) => {
        const syncedAt = await markItemSquareSynced(id, description);
        setItems((prev) => prev.map((item) => item.id === id
          ? { ...item, description, squareSyncedAt: syncedAt, squareDeletedAt: null }
          : item));
      },
      // 手入力のSKUが商品一覧内で既に使われていないかの事前チェック（Square側の重複チェックとは別に、
      // ローカルの下書き同士の衝突もここで防ぐ）。
      isMgmtNoTaken: (mgmtNo, excludeId) =>
        items.some((it) => it.id !== excludeId && normalizeMgmtNo(it.mgmtNo) === normalizeMgmtNo(mgmtNo)),
      squareCategories,
      categoriesLoading,
      categoriesError,
      // カテゴリはSquare側で頻繁に変わるものではないため、セッション中に1回だけ取得してキャッシュする。
      loadSquareCategories,
    }),
    [companyName, items, itemsLoading, itemsError, reloadItems, squareCategories, categoriesLoading, categoriesError, loadSquareCategories],
  );

  return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems() {
  const ctx = useContext(ItemsContext);
  if (!ctx) throw new Error("useItems must be used within ItemsProvider");
  return ctx;
}

// 詳細入力状況（写真・採寸・基本情報が埋まっているか）のトラッキングは、一旦廃止して作り直す予定。
// 一覧のバッジ・フィルタ・統計はSquareへの登録・同期状態を基準にする。
