import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";

const env = {
  SQUARE_ACCESS_TOKEN: "sandbox-token",
  SQUARE_ENV: "sandbox",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "webhook-secret",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://worker.example.com/api/webhooks/square",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function squareResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function squareWebhookSignature(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(env.SQUARE_WEBHOOK_NOTIFICATION_URL + body),
    ),
  );
  return btoa(String.fromCharCode(...bytes));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/items/:id/register-to-square", () => {
  it("rejects invalid input before contacting Square", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await app.request(
      "/api/items/item-1/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Tシャツ", price: -1 }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 409 when the SKU already exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(squareResponse({ objects: [{ id: "variation-1" }] }));

    const response = await app.request(
      "/api/items/item-1/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0001", title: "Tシャツ", price: 3000 }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "sku_already_exists" });
  });

  it("creates a dashboard-visible JPY item after checking the SKU", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse({ objects: [] }))
      .mockResolvedValueOnce(
        squareResponse({
          catalog_object: { id: "square-item-1" },
          id_mappings: [
            { client_object_id: "#item", object_id: "square-item-1" },
            { client_object_id: "#variation", object_id: "square-variation-1" },
          ],
        }),
      );

    const response = await app.request(
      "/api/items/7d61/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0002", title: "ディズニー Tシャツ", price: 3000 }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      squareObjectId: "square-item-1",
      squareVariationId: "square-variation-1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [searchUrl, searchInit] = fetchSpy.mock.calls[0];
    expect(searchUrl).toBe("https://connect.squareupsandbox.com/v2/catalog/search");
    expect(JSON.parse(String(searchInit?.body))).toMatchObject({
      query: { exact_query: { attribute_name: "sku", attribute_value: "T0002" } },
    });

    const [upsertUrl, upsertInit] = fetchSpy.mock.calls[1];
    expect(upsertUrl).toBe("https://connect.squareupsandbox.com/v2/catalog/object");
    expect(JSON.parse(String(upsertInit?.body))).toMatchObject({
      idempotency_key: "square-connect-item-7d61",
      object: {
        present_at_all_locations: true,
        item_data: {
          name: "ディズニー Tシャツ T0002",
          variations: [
            {
              present_at_all_locations: true,
              item_variation_data: {
                sku: "T0002",
                price_money: { amount: 3000, currency: "JPY" },
              },
            },
          ],
        },
      },
    });
  });

  it("does not expose Square error details to the browser", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      squareResponse(
        {
          errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "secret detail" }],
        },
        401,
      ),
    );

    const response = await app.request(
      "/api/items/item-1/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0003", title: "Tシャツ", price: 3000 }),
      },
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret detail");
  });
});

describe("PATCH /api/items/:id/square", () => {
  it("retrieves the latest object and preserves Square-only fields when updating", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        squareResponse({
          object: {
            type: "ITEM",
            id: "square-item-1",
            version: 123,
            present_at_all_locations: true,
            item_data: {
              name: "旧商品名 T0001",
              abbreviation: "OLD",
              product_type: "REGULAR",
              variations: [
                {
                  type: "ITEM_VARIATION",
                  id: "square-variation-1",
                  version: 123,
                  present_at_all_locations: true,
                  item_variation_data: {
                    item_id: "square-item-1",
                    name: "通常",
                    sku: "T0001",
                    pricing_type: "FIXED_PRICING",
                    price_money: { amount: 2000, currency: "JPY" },
                    stockable: true,
                  },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(squareResponse({ catalog_object: { id: "square-item-1" } }));

    const response = await app.request(
      "/api/items/item-1/square",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          squareObjectId: "square-item-1",
          mgmtNo: "T0002",
          title: "更新商品",
          price: 3500,
          description: "更新説明",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      squareObjectId: "square-item-1",
      squareVariationId: "square-variation-1",
    });
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://connect.squareupsandbox.com/v2/catalog/object/square-item-1?include_related_objects=true",
    );
    const [, upsertInit] = fetchSpy.mock.calls[1];
    expect(JSON.parse(String(upsertInit?.body))).toMatchObject({
      object: {
        id: "square-item-1",
        version: 123,
        item_data: {
          name: "更新商品 T0002",
          description: "更新説明",
          abbreviation: "OLD",
          variations: [
            {
              id: "square-variation-1",
              item_variation_data: {
                name: "通常",
                sku: "T0002",
                price_money: { amount: 3500, currency: "JPY" },
                stockable: true,
              },
            },
          ],
        },
      },
    });
  });
});

describe("POST /api/webhooks/square", () => {
  it("rejects an invalid signature without accessing Square or Supabase", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await app.request(
      "/api/webhooks/square",
      {
        method: "POST",
        headers: { "x-square-hmacsha256-signature": "invalid" },
        body: "{}",
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("searches catalog changes and updates the matching Supabase item", async () => {
    const body = JSON.stringify({
      merchant_id: "merchant-1",
      type: "catalog.version.updated",
      event_id: "event-1",
      data: { object: { catalog_version: { updated_at: "2026-07-20T01:00:00Z" } } },
    });
    const signature = await squareWebhookSignature(body);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse([]))
      .mockResolvedValueOnce(
        squareResponse({
          objects: [
            {
              type: "ITEM",
              id: "square-item-1",
              version: 456,
              item_data: {
                name: "Squareで更新 T0099",
                description: "Square側の説明",
                variations: [
                  {
                    type: "ITEM_VARIATION",
                    id: "square-variation-1",
                    item_variation_data: {
                      sku: "T0099",
                      price_money: { amount: 4200, currency: "JPY" },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const response = await app.request(
      "/api/webhooks/square",
      {
        method: "POST",
        headers: { "x-square-hmacsha256-signature": signature },
        body,
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, syncedItems: 1 });
    expect(fetchSpy.mock.calls[1][0]).toBe("https://connect.squareupsandbox.com/v2/catalog/search");
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toMatchObject({
      object_types: ["ITEM"],
      include_deleted_objects: true,
      begin_time: "1970-01-01T00:00:00Z",
    });
    expect(fetchSpy.mock.calls[2][0]).toBe(
      "https://project.supabase.co/rest/v1/items?square_object_id=eq.square-item-1",
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[2][1]?.body))).toMatchObject({
      mgmt_no: "T0099",
      title: "Squareで更新",
      price: 4200,
      description: "Square側の説明",
      square_variation_id: "square-variation-1",
      square_version: 456,
      square_deleted_at: null,
    });
  });
});

describe("GET /api/square/categories", () => {
  it("follows pagination and resolves parent category names", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        squareResponse({
          objects: [
            { id: "cat-parent", category_data: { name: "Tシャツ" } },
            { id: "cat-child", category_data: { name: "アニメTシャツ", parent_category: { id: "cat-parent" } } },
          ],
          cursor: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        squareResponse({
          objects: [{ id: "cat-other", category_data: { name: "バンドT" } }],
        }),
      );

    const response = await app.request("/api/square/categories", { method: "GET" }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      categories: [
        { id: "cat-parent", name: "Tシャツ", parentName: null },
        { id: "cat-child", name: "アニメTシャツ", parentName: "Tシャツ" },
        { id: "cat-other", name: "バンドT", parentName: null },
      ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://connect.squareupsandbox.com/v2/catalog/list?types=CATEGORY",
    );
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://connect.squareupsandbox.com/v2/catalog/list?types=CATEGORY&cursor=page-2",
    );
  });

  it("does not expose Square error details to the browser", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      squareResponse({ errors: [{ category: "AUTHENTICATION_ERROR", detail: "secret detail" }] }, 401),
    );

    const response = await app.request("/api/square/categories", { method: "GET" }, env);

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret detail");
  });
});
