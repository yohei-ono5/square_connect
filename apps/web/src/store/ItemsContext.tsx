import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Item } from "@clothes-check/shared";

export type PhotoRole = "main" | "back" | "collar" | "tag" | "damage";
export type MockPhoto = { role: PhotoRole; previewUrl: string };

// Supabaseに繋ぐまでの仮のモデル。item_photosはDBでは別テーブルだが、
// ここではデモ用にItemへ持たせている。
export type MockItem = Item & { photos: MockPhoto[] };

export type QuickRegisterInput = { title: string; price: number };

type ItemsContextValue = {
  items: MockItem[];
  getItem: (id: string) => MockItem | undefined;
  addItem: (input: QuickRegisterInput) => MockItem;
  updateItem: (id: string, patch: Partial<MockItem>) => void;
  addPhoto: (id: string, role: PhotoRole, previewUrl: string) => void;
  removePhoto: (id: string, role: PhotoRole) => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

let mgmtNoCounter = 604;
let idCounter = 1;

function nextId(): string {
  return String(idCounter++);
}

function nextMgmtNo(): string {
  return String(mgmtNoCounter++).padStart(5, "0");
}

// シード用の簡易プレースホルダー画像（実際のアップロード写真が無いデモデータ用）
const PLACEHOLDER_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ccc"/></svg>',
  );

function makeItem(overrides: Partial<MockItem>): MockItem {
  return {
    id: nextId(),
    storeId: "store-1",
    status: "draft",
    mgmtNo: nextMgmtNo(),
    title: "",
    price: 0,
    brand: null,
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
    title: "ディズニー Tシャツ",
    price: 3000,
    brand: "ディズニー",
    category: "キャラクターTシャツ",
    size: "XL",
    condition: "A",
    measurements: { shoulderCm: 44.9, chestCm: 51.0, lengthCm: 67.4, sleeveCm: 17.1 },
    squareObjectId: "sq-mock-seed-1",
    photos: [{ role: "main", previewUrl: PLACEHOLDER_PHOTO }],
  }),
  makeItem({
    title: "バンドT ロックバンド",
    price: 2500,
    squareObjectId: "sq-mock-seed-2",
  }),
];

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MockItem[]>(seedItems);

  const value = useMemo<ItemsContextValue>(
    () => ({
      items,
      getItem: (id) => items.find((it) => it.id === id),
      addItem: (input) => {
        const item = makeItem({
          title: input.title,
          price: input.price,
          // 実装後はここでWorkerのSKU重複チェック→Square非公開作成を呼ぶ。今はモックなので即Square下書き扱い。
          squareObjectId: `sq-mock-${idCounter}`,
        });
        setItems((prev) => [item, ...prev]);
        return item;
      },
      updateItem: (id, patch) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      },
      addPhoto: (id, role, previewUrl) => {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, photos: [...it.photos.filter((p) => p.role !== role), { role, previewUrl }] }
              : it,
          ),
        );
      },
      removePhoto: (id, role) => {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, photos: it.photos.filter((p) => p.role !== role) } : it)),
        );
      },
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

export function isDetailComplete(item: MockItem): boolean {
  return (
    item.condition !== null &&
    item.measurements !== null &&
    item.photos.length > 0 &&
    item.brand !== null &&
    item.category !== null &&
    item.size !== null
  );
}
