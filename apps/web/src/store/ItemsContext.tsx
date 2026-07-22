import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item } from "@square-connect/shared";
import type { MeasurePoints } from "@square-connect/measure";
import { WORKER_BASE_URL } from "../lib/config";
import {
  createItem as createStoredItem,
  deleteItemPhoto as deleteStoredPhoto,
  archiveItem as archiveStoredItem,
  discardUnregisteredItem,
  listItemPhotos,
  listItems,
  markItemSquareSynced,
  refreshItemFromSquare as refreshStoredItemFromSquare,
  saveItem as persistItem,
  saveSquareRegistration as persistSquareRegistration,
  syncItemPhotosToSquare as syncStoredPhotosToSquare,
  type StoredPhoto,
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
export type QuickRegisterInput = { mgmtNo: string; title: string; price: number; photoFile?: File };

// Square側で設定済みのカテゴリ（parentNameは親カテゴリがある場合のみ、表示用に「親 > 子」を組み立てる）。
export type SquareCategory = { id: string; name: string; parentName: string | null };

type ItemsContextValue = {
  items: MockItem[];
  itemsLoading: boolean;
  itemsError: string | null;
  reloadItems: () => Promise<void>;
  getItem: (id: string) => MockItem | undefined;
  addItem: (input: QuickRegisterInput) => Promise<MockItem>;
  archiveItem: (id: string) => Promise<void>;
  discardItem: (id: string) => Promise<void>;
  updateItem: (id: string, patch: Partial<MockItem>) => void;
  saveItem: (id: string) => Promise<void>;
  saveSquareRegistration: (id: string, squareObjectId: string, squareVariationId: string) => Promise<void>;
  syncPhotosToSquare: (id: string) => Promise<number>;
  addPhoto: (id: string, role: PhotoRole, file: File) => Promise<string | null>;
  removePhoto: (id: string, photoId: string) => Promise<void>;
  refreshItemFromSquare: (id: string) => Promise<void>;
  markSquareSynced: (id: string) => Promise<void>;
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
  const [items, setItems] = useState<MockItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [squareCategories, setSquareCategories] = useState<SquareCategory[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const categoriesRequestedRef = useRef(false);

  const reloadItems = useCallback(async () => {
    const [storedItems, storedPhotos] = await Promise.all([listItems(), listItemPhotos()]);
    setItems(storedItems.map((item) => ({
      ...item,
      photos: storedPhotos.filter((photo) => photo.itemId === item.id),
    })));
    setItemsError(null);
  }, []);

  useEffect(() => {
    let active = true;
    setItemsLoading(true);
    reloadItems()
      .catch((error: unknown) => {
        if (!active) return;
        setItemsError(error instanceof Error ? error.message : "商品一覧の取得に失敗しました");
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
    if (categoriesRequestedRef.current) return;
    categoriesRequestedRef.current = true;
    setCategoriesLoading(true);
    setCategoriesError(null);
    fetch(`${WORKER_BASE_URL}/api/square/categories`)
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as
          | { categories?: SquareCategory[]; message?: string }
          | null;
        if (!response.ok || !Array.isArray(result?.categories)) {
          throw new Error(result?.message ?? "カテゴリの取得に失敗しました");
        }
        setSquareCategories(result.categories);
      })
      .catch((error: unknown) => {
        setCategoriesError(error instanceof Error ? error.message : "カテゴリの取得に失敗しました");
      })
      .finally(() => setCategoriesLoading(false));
  }, []);

  const value = useMemo<ItemsContextValue>(
    () => ({
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
        });
        let item: MockItem = {
          ...storedItem,
          photos: [],
        };
        setItems((prev) => [item, ...prev]);
        if (input.photoFile) {
          try {
            const { photo } = await uploadItemPhoto(item.id, "main", input.photoFile);
            item = { ...item, photos: [photo] };
            setItems((prev) => prev.map((candidate) => candidate.id === item.id ? item : candidate));
          } catch (error) {
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
        const item = items.find((candidate) => candidate.id === id);
        if (item) {
          const photoCleanup = await Promise.allSettled(
            item.photos.map((photo) => deleteStoredPhoto(id, photo.id)),
          );
          for (const result of photoCleanup) {
            if (result.status === "rejected") console.error("Temporary photo cleanup failed", result.reason);
          }
        }
        await discardUnregisteredItem(id);
        setItems((prev) => prev.filter((candidate) => candidate.id !== id));
      },
      updateItem: (id, patch) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      },
      saveItem: async (id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) throw new Error("保存対象の商品が見つかりません");
        const updatedAt = await persistItem(item);
        setItems((prev) => prev.map((candidate) => candidate.id === id
          ? { ...candidate, updatedAt }
          : candidate));
      },
      saveSquareRegistration: async (id, squareObjectId, squareVariationId) => {
        const syncedAt = await persistSquareRegistration(id, squareObjectId, squareVariationId);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "pushed",
                  squareObjectId,
                  updatedAt: syncedAt,
                  squareSyncedAt: syncedAt,
                  squareDeletedAt: null,
                }
              : item,
          ),
        );
      },
      syncPhotosToSquare: (id) => syncStoredPhotosToSquare(id),
      addPhoto: async (id, role, file) => {
        const { photo, squareSyncWarning } = await uploadItemPhoto(id, role, file);
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it;
            // 正面は1枚のみ（既存を置き換え）。追加写真は何枚でも足せる。
            const kept = role === "main" ? it.photos.filter((p) => p.role !== "main") : it.photos;
            return { ...it, photos: [...kept, photo] };
          }),
        );
        return squareSyncWarning;
      },
      removePhoto: async (id, photoId) => {
        await deleteStoredPhoto(id, photoId);
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, photos: it.photos.filter((p) => p.id !== photoId) } : it)),
        );
      },
      refreshItemFromSquare: async (id) => {
        const latest = await refreshStoredItemFromSquare(id);
        setItems((prev) => prev.map((item) => {
          if (item.id !== id) return item;
          if (latest.isDeleted) {
            return { ...item, updatedAt: latest.syncedAt, squareSyncedAt: latest.syncedAt, squareDeletedAt: latest.syncedAt };
          }
          return {
            ...item,
            ...(latest.mgmtNo !== undefined ? { mgmtNo: latest.mgmtNo } : {}),
            ...(latest.title !== undefined ? { title: latest.title } : {}),
            ...(latest.price !== undefined ? { price: latest.price } : {}),
            description: latest.description,
            updatedAt: latest.syncedAt,
            squareSyncedAt: latest.syncedAt,
            squareDeletedAt: null,
          };
        }));
        if (latest.isDeleted) throw new Error("Square側ではこの商品が削除されています");
      },
      markSquareSynced: async (id) => {
        const syncedAt = await markItemSquareSynced(id);
        setItems((prev) => prev.map((item) => item.id === id
          ? { ...item, squareSyncedAt: syncedAt, squareDeletedAt: null }
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
    [items, itemsLoading, itemsError, reloadItems, squareCategories, categoriesLoading, categoriesError, loadSquareCategories],
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
