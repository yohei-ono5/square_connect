import {
  buildTitle,
  type RegisterToSquareInput,
  type RegisterToSquareResult,
  type UpdateSquareItemInput,
} from "@square-connect/shared";

const SQUARE_API_VERSION = "2026-07-15";

export type SquareConfig = {
  accessToken: string;
  environment: string;
};

type SquareError = {
  category?: string;
  code?: string;
  detail?: string;
  field?: string;
};

type SearchCatalogResponse = {
  objects?: CatalogItemObject[];
  cursor?: string;
  latest_time?: string;
  errors?: SquareError[];
};

type CatalogIdMapping = {
  client_object_id?: string;
  object_id?: string;
};

type UpsertCatalogResponse = {
  catalog_object?: { id?: string };
  id_mappings?: CatalogIdMapping[];
  errors?: SquareError[];
};

type CatalogVariationObject = {
  type?: string;
  id?: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  item_variation_data?: {
    item_id?: string;
    name?: string;
    sku?: string;
    pricing_type?: string;
    price_money?: { amount?: number; currency?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type CatalogItemObject = {
  type?: string;
  id?: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  item_data?: {
    name?: string;
    description?: string;
    variations?: CatalogVariationObject[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RetrieveCatalogResponse = {
  object?: CatalogItemObject;
  errors?: SquareError[];
};

export class SquareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errors: SquareError[],
  ) {
    super(errors[0]?.detail ?? "Square API request failed");
    this.name = "SquareApiError";
  }
}

export class DuplicateSkuError extends Error {
  constructor(public readonly sku: string) {
    super(`SKU ${sku} is already registered in Square`);
    this.name = "DuplicateSkuError";
  }
}

function getBaseUrl(environment: string): string {
  if (environment === "sandbox") return "https://connect.squareupsandbox.com";
  if (environment === "production") return "https://connect.squareup.com";
  throw new Error(`Unsupported SQUARE_ENV: ${environment}`);
}

async function squareRequest<T>(
  config: SquareConfig,
  path: string,
  body: unknown,
  fetcher: typeof fetch,
  method: "POST" | "GET" | "DELETE" = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${getBaseUrl(config.environment)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SquareApiError(0, [{ detail: "Could not reach Square API" }]);
  }

  let payload: (T & { errors?: SquareError[] }) | undefined;
  try {
    payload = (await response.json()) as T & { errors?: SquareError[] };
  } catch {
    throw new SquareApiError(response.status, [{ detail: "Square API returned an invalid response" }]);
  }

  if (!response.ok || payload.errors?.length) {
    throw new SquareApiError(response.status, payload.errors ?? []);
  }

  return payload;
}

type CreateCatalogImageResponse = {
  image?: { id?: string };
  errors?: SquareError[];
};

export async function uploadCatalogImage(
  config: SquareConfig,
  input: {
    squareObjectId: string;
    itemPhotoId: string;
    fileName: string;
    file: Blob;
    isPrimary: boolean;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const form = new FormData();
  form.append("file", input.file, input.fileName);
  form.append("request", JSON.stringify({
    idempotency_key: `square-connect-image-${input.itemPhotoId}`,
    object_id: input.squareObjectId,
    is_primary: input.isPrimary,
    image: {
      type: "IMAGE",
      id: `#image-${input.itemPhotoId}`,
      image_data: { name: input.fileName },
    },
  }));

  let response: Response;
  try {
    response = await fetcher(`${getBaseUrl(config.environment)}/v2/catalog/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: form,
    });
  } catch {
    throw new SquareApiError(0, [{ detail: "Could not reach Square image API" }]);
  }

  let payload: CreateCatalogImageResponse;
  try {
    payload = (await response.json()) as CreateCatalogImageResponse;
  } catch {
    throw new SquareApiError(response.status, [{ detail: "Square image API returned an invalid response" }]);
  }
  if (!response.ok || payload.errors?.length) {
    throw new SquareApiError(response.status, payload.errors ?? []);
  }
  if (!payload.image?.id) {
    throw new SquareApiError(502, [{ detail: "Square image API response did not include an image ID" }]);
  }
  return payload.image.id;
}

export async function deleteCatalogImage(
  config: SquareConfig,
  squareImageId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await squareRequest<{ deleted_object_ids?: string[] }>(
    config,
    `/v2/catalog/object/${encodeURIComponent(squareImageId)}`,
    undefined,
    fetcher,
    "DELETE",
  );
}

function mappedId(response: UpsertCatalogResponse, clientId: string): string | undefined {
  return response.id_mappings?.find((mapping) => mapping.client_object_id === clientId)?.object_id;
}

async function findSquareItemBySku(
  config: SquareConfig,
  sku: string,
  fetcher: typeof fetch,
): Promise<RegisterToSquareResult | null> {
  const search = await squareRequest<SearchCatalogResponse>(
    config,
    "/v2/catalog/search",
    {
      object_types: ["ITEM_VARIATION"],
      include_deleted_objects: false,
      include_related_objects: false,
      query: { exact_query: { attribute_name: "sku", attribute_value: sku } },
      limit: 1,
    },
    fetcher,
  );
  const variation = search.objects?.[0] as CatalogVariationObject | undefined;
  const squareObjectId = variation?.item_variation_data?.item_id;
  if (!variation?.id || !squareObjectId) return null;
  return { squareObjectId, squareVariationId: variation.id };
}

export async function registerItemInSquare(
  config: SquareConfig,
  input: RegisterToSquareInput,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<RegisterToSquareResult> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const existing = await findSquareItemBySku(config, input.mgmtNo, fetcher);
  if (existing) throw new DuplicateSkuError(input.mgmtNo);

  let upsert: UpsertCatalogResponse;
  try {
    upsert = await squareRequest<UpsertCatalogResponse>(
      config,
      "/v2/catalog/object",
      {
        idempotency_key: idempotencyKey,
        object: {
          type: "ITEM",
          id: "#item",
          // Sandbox Dashboardで目視確認しやすいよう、まずは全ロケーション表示で作成する。
          // 本番運用の「非公開作成→確認→公開」は、公開フロー確定時に切り替える。
          present_at_all_locations: true,
          item_data: {
            name: buildTitle(input),
            product_type: "REGULAR",
            variations: [
              {
                type: "ITEM_VARIATION",
                id: "#variation",
                present_at_all_locations: true,
                item_variation_data: {
                  item_id: "#item",
                  name: "通常",
                  sku: input.mgmtNo,
                  pricing_type: "FIXED_PRICING",
                  price_money: {
                    amount: input.price,
                    currency: "JPY",
                  },
                },
              },
            ],
          },
        },
      },
      fetcher,
    );
  } catch (error) {
    // Squareが商品を作成した直後に応答だけ失われると、ブラウザには失敗と見えても
    // Squareには商品が残る。SKUを再照会して作成済みなら成功としてIDを返す。
    try {
      const recovered = await findSquareItemBySku(config, input.mgmtNo, fetcher);
      if (recovered) return recovered;
    } catch (recoveryError) {
      console.error("Square registration recovery search failed", recoveryError);
    }
    throw error;
  }

  const squareObjectId = upsert.catalog_object?.id ?? mappedId(upsert, "#item");
  const squareVariationId = mappedId(upsert, "#variation");
  if (!squareObjectId || !squareVariationId) {
    throw new SquareApiError(502, [{ detail: "Square API response did not include created object IDs" }]);
  }

  return { squareObjectId, squareVariationId };
}

// SquareのUpsertは部分更新ではなくオブジェクト全体を置き換えるため、必ず最新の
// CatalogItemを取得し、変更対象だけを書き換えてからversion付きで送り返す。
export async function updateItemInSquare(
  config: SquareConfig,
  input: UpdateSquareItemInput,
  fetcher: typeof fetch = fetch,
): Promise<RegisterToSquareResult> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const retrieved = await squareRequest<RetrieveCatalogResponse>(
    config,
    `/v2/catalog/object/${encodeURIComponent(input.squareObjectId)}?include_related_objects=true`,
    undefined,
    fetcher,
    "GET",
  );
  const item = retrieved.object;
  if (!item?.id || item.type !== "ITEM" || item.is_deleted || !item.version || !item.item_data) {
    throw new SquareApiError(404, [{ detail: "Square item was not found or cannot be updated" }]);
  }

  const variations = item.item_data.variations ?? [];
  const variationIndex = variations.findIndex(
    (variation) => variation.type === "ITEM_VARIATION" && !variation.is_deleted && variation.item_variation_data,
  );
  if (variationIndex < 0) {
    throw new SquareApiError(422, [{ detail: "Square item does not have an editable variation" }]);
  }

  const variation = variations[variationIndex];
  const updatedVariation: CatalogVariationObject = {
    ...variation,
    item_variation_data: {
      ...variation.item_variation_data,
      item_id: item.id,
      sku: input.mgmtNo,
      pricing_type: "FIXED_PRICING",
      price_money: { amount: input.price, currency: "JPY" },
    },
  };
  const updatedVariations = [...variations];
  updatedVariations[variationIndex] = updatedVariation;

  const updatedItem: CatalogItemObject = {
    ...item,
    item_data: {
      ...item.item_data,
      name: buildTitle(input),
      description: input.description ?? "",
      variations: updatedVariations,
    },
  };

  const upsert = await squareRequest<UpsertCatalogResponse>(
    config,
    "/v2/catalog/object",
    {
      idempotency_key: crypto.randomUUID(),
      object: updatedItem,
    },
    fetcher,
  );

  const squareObjectId = upsert.catalog_object?.id ?? item.id;
  const squareVariationId = updatedVariation.id;
  if (!squareVariationId) {
    throw new SquareApiError(502, [{ detail: "Square API response did not include an item variation ID" }]);
  }
  return { squareObjectId, squareVariationId };
}

export type SquareItemSnapshot = {
  squareObjectId: string;
  squareVariationId?: string;
  version?: number;
  isDeleted: boolean;
  mgmtNo?: string;
  title?: string;
  price?: number;
  description?: string;
};

export async function searchChangedSquareItems(
  config: SquareConfig,
  beginTime: string,
  fetcher: typeof fetch = fetch,
): Promise<SquareItemSnapshot[]> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const objects: CatalogItemObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await squareRequest<SearchCatalogResponse>(
      config,
      "/v2/catalog/search",
      {
        object_types: ["ITEM"],
        include_deleted_objects: true,
        include_related_objects: true,
        begin_time: beginTime,
        ...(cursor ? { cursor } : {}),
      },
      fetcher,
    );
    objects.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);

  return objects.flatMap((item): SquareItemSnapshot[] => {
    if (!item.id || item.type !== "ITEM") return [];
    if (item.is_deleted) {
      return [{ squareObjectId: item.id, version: item.version, isDeleted: true }];
    }

    const variation = item.item_data?.variations?.find(
      (candidate) => candidate.type === "ITEM_VARIATION" && !candidate.is_deleted,
    );
    const variationData = variation?.item_variation_data;
    const mgmtNo = variationData?.sku;
    const squareName = item.item_data?.name;
    const suffix = mgmtNo ? ` ${mgmtNo}` : "";
    const title = squareName && suffix && squareName.endsWith(suffix)
      ? squareName.slice(0, -suffix.length)
      : squareName;

    return [{
      squareObjectId: item.id,
      squareVariationId: variation?.id,
      version: item.version,
      isDeleted: false,
      mgmtNo,
      title,
      price: variationData?.price_money?.amount,
      description: item.item_data?.description,
    }];
  });
}

type CatalogCategoryObject = {
  id?: string;
  category_data?: { name?: string; parent_category?: { id?: string } };
};

type ListCatalogResponse = {
  objects?: CatalogCategoryObject[];
  cursor?: string;
  errors?: SquareError[];
};

export type SquareCategory = { id: string; name: string; parentName: string | null };

// カテゴリはSquareのダッシュボードで設定済みのものを取得するだけで、アプリからは作成しない。
// 階層（parent_category）がある場合は表示用に親カテゴリ名を添える。
export async function listSquareCategories(
  config: SquareConfig,
  fetcher: typeof fetch = fetch,
): Promise<SquareCategory[]> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const all: CatalogCategoryObject[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ types: "CATEGORY" });
    if (cursor) params.set("cursor", cursor);
    const page = await squareRequest<ListCatalogResponse>(
      config,
      `/v2/catalog/list?${params.toString()}`,
      undefined,
      fetcher,
      "GET",
    );
    all.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);

  const nameById = new Map(all.map((obj) => [obj.id, obj.category_data?.name ?? ""]));

  return all
    .filter((obj): obj is CatalogCategoryObject & { id: string; category_data: { name: string } } =>
      Boolean(obj.id && obj.category_data?.name),
    )
    .map((obj) => {
      const parentId = obj.category_data.parent_category?.id;
      return {
        id: obj.id,
        name: obj.category_data.name,
        parentName: parentId ? (nameById.get(parentId) ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
