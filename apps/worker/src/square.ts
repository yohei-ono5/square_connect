import { buildTitle, type RegisterToSquareInput, type RegisterToSquareResult } from "@clothes-check/shared";

const SQUARE_API_VERSION = "2026-05-20";

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
  objects?: unknown[];
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
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${getBaseUrl(config.environment)}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: JSON.stringify(body),
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

function mappedId(response: UpsertCatalogResponse, clientId: string): string | undefined {
  return response.id_mappings?.find((mapping) => mapping.client_object_id === clientId)?.object_id;
}

export async function registerItemInSquare(
  config: SquareConfig,
  input: RegisterToSquareInput,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<RegisterToSquareResult> {
  if (!config.accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not configured");

  const search = await squareRequest<SearchCatalogResponse>(
    config,
    "/v2/catalog/search",
    {
      object_types: ["ITEM_VARIATION"],
      include_deleted_objects: false,
      include_related_objects: false,
      query: {
        exact_query: {
          attribute_name: "sku",
          attribute_value: input.mgmtNo,
        },
      },
      limit: 1,
    },
    fetcher,
  );

  if (search.objects?.length) throw new DuplicateSkuError(input.mgmtNo);

  const upsert = await squareRequest<UpsertCatalogResponse>(
    config,
    "/v2/catalog/object",
    {
      idempotency_key: idempotencyKey,
      object: {
        type: "ITEM",
        id: "#item",
        present_at_all_locations: false,
        present_at_location_ids: [],
        item_data: {
          name: buildTitle(input),
          product_type: "REGULAR",
          variations: [
            {
              type: "ITEM_VARIATION",
              id: "#variation",
              present_at_all_locations: false,
              present_at_location_ids: [],
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

  const squareObjectId = upsert.catalog_object?.id ?? mappedId(upsert, "#item");
  const squareVariationId = mappedId(upsert, "#variation");
  if (!squareObjectId || !squareVariationId) {
    throw new SquareApiError(502, [{ detail: "Square API response did not include created object IDs" }]);
  }

  return { squareObjectId, squareVariationId };
}
