import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";

const r2Get = vi.fn();
const r2Put = vi.fn();
const r2Delete = vi.fn();

const env = {
  ITEM_IMAGES: {
    get: r2Get,
    put: r2Put,
    delete: r2Delete,
  } as unknown as R2Bucket,
  SQUARE_ACCESS_TOKEN: "sandbox-token",
  SQUARE_ENV: "sandbox",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "webhook-secret",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://worker.example.com/api/webhooks/square",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
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
  vi.clearAllMocks();
});

describe("item photo storage", () => {
  it("serves a stored R2 image from its media URL", async () => {
    const itemId = "22c9f0c8-a7be-4438-a1a2-1c7a6722dbd4";
    const itemPhotoId = "499f220d-0607-496e-8922-23bebafa30e4";
    const storagePath = `items/${itemId}/${itemPhotoId}.jpg`;
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    r2Get.mockResolvedValueOnce({
      body: imageBytes,
      httpEtag: '"photo-etag"',
      writeHttpMetadata(headers: Headers) {
        headers.set("content-type", "image/jpeg");
      },
    });

    const response = await app.request(`/media/${storagePath}`, {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
    expect(r2Get).toHaveBeenCalledWith(storagePath);
  });

  it("stores a Square-compatible image in R2 and records it in Supabase", async () => {
    const itemId = "7d616551-670b-4fe9-88d1-3a32ab423b20";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        squareResponse([
          {
            item_photo_id: "a8ae5959-69c9-4d25-b369-d27bfeb52bd8",
            item_id: itemId,
            role: "main",
            storage_path: `items/${itemId}/a8ae5959-69c9-4d25-b369-d27bfeb52bd8.png`,
            width: null,
            height: null,
            sort: 0,
          },
        ], 201),
      )
      .mockResolvedValueOnce(squareResponse([]))
      .mockResolvedValueOnce(squareResponse([]));
    const body = new FormData();
    body.append("role", "main");
    body.append(
      "file",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "item.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/api/items/${itemId}/photos`, { method: "POST", body }, env);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      photo: { itemId, role: "main", previewUrl: expect.stringContaining(`/media/items/${itemId}/`) },
    });
    expect(r2Put).toHaveBeenCalledOnce();
    expect(r2Put.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
    expect(String(r2Put.mock.calls[0][0])).toMatch(new RegExp(`^items/${itemId}/[0-9a-f-]+\\.png$`));
    expect(fetchSpy.mock.calls[0][0]).toBe("https://project.supabase.co/rest/v1/item_photos");
    const supabaseHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(supabaseHeaders.get("apikey")).toBe("sb_secret_test");
    expect(supabaseHeaders.has("Authorization")).toBe(false);
    expect(fetchSpy.mock.calls[1][0]).toContain(`items?item_id=eq.${itemId}&select=square_object_id`);
    expect(fetchSpy.mock.calls[2][0]).toContain(`item_photos?item_id=eq.${itemId}&role=eq.main`);
  });

  it("keeps a saved photo when only the Square item lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const itemId = "7d616551-670b-4fe9-88d1-3a32ab423b20";
    const itemPhotoId = "a8ae5959-69c9-4d25-b369-d27bfeb52bd8";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse([{
        item_photo_id: itemPhotoId,
        item_id: itemId,
        role: "main",
        storage_path: `items/${itemId}/${itemPhotoId}.png`,
        square_image_id: null,
        width: null,
        height: null,
        sort: 0,
      }], 201))
      .mockResolvedValueOnce(squareResponse({ message: "temporary failure" }, 500));
    const body = new FormData();
    body.append("role", "main");
    body.append(
      "file",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "item.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/api/items/${itemId}/photos`, { method: "POST", body }, env);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      photo: { id: itemPhotoId },
      squareSyncWarning: "写真は保存しましたが、Squareの商品画像への反映に失敗しました",
    });
    expect(r2Put).toHaveBeenCalledOnce();
    expect(r2Delete).not.toHaveBeenCalled();
  });

  it("rejects WebP before writing to R2", async () => {
    const body = new FormData();
    body.append("role", "main");
    body.append("file", new File(["webp"], "item.webp", { type: "image/webp" }));

    const response = await app.request("/api/items/item-1/photos", { method: "POST", body }, env);

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: "unsupported_image_type" });
    expect(r2Put).not.toHaveBeenCalled();
  });

  it("rejects files larger than Square's 15 MB limit", async () => {
    const body = new FormData();
    body.append("role", "sub");
    body.append("file", new File([new Uint8Array(15_000_001)], "large.jpg", { type: "image/jpeg" }));

    const response = await app.request("/api/items/item-1/photos", { method: "POST", body }, env);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "image_too_large" });
    expect(r2Put).not.toHaveBeenCalled();
  });

  it("deletes the Square catalog image before removing the R2 photo", async () => {
    const itemId = "7d616551-670b-4fe9-88d1-3a32ab423b20";
    const itemPhotoId = "a8ae5959-69c9-4d25-b369-d27bfeb52bd8";
    const storagePath = `items/${itemId}/${itemPhotoId}.jpg`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse([{
        item_photo_id: itemPhotoId,
        item_id: itemId,
        role: "main",
        storage_path: storagePath,
        square_image_id: "square-image-1",
      }]))
      .mockResolvedValueOnce(squareResponse({ deleted_object_ids: ["square-image-1"] }))
      .mockResolvedValueOnce(squareResponse([]));

    const response = await app.request(
      `/api/items/${itemId}/photos/${itemPhotoId}`,
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://connect.squareupsandbox.com/v2/catalog/object/square-image-1",
    );
    expect(fetchSpy.mock.calls[1][1]?.method).toBe("DELETE");
    expect(r2Delete).toHaveBeenCalledWith(storagePath);
    expect(fetchSpy.mock.calls[2][0]).toContain(`item_photos?item_id=eq.${itemId}&item_photo_id=eq.${itemPhotoId}`);
  });
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
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(squareResponse({
      objects: [{ id: "variation-1", item_variation_data: { item_id: "square-item-1" } }],
    }));

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
    // 写真が添付されていないため、Supabaseの写真取得やSquare画像同期は行わない。
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

  it("retrieves the exact Square item by its stored object ID and updates Supabase", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse([{ square_object_id: "square-item-1" }]))
      .mockResolvedValueOnce(squareResponse({
        object: {
          type: "ITEM",
          id: "square-item-1",
          version: 123,
          item_data: {
            name: "更新後の商品 T0100",
            description: "Squareで更新した説明",
            variations: [{
              type: "ITEM_VARIATION",
              id: "square-variation-1",
              item_variation_data: {
                item_id: "square-item-1",
                sku: "T0100",
                price_money: { amount: 4500, currency: "JPY" },
              },
            }],
          },
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await app.request(
      "/api/items/item-1/sync-from-square",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      item: {
        squareObjectId: "square-item-1",
        isDeleted: false,
        mgmtNo: "T0100",
        title: "更新後の商品",
        price: 4500,
        description: "Squareで更新した説明",
      },
    });
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://connect.squareupsandbox.com/v2/catalog/object/square-item-1?include_related_objects=true",
    );
    expect(fetchSpy.mock.calls[1][1]?.method).toBe("GET");
    expect(JSON.parse(String(fetchSpy.mock.calls[2][1]?.body))).toMatchObject({
      mgmt_no: "T0100",
      title: "更新後の商品",
      price: 4500,
      description: "Squareで更新した説明",
      square_variation_id: "square-variation-1",
      square_version: 123,
      square_deleted_at: null,
    });
  });

  it("recovers created Square IDs when the upsert response is lost", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse({ objects: [] }))
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(squareResponse({
        objects: [{
          type: "ITEM_VARIATION",
          id: "square-variation-recovered",
          item_variation_data: { item_id: "square-item-recovered", sku: "T0088" },
        }],
      }))
      .mockResolvedValueOnce(squareResponse([]));

    const response = await app.request(
      "/api/items/item-recovered/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0088", title: "復旧商品", price: 3000 }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      squareObjectId: "square-item-recovered",
      squareVariationId: "square-variation-recovered",
    });
  });

  it("uploads the R2 main photo and attaches it to the created Square item", async () => {
    const itemId = "7d616551-670b-4fe9-88d1-3a32ab423b20";
    const itemPhotoId = "a8ae5959-69c9-4d25-b369-d27bfeb52bd8";
    const storagePath = `items/${itemId}/${itemPhotoId}.png`;
    r2Get.mockResolvedValueOnce({
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })),
      httpMetadata: { contentType: "image/png" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse({ objects: [] }))
      .mockResolvedValueOnce(squareResponse({
        catalog_object: { id: "square-item-1" },
        id_mappings: [
          { client_object_id: "#item", object_id: "square-item-1" },
          { client_object_id: "#variation", object_id: "square-variation-1" },
        ],
      }))
      .mockResolvedValueOnce(squareResponse([{
        item_photo_id: itemPhotoId,
        item_id: itemId,
        role: "main",
        storage_path: storagePath,
        square_image_id: null,
        width: null,
        height: null,
        sort: 0,
      }]))
      .mockResolvedValueOnce(squareResponse({ image: { id: "square-image-1" } }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await app.request(
      `/api/items/${itemId}/register-to-square`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0090", title: "画像付きTシャツ", price: 3000, hasPhotos: true }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      squareObjectId: "square-item-1",
      squareVariationId: "square-variation-1",
    });
    expect(r2Get).toHaveBeenCalledWith(storagePath);
    expect(fetchSpy.mock.calls[3][0]).toBe("https://connect.squareupsandbox.com/v2/catalog/images");
    const imageForm = fetchSpy.mock.calls[3][1]?.body as FormData;
    expect(imageForm).toBeInstanceOf(FormData);
    expect(JSON.parse(String(imageForm.get("request")))).toMatchObject({
      object_id: "square-item-1",
      is_primary: true,
      idempotency_key: `square-connect-image-${itemPhotoId}`,
    });
    expect(fetchSpy.mock.calls[4][0]).toContain(`item_photos?item_photo_id=eq.${itemPhotoId}`);
    expect(JSON.parse(String(fetchSpy.mock.calls[4][1]?.body))).toEqual({ square_image_id: "square-image-1" });
  });

  it("returns the created item IDs with a warning when only image upload fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    r2Get.mockResolvedValueOnce({
      blob: () => Promise.resolve(new Blob(["image"], { type: "image/jpeg" })),
      httpMetadata: { contentType: "image/jpeg" },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(squareResponse({ objects: [] }))
      .mockResolvedValueOnce(squareResponse({
        catalog_object: { id: "square-item-2" },
        id_mappings: [{ client_object_id: "#variation", object_id: "square-variation-2" }],
      }))
      .mockResolvedValueOnce(squareResponse([{
        item_photo_id: "a8ae5959-69c9-4d25-b369-d27bfeb52bd8",
        item_id: "item-2",
        role: "main",
        storage_path: "items/item-2/a8ae5959-69c9-4d25-b369-d27bfeb52bd8.jpg",
        square_image_id: null,
      }]))
      .mockResolvedValueOnce(squareResponse({ errors: [{ detail: "image rejected" }] }, 400));

    const response = await app.request(
      "/api/items/item-2/register-to-square",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mgmtNo: "T0091", title: "画像失敗", price: 3000, hasPhotos: true }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      squareObjectId: "square-item-2",
      squareVariationId: "square-variation-2",
      imageSyncWarning: expect.any(String),
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
