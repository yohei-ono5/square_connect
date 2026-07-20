import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item } from "@square-connect/shared";
import type { MeasurePoints } from "@square-connect/measure";
import { WORKER_BASE_URL } from "../lib/config";

export type { MeasurePointKey, MeasurePoint, MeasurePoints } from "@square-connect/measure";

// 正面写真だけが自動採寸のトリガーになる特別な役割。それ以外は撮る/撮らないが商品によって
// 違うため、背面・タグ・襟元…のような固定カテゴリを設けず「追加写真」として自由に足せる。
export type PhotoRole = "main" | "sub";
export type MockPhoto = { id: string; role: PhotoRole; previewUrl: string };

// Supabaseに繋ぐまでの仮のモデル。item_photosはDBでは別テーブルだが、
// ここではデモ用にItemへ持たせている。
export type MockItem = Item & { photos: MockPhoto[]; measurePoints?: MeasurePoints };

// 管理番号（SKU）はスタッフの手入力。共有カウンタでの自動採番はやめた。
export type QuickRegisterInput = { mgmtNo: string; title: string; price: number; photoPreviewUrl?: string };

// Square側で設定済みのカテゴリ（parentNameは親カテゴリがある場合のみ、表示用に「親 > 子」を組み立てる）。
export type SquareCategory = { id: string; name: string; parentName: string | null };

type ItemsContextValue = {
  items: MockItem[];
  getItem: (id: string) => MockItem | undefined;
  addItem: (input: QuickRegisterInput) => MockItem;
  deleteItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<MockItem>) => void;
  addPhoto: (id: string, role: PhotoRole, previewUrl: string) => void;
  removePhoto: (id: string, photoId: string) => void;
  isMgmtNoTaken: (mgmtNo: string, excludeId?: string) => boolean;
  squareCategories: SquareCategory[] | null;
  categoriesLoading: boolean;
  categoriesError: string | null;
  loadSquareCategories: () => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

let idCounter = 1;
let photoIdCounter = 1;

function nextId(): string {
  return String(idCounter++);
}

function nextPhotoId(): string {
  return `photo-${photoIdCounter++}`;
}

// シード用の簡易プレースホルダー画像（実際のアップロード写真が無いデモデータ用）
const PLACEHOLDER_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ccc"/></svg>',
  );

function makeItem(overrides: Partial<MockItem> & { mgmtNo: string }): MockItem {
  return {
    id: nextId(),
    storeId: "store-1",
    status: "draft",
    title: "",
    price: 0,
    gender: null,
    category: null,
    size: null,
    condition: null,
    measurements: null,
    description: null,
    squareObjectId: null,
    photos: [],
    ...overrides,
  };
}

// 一覧が空だと状態バッジの見え方を確認できないため、サンプルを2件だけ入れておく。
const seedItems: MockItem[] = [
  makeItem({
    mgmtNo: "00604",
    title: "ディズニー Tシャツ",
    price: 3000,
    gender: "unisex",
    category: "キャラクターTシャツ",
    size: "XL",
    condition: "A",
    measurements: { shoulderCm: 44.9, chestCm: 51.0, lengthCm: 67.4, sleeveCm: 17.1 },
    squareObjectId: "sq-mock-seed-1",
    photos: [{ id: nextPhotoId(), role: "main", previewUrl: PLACEHOLDER_PHOTO }],
  }),
  makeItem({
    mgmtNo: "00605",
    title: "バンドT ロックバンド",
    price: 2500,
    squareObjectId: "sq-mock-seed-2",
  }),
];

function normalizeMgmtNo(mgmtNo: string): string {
  return mgmtNo.trim().toLowerCase();
}

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MockItem[]>(seedItems);
  const [squareCategories, setSquareCategories] = useState<SquareCategory[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const categoriesRequestedRef = useRef(false);

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
      getItem: (id) => items.find((it) => it.id === id),
      addItem: (input) => {
        const item = makeItem({
          mgmtNo: input.mgmtNo.trim(),
          title: input.title,
          price: input.price,
          photos: input.photoPreviewUrl
            ? [{ id: nextPhotoId(), role: "main", previewUrl: input.photoPreviewUrl }]
            : [],
        });
        setItems((prev) => [item, ...prev]);
        return item;
      },
      deleteItem: (id) => {
        setItems((prev) => prev.filter((it) => it.id !== id));
      },
      updateItem: (id, patch) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      },
      addPhoto: (id, role, previewUrl) => {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it;
            // 正面は1枚のみ（既存を置き換え）。追加写真は何枚でも足せる。
            const kept = role === "main" ? it.photos.filter((p) => p.role !== "main") : it.photos;
            return { ...it, photos: [...kept, { id: nextPhotoId(), role, previewUrl }] };
          }),
        );
      },
      removePhoto: (id, photoId) => {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, photos: it.photos.filter((p) => p.id !== photoId) } : it)),
        );
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
    [items, squareCategories, categoriesLoading, categoriesError, loadSquareCategories],
  );

  return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems() {
  const ctx = useContext(ItemsContext);
  if (!ctx) throw new Error("useItems must be used within ItemsProvider");
  return ctx;
}

// 詳細入力状況（写真・採寸・基本情報が埋まっているか）のトラッキングは、一旦廃止して作り直す予定。
// バッジ・フィルタ・統計は当面 squareObjectId（Square登録済みかどうか）だけを基準にする。
