import { Hono } from "hono";
import { cors } from "hono/cors";
import { RegisterToSquareInputSchema, UpdateSquareItemInputSchema } from "@square-connect/shared";
import {
  DuplicateSkuError,
  listSquareCategories,
  registerItemInSquare,
  SquareApiError,
  searchChangedSquareItems,
  updateItemInSquare,
} from "./square";
import {
  getLastCatalogUpdatedAt,
  recordWebhookEvent,
  saveCatalogUpdatedAt,
  updateItemBySquareId,
} from "./supabase";
import { verifySquareWebhookSignature } from "./webhook";

type Bindings = {
  SQUARE_ACCESS_TOKEN: string;
  SQUARE_ENV: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY: string;
  SQUARE_WEBHOOK_NOTIFICATION_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

type CatalogVersionUpdatedEvent = {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  data?: { object?: { catalog_version?: { updated_at?: string } } };
};

app.post("/api/webhooks/square", async (c) => {
  const rawBody = await c.req.text();
  const isValid = await verifySquareWebhookSignature(
    c.req.header("x-square-hmacsha256-signature") ?? null,
    c.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    c.env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    rawBody,
  );
  if (!isValid) return c.json({ error: "invalid_signature" }, 403);

  let event: CatalogVersionUpdatedEvent;
  try {
    event = JSON.parse(rawBody) as CatalogVersionUpdatedEvent;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (event.type !== "catalog.version.updated") return c.json({ ok: true, ignored: true });

  const merchantId = event.merchant_id;
  const eventId = event.event_id;
  const catalogUpdatedAt = event.data?.object?.catalog_version?.updated_at;
  if (!merchantId || !eventId || !catalogUpdatedAt || Number.isNaN(Date.parse(catalogUpdatedAt))) {
    return c.json({ error: "invalid_event" }, 400);
  }

  const supabaseConfig = {
    url: c.env.SUPABASE_URL,
    serviceRoleKey: c.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  try {
    const beginTime = (await getLastCatalogUpdatedAt(supabaseConfig, merchantId)) ?? "1970-01-01T00:00:00Z";
    const changedItems = await searchChangedSquareItems(
      { accessToken: c.env.SQUARE_ACCESS_TOKEN, environment: c.env.SQUARE_ENV },
      beginTime,
    );
    const syncedAt = new Date().toISOString();
    await Promise.all(
      changedItems.map((item) =>
        updateItemBySquareId(supabaseConfig, item.squareObjectId, item.isDeleted
          ? {
              square_version: item.version,
              square_synced_at: syncedAt,
              square_deleted_at: catalogUpdatedAt,
              updated_at: syncedAt,
            }
          : {
              ...(item.mgmtNo ? { mgmt_no: item.mgmtNo } : {}),
              ...(item.title ? { title: item.title } : {}),
              ...(item.price !== undefined ? { price: item.price } : {}),
              description: item.description ?? null,
              ...(item.squareVariationId ? { square_variation_id: item.squareVariationId } : {}),
              square_version: item.version,
              square_synced_at: syncedAt,
              square_deleted_at: null,
              updated_at: syncedAt,
            },
        ),
      ),
    );
    await saveCatalogUpdatedAt(supabaseConfig, merchantId, catalogUpdatedAt);
    await recordWebhookEvent(supabaseConfig, eventId, event.type);
    return c.json({ ok: true, syncedItems: changedItems.length });
  } catch (error) {
    console.error("Square webhook sync failed", error);
    return c.json({ error: "sync_failed" }, 500);
  }
});

app.post("/api/items/:id/register-to-square", async (c) => {
  const itemId = c.req.param("id");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(itemId)) {
    return c.json({ error: "invalid_item_id", message: "商品IDが不正です" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json", message: "JSON形式のリクエストが必要です" }, 400);
  }

  const parsed = RegisterToSquareInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_error",
        message: "登録内容を確認してください",
        issues: parsed.error.issues,
      },
      400,
    );
  }

  try {
    const result = await registerItemInSquare(
      {
        accessToken: c.env.SQUARE_ACCESS_TOKEN,
        environment: c.env.SQUARE_ENV,
      },
      parsed.data,
      `square-connect-item-${itemId}`,
    );
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof DuplicateSkuError) {
      return c.json(
        {
          error: "sku_already_exists",
          message: `SKU ${error.sku} はSquareに登録済みです`,
        },
        409,
      );
    }
    if (error instanceof SquareApiError) {
      console.error("Square API request failed", error.status, error.errors);
      return c.json(
        {
          error: "square_api_error",
          message: "Squareへの登録に失敗しました",
        },
        502,
      );
    }

    console.error("Square registration failed", error);
    return c.json(
      {
        error: "configuration_error",
        message: "Square連携の設定を確認してください",
      },
      500,
    );
  }
});

app.patch("/api/items/:id/square", async (c) => {
  const itemId = c.req.param("id");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(itemId)) {
    return c.json({ error: "invalid_item_id", message: "商品IDが不正です" }, 400);
  }

  const parsed = UpdateSquareItemInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "validation_error", message: "更新内容を確認してください", issues: parsed.error.issues }, 400);
  }

  try {
    const result = await updateItemInSquare(
      { accessToken: c.env.SQUARE_ACCESS_TOKEN, environment: c.env.SQUARE_ENV },
      parsed.data,
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof SquareApiError) {
      console.error("Square update failed", error.status, error.errors);
      return c.json({ error: "square_api_error", message: "Squareの商品更新に失敗しました" }, 502);
    }
    console.error("Square update failed", error);
    return c.json({ error: "configuration_error", message: "Square連携の設定を確認してください" }, 500);
  }
});

app.get("/api/square/categories", async (c) => {
  try {
    const categories = await listSquareCategories({
      accessToken: c.env.SQUARE_ACCESS_TOKEN,
      environment: c.env.SQUARE_ENV,
    });
    return c.json({ categories });
  } catch (error) {
    if (error instanceof SquareApiError) {
      console.error("Square category fetch failed", error.status, error.errors);
      return c.json({ error: "square_api_error", message: "カテゴリの取得に失敗しました" }, 502);
    }

    console.error("Square category fetch failed", error);
    return c.json({ error: "configuration_error", message: "Square連携の設定を確認してください" }, 500);
  }
});

export default app;
