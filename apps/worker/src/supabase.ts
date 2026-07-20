export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function assertConfig(config: SupabaseConfig) {
  if (!config.url || !config.serviceRoleKey) {
    throw new Error("Supabase sync is not configured");
  }
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
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
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
