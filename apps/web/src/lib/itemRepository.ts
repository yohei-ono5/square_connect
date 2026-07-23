import type { Condition, Gender, Item, ItemStatus } from "@square-connect/shared";
import { WORKER_BASE_URL } from "./config";
import { getSupabase } from "./supabaseClient";

export type StoredPhoto = {
  id: string;
  itemId: string;
  role: "main" | "sub";
  storagePath: string;
  previewUrl: string;
  squareImageId: string | null;
};

type PhotoRow = {
  item_photo_id: string;
  item_id: string;
  role: "main" | "sub";
  storage_path: string;
  square_image_id: string | null;
};

export const MAX_SQUARE_IMAGE_BYTES = 15_000_000;
export const SQUARE_IMAGE_ACCEPT = "image/jpeg,image/pjpeg,image/png,image/gif";
const SQUARE_IMAGE_TYPES = new Set(["image/jpeg", "image/pjpeg", "image/png", "image/gif"]);

type ItemRow = {
  item_id: string;
  store_id: string;
  status: ItemStatus;
  mgmt_no: string;
  title: string;
  price: number;
  gender: Gender;
  category: string | null;
  size: string | null;
  condition: Condition;
  m_shoulder: number | null;
  m_chest: number | null;
  m_length: number | null;
  m_sleeve: number | null;
  description: string | null;
  square_object_id: string | null;
  updated_at: string;
  square_synced_at: string | null;
  square_deleted_at: string | null;
};

const ITEM_COLUMNS = [
  "item_id",
  "store_id",
  "status",
  "mgmt_no",
  "title",
  "price",
  "gender",
  "category",
  "size",
  "condition",
  "m_shoulder",
  "m_chest",
  "m_length",
  "m_sleeve",
  "description",
  "square_object_id",
  "updated_at",
  "square_synced_at",
  "square_deleted_at",
].join(",");

let defaultStoreIdPromise: Promise<string> | null = null;

function rowToItem(row: ItemRow): Item {
  const hasMeasurements =
    row.m_shoulder !== null || row.m_chest !== null || row.m_length !== null || row.m_sleeve !== null;
  return {
    id: row.item_id,
    storeId: row.store_id,
    status: row.status,
    mgmtNo: row.mgmt_no,
    title: row.title,
    price: row.price,
    gender: row.gender,
    category: row.category,
    size: row.size,
    condition: row.condition,
    measurements: hasMeasurements
      ? {
          shoulderCm: row.m_shoulder,
          chestCm: row.m_chest,
          lengthCm: row.m_length,
          sleeveCm: row.m_sleeve,
        }
      : null,
    description: row.description,
    squareObjectId: row.square_object_id,
    updatedAt: row.updated_at,
    squareSyncedAt: row.square_synced_at,
    squareDeletedAt: row.square_deleted_at,
  };
}

function repositoryError(action: string, error: { message: string } | null): Error {
  return new Error(error ? `${action}: ${error.message}` : action);
}

function photoRowToStoredPhoto(row: PhotoRow): StoredPhoto {
  return {
    id: row.item_photo_id,
    itemId: row.item_id,
    role: row.role,
    storagePath: row.storage_path,
    previewUrl: `${WORKER_BASE_URL}/media/${row.storage_path}`,
    squareImageId: row.square_image_id,
  };
}

export function validateSquareImage(file: File): string | null {
  if (!SQUARE_IMAGE_TYPES.has(file.type)) return "JPEG・PJPEG・PNG・GIF形式の画像を選択してください";
  if (file.size === 0) return "画像ファイルが空です";
  if (file.size > MAX_SQUARE_IMAGE_BYTES) return "画像は15MB以下にしてください";
  return null;
}

async function resolveDefaultStoreId(): Promise<string> {
  const configuredStoreId = import.meta.env.VITE_DEFAULT_STORE_ID?.trim();
  if (configuredStoreId) return configuredStoreId;

  const supabase = getSupabase();
  const existing = await supabase.from("stores").select("store_id").order("created_at").limit(1);
  if (existing.error) throw repositoryError("店舗の取得に失敗しました", existing.error);
  if (existing.data?.[0]?.store_id) return existing.data[0].store_id as string;

  const created = await supabase
    .from("stores")
    .insert({ company_name: "検証用企業", store_name: "検証用店舗" })
    .select("store_id")
    .single();
  if (created.error || !created.data?.store_id) {
    throw repositoryError("検証用店舗の作成に失敗しました", created.error);
  }
  return created.data.store_id as string;
}

function getDefaultStoreId(): Promise<string> {
  defaultStoreIdPromise ??= resolveDefaultStoreId();
  return defaultStoreIdPromise;
}

export async function listItems(): Promise<Item[]> {
  const result = await getSupabase()
    .from("items")
    .select(ITEM_COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (result.error) throw repositoryError("商品一覧の取得に失敗しました", result.error);
  return (result.data as unknown as ItemRow[]).map(rowToItem);
}

export async function listItemPhotos(): Promise<StoredPhoto[]> {
  const result = await getSupabase()
    .from("item_photos")
    .select("item_photo_id,item_id,role,storage_path,square_image_id")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: false });
  if (result.error) throw repositoryError("写真一覧の取得に失敗しました", result.error);
  return (result.data as unknown as PhotoRow[]).map(photoRowToStoredPhoto);
}

export async function uploadItemPhoto(
  itemId: string,
  role: StoredPhoto["role"],
  file: File,
): Promise<{ photo: StoredPhoto }> {
  const validationMessage = validateSquareImage(file);
  if (validationMessage) throw new Error(validationMessage);

  const body = new FormData();
  body.append("role", role);
  body.append("file", file, file.name);
  const response = await fetch(`${WORKER_BASE_URL}/api/items/${encodeURIComponent(itemId)}/photos`, {
    method: "POST",
    body,
  });
  const result = (await response.json().catch(() => null)) as {
    photo?: StoredPhoto;
    message?: string;
  } | null;
  if (!response.ok || !result?.photo) throw new Error(result?.message ?? "写真の保存に失敗しました");
  return { photo: result.photo };
}

export async function syncItemPhotosToSquare(itemId: string): Promise<number> {
  const response = await fetch(
    `${WORKER_BASE_URL}/api/items/${encodeURIComponent(itemId)}/photos/sync-to-square`,
    { method: "POST" },
  );
  const result = (await response.json().catch(() => null)) as { synced?: number; message?: string } | null;
  if (!response.ok) throw new Error(result?.message ?? "写真をSquareへ反映できませんでした");
  return result?.synced ?? 0;
}

export type SquareItemRefresh = {
  squareObjectId: string;
  isDeleted: boolean;
  mgmtNo?: string;
  title?: string;
  price?: number;
  description: string | null;
  syncedAt: string;
};

export async function refreshItemFromSquare(itemId: string): Promise<SquareItemRefresh> {
  const response = await fetch(
    `${WORKER_BASE_URL}/api/items/${encodeURIComponent(itemId)}/sync-from-square`,
    { method: "POST" },
  );
  const result = (await response.json().catch(() => null)) as
    | { item?: Omit<SquareItemRefresh, "syncedAt">; syncedAt?: string; message?: string }
    | null;
  if (!response.ok || !result?.item) {
    throw new Error(result?.message ?? "Squareの最新情報を取得できませんでした");
  }
  return { ...result.item, syncedAt: result.syncedAt ?? new Date().toISOString() };
}

export async function deleteItemPhoto(itemId: string, itemPhotoId: string): Promise<void> {
  const response = await fetch(
    `${WORKER_BASE_URL}/api/items/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(itemPhotoId)}`,
    { method: "DELETE" },
  );
  const result = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(result?.message ?? "写真の削除に失敗しました");
}

export async function createItem(input: {
  mgmtNo: string;
  title: string;
  price: number;
}): Promise<Item> {
  const storeId = await getDefaultStoreId();
  const result = await getSupabase()
    .from("items")
    .insert({
      store_id: storeId,
      status: "draft",
      mgmt_no: input.mgmtNo,
      title: input.title,
      price: input.price,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (result.error || !result.data) throw repositoryError("商品の保存に失敗しました", result.error);
  return rowToItem(result.data as unknown as ItemRow);
}

export async function saveItem(item: Item): Promise<string> {
  const updatedAt = new Date().toISOString();
  const result = await getSupabase()
    .from("items")
    .update({
      status: item.status,
      mgmt_no: item.mgmtNo.trim(),
      title: item.title.trim(),
      price: item.price,
      gender: item.gender,
      category: item.category,
      size: item.size,
      condition: item.condition,
      m_shoulder: item.measurements?.shoulderCm ?? null,
      m_chest: item.measurements?.chestCm ?? null,
      m_length: item.measurements?.lengthCm ?? null,
      m_sleeve: item.measurements?.sleeveCm ?? null,
      description: item.description,
      updated_at: updatedAt,
    })
    .eq("item_id", item.id);
  if (result.error) throw repositoryError("商品の更新に失敗しました", result.error);
  return updatedAt;
}

export async function saveSquareRegistration(
  itemId: string,
  squareObjectId: string,
  squareVariationId: string,
): Promise<string> {
  const now = new Date().toISOString();
  const result = await getSupabase()
    .from("items")
    .update({
      status: "pushed",
      square_object_id: squareObjectId,
      square_variation_id: squareVariationId,
      square_synced_at: now,
      updated_at: now,
    })
    .eq("item_id", itemId);
  if (result.error) throw repositoryError("Square登録結果の保存に失敗しました", result.error);
  return now;
}

export async function markItemSquareSynced(itemId: string): Promise<string> {
  const syncedAt = new Date().toISOString();
  const result = await getSupabase()
    .from("items")
    .update({ square_synced_at: syncedAt, square_deleted_at: null })
    .eq("item_id", itemId);
  if (result.error) throw repositoryError("Square同期結果の保存に失敗しました", result.error);
  return syncedAt;
}

export async function archiveItem(itemId: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await getSupabase()
    .from("items")
    .update({ deleted_at: now, updated_at: now })
    .eq("item_id", itemId);
  if (result.error) throw repositoryError("商品のアーカイブに失敗しました", result.error);
}

// Square登録に失敗した新規商品だけを完全破棄する。Square IDが付いた商品は誤って
// 消さないよう条件に含め、通常の商品アーカイブ（論理削除）とは明確に分ける。
export async function discardUnregisteredItem(itemId: string): Promise<void> {
  const result = await getSupabase()
    .from("items")
    .delete()
    .eq("item_id", itemId)
    .is("square_object_id", null);
  if (result.error) throw repositoryError("一時商品の破棄に失敗しました", result.error);
}
