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
  createItemPhoto,
  deleteItemPhoto,
  deleteItemPhotosByRole,
  getLastCatalogUpdatedAt,
  recordWebhookEvent,
  saveCatalogUpdatedAt,
  updateItemBySquareId,
} from "./supabase";
import { verifySquareWebhookSignature } from "./webhook";

type Bindings = {
  ITEM_IMAGES: R2Bucket;
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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

const MAX_SQUARE_IMAGE_BYTES = 15_000_000;
const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", signature: "jpeg" },
  "image/pjpeg": { extension: "jpg", signature: "jpeg" },
  "image/png": { extension: "png", signature: "png" },
  "image/gif": { extension: "gif", signature: "gif" },
} as const;

type ImageContentType = keyof typeof IMAGE_TYPES;
type PhotoRole = "main" | "sub";

function isValidItemId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function isValidPhotoId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function hasExpectedImageSignature(file: File, contentType: ImageContentType): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = IMAGE_TYPES[contentType].signature;
  if (signature === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (signature === "png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  }
  const header = new TextDecoder().decode(bytes.slice(0, 6));
  return header === "GIF87a" || header === "GIF89a";
}

function photoUrl(requestUrl: string, storagePath: string): string {
  return new URL(`/media/${storagePath}`, requestUrl).toString();
}

app.post("/api/items/:id/photos", async (c) => {
  const itemId = c.req.param("id");
  if (!isValidItemId(itemId)) return c.json({ error: "invalid_item_id", message: "商品IDが不正です" }, 400);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "invalid_form_data", message: "画像を読み込めませんでした" }, 400);
  }

  const file = form.get("file") as File | null;
  const role = form.get("role");
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ error: "image_required", message: "画像ファイルを選択してください" }, 400);
  }
  if (role !== "main" && role !== "sub") {
    return c.json({ error: "invalid_photo_role", message: "写真の種類が不正です" }, 400);
  }
  if (file.size > MAX_SQUARE_IMAGE_BYTES) {
    return c.json({ error: "image_too_large", message: "画像は15MB以下にしてください" }, 413);
  }
  if (!(file.type in IMAGE_TYPES)) {
    return c.json({ error: "unsupported_image_type", message: "JPEG・PJPEG・PNG・GIF形式の画像を選択してください" }, 415);
  }

  const contentType = file.type as ImageContentType;
  if (!(await hasExpectedImageSignature(file, contentType))) {
    return c.json({ error: "invalid_image", message: "画像ファイルの内容を確認してください" }, 415);
  }

  const itemPhotoId = crypto.randomUUID();
  const storagePath = `items/${itemId}/${itemPhotoId}.${IMAGE_TYPES[contentType].extension}`;
  const supabaseConfig = { url: c.env.SUPABASE_URL, serviceRoleKey: c.env.SUPABASE_SERVICE_ROLE_KEY };

  try {
    await c.env.ITEM_IMAGES.put(storagePath, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: { itemId, itemPhotoId, role },
    });

    let photo;
    try {
      photo = await createItemPhoto(supabaseConfig, {
        item_photo_id: itemPhotoId,
        item_id: itemId,
        role,
        storage_path: storagePath,
        width: null,
        height: null,
        sort: 0,
      });
    } catch (error) {
      await c.env.ITEM_IMAGES.delete(storagePath);
      throw error;
    }

    if (role === "main") {
      try {
        const replaced = await deleteItemPhotosByRole(supabaseConfig, itemId, role, itemPhotoId);
        await Promise.all(replaced.map((oldPhoto) => c.env.ITEM_IMAGES.delete(oldPhoto.storage_path)));
      } catch (error) {
        console.error("Old main photo cleanup failed", error);
      }
    }

    return c.json(
      {
        photo: {
          id: photo.item_photo_id,
          itemId: photo.item_id,
          role: photo.role,
          storagePath: photo.storage_path,
          previewUrl: photoUrl(c.req.url, photo.storage_path),
        },
      },
      201,
    );
  } catch (error) {
    console.error("Photo upload failed", error);
    return c.json({ error: "photo_upload_failed", message: "写真の保存に失敗しました" }, 500);
  }
});

app.delete("/api/items/:id/photos/:photoId", async (c) => {
  const itemId = c.req.param("id");
  const itemPhotoId = c.req.param("photoId");
  if (!isValidItemId(itemId) || !isValidPhotoId(itemPhotoId)) {
    return c.json({ error: "invalid_photo_id", message: "写真IDが不正です" }, 400);
  }

  try {
    const photo = await deleteItemPhoto(
      { url: c.env.SUPABASE_URL, serviceRoleKey: c.env.SUPABASE_SERVICE_ROLE_KEY },
      itemId,
      itemPhotoId,
    );
    if (!photo) return c.json({ error: "photo_not_found", message: "写真が見つかりません" }, 404);
    await c.env.ITEM_IMAGES.delete(photo.storage_path);
    return c.json({ ok: true });
  } catch (error) {
    console.error("Photo delete failed", error);
    return c.json({ error: "photo_delete_failed", message: "写真の削除に失敗しました" }, 500);
  }
});

app.get("/media/*", async (c) => {
  const storagePath = c.req.param("*") ?? "";
  if (!/^items\/[A-Za-z0-9_-]{1,100}\/[0-9a-f-]{36}\.(jpg|png|gif)$/i.test(storagePath)) {
    return c.notFound();
  }
  const object = await c.env.ITEM_IMAGES.get(storagePath);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

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
