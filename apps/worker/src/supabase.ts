export type SupabaseConfig = {
  url: string;
  secretKey: string;
};

export type ItemPhotoRecord = {
  item_photo_id: string;
  item_id: string;
  role: "main" | "sub";
  storage_path: string;
  square_image_id: string | null;
  width: number | null;
  height: number | null;
  sort: number;
};

export async function getItemSquareObjectId(
  config: SupabaseConfig,
  itemId: string,
): Promise<string | null> {
  const response = await supabaseRequest(
    config,
    `items?item_id=eq.${encodeURIComponent(itemId)}&select=square_object_id&limit=1`,
  );
  const rows = (await response.json()) as { square_object_id: string | null }[];
  return rows[0]?.square_object_id ?? null;
}

export async function listItemPhotos(
  config: SupabaseConfig,
  itemId: string,
): Promise<ItemPhotoRecord[]> {
  const response = await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&select=*&order=created_at.desc`,
  );
  return (await response.json()) as ItemPhotoRecord[];
}

export async function getItemPhoto(
  config: SupabaseConfig,
  itemId: string,
  itemPhotoId: string,
): Promise<ItemPhotoRecord | null> {
  const response = await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&item_photo_id=eq.${encodeURIComponent(itemPhotoId)}&select=*&limit=1`,
  );
  const rows = (await response.json()) as ItemPhotoRecord[];
  return rows[0] ?? null;
}

export async function saveItemPhotoSquareImageId(
  config: SupabaseConfig,
  itemPhotoId: string,
  squareImageId: string,
): Promise<void> {
  await supabaseRequest(
    config,
    `item_photos?item_photo_id=eq.${encodeURIComponent(itemPhotoId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ square_image_id: squareImageId }),
    },
  );
}

function assertConfig(config: SupabaseConfig) {
  if (!config.url) throw new Error("SUPABASE_URL is not configured");
  if (!config.secretKey) throw new Error("SUPABASE_SECRET_KEY is not configured");
}

async function supabaseRequest(
  config: SupabaseConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  assertConfig(config);
  const response = await fetch(`${config.url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      // Supabaseの新しいSecret keyはJWTではないため、Authorizationには設定しない。
      // バックエンドからのData API呼び出しはapikeyヘッダーだけで認証する。
      apikey: config.secretKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return response;
}

export async function getLastCatalogUpdatedAt(
  config: SupabaseConfig,
  merchantId: string,
): Promise<string | null> {
  const response = await supabaseRequest(
    config,
    `square_sync_state?merchant_id=eq.${encodeURIComponent(merchantId)}&select=last_catalog_updated_at&limit=1`,
  );
  const rows = (await response.json()) as { last_catalog_updated_at?: string }[];
  return rows[0]?.last_catalog_updated_at ?? null;
}

export async function saveCatalogUpdatedAt(
  config: SupabaseConfig,
  merchantId: string,
  updatedAt: string,
): Promise<void> {
  await supabaseRequest(config, "square_sync_state?on_conflict=merchant_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ merchant_id: merchantId, last_catalog_updated_at: updatedAt, updated_at: new Date().toISOString() }),
  });
}

export async function recordWebhookEvent(
  config: SupabaseConfig,
  eventId: string,
  eventType: string,
): Promise<void> {
  await supabaseRequest(config, "square_webhook_events?on_conflict=square_event_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ square_event_id: eventId, event_type: eventType }),
  });
}

export type SquareItemPatch = {
  mgmt_no?: string;
  title?: string;
  price?: number;
  description?: string | null;
  square_variation_id?: string;
  square_version?: number;
  square_synced_at: string;
  square_deleted_at: string | null;
  updated_at: string;
};

export async function updateItemBySquareId(
  config: SupabaseConfig,
  squareObjectId: string,
  patch: SquareItemPatch,
): Promise<void> {
  await supabaseRequest(config, `items?square_object_id=eq.${encodeURIComponent(squareObjectId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

export async function createItemPhoto(
  config: SupabaseConfig,
  photo: ItemPhotoRecord,
): Promise<ItemPhotoRecord> {
  const response = await supabaseRequest(config, "item_photos", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(photo),
  });
  const rows = (await response.json()) as ItemPhotoRecord[];
  if (!rows[0]) throw new Error("Supabase did not return the created photo");
  return rows[0];
}

export async function deleteItemPhoto(
  config: SupabaseConfig,
  itemId: string,
  itemPhotoId: string,
): Promise<ItemPhotoRecord | null> {
  const response = await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&item_photo_id=eq.${encodeURIComponent(itemPhotoId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    },
  );
  const rows = (await response.json()) as ItemPhotoRecord[];
  return rows[0] ?? null;
}

export async function deleteItemPhotosByRole(
  config: SupabaseConfig,
  itemId: string,
  role: ItemPhotoRecord["role"],
  exceptItemPhotoId: string,
): Promise<ItemPhotoRecord[]> {
  const response = await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&role=eq.${role}&item_photo_id=neq.${encodeURIComponent(exceptItemPhotoId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    },
  );
  return (await response.json()) as ItemPhotoRecord[];
}
