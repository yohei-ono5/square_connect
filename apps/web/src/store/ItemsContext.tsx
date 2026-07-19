import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Item } from "@clothes-check/shared";
import type { MeasurePoints } from "@clothes-check/measure";

export type { MeasurePointKey, MeasurePoint, MeasurePoints } from "@clothes-check/measure";

// 正面写真だけが自動採寸のトリガーになる特別な役割。それ以外は撮る/撮らないが商品によって
// 違うため、背面・タグ・襟元…のような固定カテゴリを設けず「追加写真」として自由に足せる。
export type PhotoRole = "main" | "sub";
export type MockPhoto = { id: string; role: PhotoRole; previewUrl: string };

// Supabaseに繋ぐまでの仮のモデル。item_photosはDBでは別テーブルだが、
// ここではデモ用にItemへ持たせている。
export type MockItem = Item & { photos: MockPhoto[]; measurePoints?: MeasurePoints };

// 管理番号（SKU）はスタッフの手入力。共有カウンタでの自動採番はやめた。
export type QuickRegisterInput = { mgmtNo: string; title: string; price: number; photoPreviewUrl?: string };

type ItemsContextValue = {
  items: MockItem[];
  getItem: (id: string) => MockItem | undefined;
  addItem: (input: QuickRegisterInput) => MockItem;
  deleteItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<MockItem>) => void;
  addPhoto: (id: string, role: PhotoRole, previewUrl: string) => void;
  removePhoto: (id: string, photoId: string) => void;
  isMgmtNoTaken: (mgmtNo: string) => boolean;
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
      isMgmtNoTaken: (mgmtNo) => items.some((it) => normalizeMgmtNo(it.mgmtNo) === normalizeMgmtNo(mgmtNo)),
    }),
    [items],
  );

  return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems() {
  const ctx = useContext(ItemsContext);
  if (!ctx) throw new Error("useItems must be used within ItemsProvider");
  return ctx;
}

// 「詳細未設定あり」とだけ表示しても何が足りないか分からないため、具体的な項目名を返す。
// 写真タブ・採寸タブ・基本情報タブの並びに合わせた順序。
export function getMissingFieldLabels(item: MockItem): string[] {
  const missing: string[] = [];
  if (item.photos.length === 0) missing.push("写真");
  if (item.measurements === null) missing.push("採寸");
  if (item.condition === null) missing.push("コンディション");
  if (item.gender === null) missing.push("対象");
  if (item.category === null) missing.push("カテゴリ");
  if (item.size === null) missing.push("サイズ");
  return missing;
}

export function isDetailComplete(item: MockItem): boolean {
  return getMissingFieldLabels(item).length === 0;
}
