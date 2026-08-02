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
  pending_delete_at: string | null;
  deleted_at: string | null;
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

export type ActiveSquareItem = {
  square_object_id: string;
  square_variation_id: string | null;
  mgmt_no: string;
  title: string;
  price: number;
  inventory_count: number;
  description: string | null;
  square_category_id: string | null;
  square_deleted_at: string | null;
};

const ACTIVE_SQUARE_ITEM_COLUMNS =
  "square_object_id,square_variation_id,mgmt_no,title,price,inventory_count,description,square_category_id,square_deleted_at";

export async function getActiveSquareItem(
  config: SupabaseConfig,
  itemId: string,
): Promise<ActiveSquareItem | null> {
  const response = await supabaseRequest(
    config,
    `items?item_id=eq.${encodeURIComponent(itemId)}&deleted_at=is.null&square_object_id=not.is.null&select=${ACTIVE_SQUARE_ITEM_COLUMNS}&limit=1`,
  );
  const rows = (await response.json()) as Array<ActiveSquareItem & { square_object_id: string | null }>;
  const row = rows[0];
  return row?.square_object_id ? { ...row, square_object_id: row.square_object_id } : null;
}

export async function listActiveSquareItems(config: SupabaseConfig, storeId?: string): Promise<ActiveSquareItem[]> {
  const response = await supabaseRequest(
    config,
    `items?deleted_at=is.null&square_object_id=not.is.null${storeId ? `&store_id=eq.${encodeURIComponent(storeId)}` : ""}&select=${ACTIVE_SQUARE_ITEM_COLUMNS}`,
  );
  const rows = (await response.json()) as Array<ActiveSquareItem & { square_object_id: string | null }>;
  const items = new Map<string, ActiveSquareItem>();
  for (const row of rows) {
    if (row.square_object_id) {
      items.set(row.square_object_id, { ...row, square_object_id: row.square_object_id });
    }
  }
  return [...items.values()];
}

export async function listItemPhotos(
  config: SupabaseConfig,
  itemId: string,
): Promise<ItemPhotoRecord[]> {
  const response = await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&deleted_at=is.null&select=*&order=created_at.desc`,
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
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&item_photo_id=eq.${encodeURIComponent(itemPhotoId)}&deleted_at=is.null&select=*&limit=1`,
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

export type RequestAccount = {
  userId: string;
  storeId: string;
  role: "admin" | "staff";
  isSystemAdmin: boolean;
};

export async function verifySupabaseUser(
  config: SupabaseConfig,
  authorization: string,
): Promise<{ id: string; email?: string } | null> {
  assertConfig(config);
  const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: config.secretKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email } : null;
}

export async function getRequestAccount(
  config: SupabaseConfig,
  userId: string,
): Promise<RequestAccount | null> {
  const [membershipResponse, systemAdminResponse] = await Promise.all([
    supabaseRequest(config, `store_memberships?user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&select=store_id,role&order=created_at.asc&limit=1`),
    supabaseRequest(config, `system_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`),
  ]);
  const memberships = await membershipResponse.json() as Array<{ store_id: string; role: "admin" | "staff" }>;
  const systemAdmins = await systemAdminResponse.json() as Array<{ user_id: string }>;
  const membership = memberships[0];
  if (!membership) return null;
  return { userId, storeId: membership.store_id, role: membership.role, isSystemAdmin: systemAdmins.length > 0 };
}

export async function getItemStoreId(config: SupabaseConfig, itemId: string): Promise<string | null> {
  const response = await supabaseRequest(config, `items?item_id=eq.${encodeURIComponent(itemId)}&select=store_id&limit=1`);
  const rows = await response.json() as Array<{ store_id: string }>;
  return rows[0]?.store_id ?? null;
}

export type StaffMembership = {
  user_id: string;
  role: "admin" | "staff";
  is_active: boolean;
  profile: { first_name: string; last_name: string } | null;
};

export type StoreAccessRequest = {
  user_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  profile: { first_name: string; last_name: string } | null;
};

export async function listStoreStaff(config: SupabaseConfig, storeId: string): Promise<StaffMembership[]> {
  const response = await supabaseRequest(config, `store_memberships?store_id=eq.${encodeURIComponent(storeId)}&select=user_id,role,is_active,profile:profiles!store_memberships_user_id_fkey(first_name,last_name)&order=created_at.asc`);
  return await response.json() as StaffMembership[];
}

export async function upsertStaffMembership(
  config: SupabaseConfig,
  input: { storeId: string; userId: string; approvedBy: string },
): Promise<void> {
  await supabaseRequest(config, "store_memberships?on_conflict=store_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      store_id: input.storeId,
      user_id: input.userId,
      role: "staff",
      is_active: true,
      approved_by: input.approvedBy,
      disabled_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function findStoreByRegistrationCodeHash(
  config: SupabaseConfig,
  codeHash: string,
): Promise<string | null> {
  const response = await supabaseRequest(
    config,
    `store_registration_codes?code_hash=eq.${encodeURIComponent(codeHash)}&select=store_id&limit=1`,
  );
  const rows = await response.json() as Array<{ store_id: string }>;
  return rows[0]?.store_id ?? null;
}

export async function submitStoreAccessRequest(
  config: SupabaseConfig,
  input: { storeId: string; userId: string; firstName: string; lastName: string },
): Promise<void> {
  await supabaseRequest(config, `profiles?user_id=eq.${encodeURIComponent(input.userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      first_name: input.firstName,
      last_name: input.lastName,
      updated_at: new Date().toISOString(),
    }),
  });
  await supabaseRequest(config, "store_access_requests?on_conflict=store_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      store_id: input.storeId,
      user_id: input.userId,
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function listStoreAccessRequests(
  config: SupabaseConfig,
  storeId: string,
): Promise<StoreAccessRequest[]> {
  const response = await supabaseRequest(
    config,
    `store_access_requests?store_id=eq.${encodeURIComponent(storeId)}&select=user_id,status,created_at,updated_at,profile:profiles!store_access_requests_user_id_fkey(first_name,last_name)&order=created_at.asc`,
  );
  return await response.json() as StoreAccessRequest[];
}

export async function getStoreAccessRequest(
  config: SupabaseConfig,
  storeId: string,
  userId: string,
): Promise<{ status: StoreAccessRequest["status"] } | null> {
  const response = await supabaseRequest(
    config,
    `store_access_requests?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(userId)}&select=status&limit=1`,
  );
  const rows = await response.json() as Array<{ status: StoreAccessRequest["status"] }>;
  return rows[0] ?? null;
}

export async function reviewStoreAccessRequest(
  config: SupabaseConfig,
  input: {
    storeId: string;
    userId: string;
    status: "pending" | "approved" | "rejected";
    reviewedBy?: string;
  },
): Promise<boolean> {
  const response = await supabaseRequest(
    config,
    `store_access_requests?store_id=eq.${encodeURIComponent(input.storeId)}&user_id=eq.${encodeURIComponent(input.userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: input.status,
        reviewed_by: input.reviewedBy ?? null,
        reviewed_at: input.reviewedBy ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return ((await response.json()) as unknown[]).length > 0;
}

export async function disableStaffMembership(
  config: SupabaseConfig,
  storeId: string,
  userId: string,
): Promise<boolean> {
  const response = await supabaseRequest(
    config,
    `store_memberships?store_id=eq.${encodeURIComponent(storeId)}&user_id=eq.${encodeURIComponent(userId)}&role=eq.staff&is_active=eq.true`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ is_active: false, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    },
  );
  return ((await response.json()) as unknown[]).length > 0;
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
  inventory_count?: number;
  description?: string | null;
  square_category_id?: string | null;
  square_variation_id?: string;
  square_version?: number;
  square_synced_at: string;
  square_deleted_at: string | null;
  updated_at?: string;
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

export async function markItemPhotoDeleted(
  config: SupabaseConfig,
  itemId: string,
  itemPhotoId: string,
): Promise<void> {
  await supabaseRequest(
    config,
    `item_photos?item_id=eq.${encodeURIComponent(itemId)}&item_photo_id=eq.${encodeURIComponent(itemPhotoId)}&deleted_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        pending_delete_at: null,
        deleted_at: new Date().toISOString(),
      }),
    },
  );
}
