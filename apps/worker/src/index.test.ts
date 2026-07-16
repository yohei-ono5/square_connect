import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";

const env = {
  SQUARE_ACCESS_TOKEN: "sandbox-token",
  SQUARE_ENV: "sandbox",
};

function squareResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
      idempotency_key: "clothes-check-item-7d61",
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
