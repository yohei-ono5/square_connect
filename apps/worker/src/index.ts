import { Hono } from "hono";
import { cors } from "hono/cors";
import { RegisterToSquareInputSchema, UpdateSquareItemInputSchema } from "@square-connect/shared";
import {
  deleteCatalogImage,
  DuplicateSkuError,
  listSquareCategories,
  registerItemInSquare,
  retrieveSquareItem,
  SquareApiError,
  searchChangedSquareItems,
  updateItemInSquare,
  uploadCatalogImage,
} from "./square";
import {
  createItemPhoto,
  deleteItemPhoto,
  deleteItemPhotosByRole,
  getItemPhoto,
  getItemSquareObjectId,
  getLastCatalogUpdatedAt,
  listItemPhotos,
  recordWebhookEvent,
  saveCatalogUpdatedAt,
  saveItemPhotoSquareImageId,
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

function squareConfig(env: Bindings) {
  return { accessToken: env.SQUARE_ACCESS_TOKEN, environment: env.SQUARE_ENV };
}

function supabaseConfig(env: Bindings) {
  return { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function syncPhotoToSquare(
  env: Bindings,
  photo: Awaited<ReturnType<typeof listItemPhotos>>[number],
  squareObjectId: string,
): Promise<string> {
  if (photo.square_image_id) return photo.square_image_id;
  const object = await env.ITEM_IMAGES.get(photo.storage_path);
  if (!object) throw new Error(`R2 object not found: ${photo.storage_path}`);

  const fileName = photo.storage_path.split("/").at(-1) ?? `${photo.item_photo_id}.jpg`;
  const source = await object.blob();
  const contentType = object.httpMetadata?.contentType ?? source.type;
  const file = source.type || !contentType
    ? source
    : new Blob([await source.arrayBuffer()], { type: contentType });
  const squareImageId = await uploadCatalogImage(squareConfig(env), {
    squareObjectId,
    itemPhotoId: photo.item_photo_id,
    fileName,
    file,
    isPrimary: photo.role === "main",
  });
  await saveItemPhotoSquareImageId(supabaseConfig(env), photo.item_photo_id, squareImageId);
  return squareImageId;
}

async function syncItemPhotosToSquare(env: Bindings, itemId: string, squareObjectId: string) {
  const photos = await listItemPhotos(supabaseConfig(env), itemId);
  const currentMain = photos.find((photo) => photo.role === "main");
  const staleMainPhotos = currentMain
    ? photos.filter((photo) => photo.role === "main" && photo.item_photo_id !== currentMain.item_photo_id)
    : [];
  const currentPhotos = photos.filter((photo) => photo.role === "sub" || photo.item_photo_id === currentMain?.item_photo_id);
  const failures: string[] = [];
  let synced = 0;
  let currentMainSynced = Boolean(currentMain?.square_image_id);
  for (const photo of currentPhotos) {
    if (photo.square_image_id) continue;
    try {
      await syncPhotoToSquare(env, photo, squareObjectId);
      synced += 1;
      if (photo.item_photo_id === currentMain?.item_photo_id) currentMainSynced = true;
    } catch (error) {
      console.error("Square image sync failed", photo.item_photo_id, error);
      failures.push(photo.item_photo_id);
    }
  }

  if (currentMainSynced) {
    for (const stalePhoto of staleMainPhotos) {
      try {
        if (stalePhoto.square_image_id) await deleteCatalogImage(squareConfig(env), stalePhoto.square_image_id);
        await env.ITEM_IMAGES.delete(stalePhoto.storage_path);
        await deleteItemPhoto(supabaseConfig(env), itemId, stalePhoto.item_photo_id);
      } catch (error) {
        console.error("Stale Square main image cleanup failed", stalePhoto.item_photo_id, error);
        failures.push(stalePhoto.item_photo_id);
      }
    }
  }
  return { synced, failures };
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
  const database = supabaseConfig(c.env);

  try {
    await c.env.ITEM_IMAGES.put(storagePath, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: { itemId, itemPhotoId, role },
    });

    let photo;
    try {
      photo = await createItemPhoto(database, {
        item_photo_id: itemPhotoId,
        item_id: itemId,
        role,
        storage_path: storagePath,
        square_image_id: null,
        width: null,
        height: null,
        sort: 0,
      });
    } catch (error) {
      await c.env.ITEM_IMAGES.delete(storagePath);
      throw error;
    }

    const squareObjectId = await getItemSquareObjectId(database, itemId);
    let squareSyncWarning: string | undefined;
    let squareImageSynced = false;
    if (squareObjectId) {
      try {
        const squareImageId = await syncPhotoToSquare(c.env, photo, squareObjectId);
        photo = { ...photo, square_image_id: squareImageId };
        squareImageSynced = true;
      } catch (error) {
        console.error("New photo Square sync failed", error);
        squareSyncWarning = "写真は保存しましたが、Squareの商品画像への反映に失敗しました";
      }
    }

    if (role === "main" && (!squareObjectId || squareImageSynced)) {
      try {
        const replaced = await deleteItemPhotosByRole(database, itemId, role, itemPhotoId);
        for (const oldPhoto of replaced) {
          if (oldPhoto.square_image_id) await deleteCatalogImage(squareConfig(c.env), oldPhoto.square_image_id);
          await c.env.ITEM_IMAGES.delete(oldPhoto.storage_path);
        }
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
          squareImageId: photo.square_image_id,
        },
        ...(squareSyncWarning ? { squareSyncWarning } : {}),
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
    const database = supabaseConfig(c.env);
    const photo = await getItemPhoto(
      database,
      itemId,
      itemPhotoId,
    );
    if (!photo) return c.json({ error: "photo_not_found", message: "写真が見つかりません" }, 404);
    if (photo.square_image_id) await deleteCatalogImage(squareConfig(c.env), photo.square_image_id);
    await c.env.ITEM_IMAGES.delete(photo.storage_path);
    await deleteItemPhoto(database, itemId, itemPhotoId);
    return c.json({ ok: true });
  } catch (error) {
    console.error("Photo delete failed", error);
    return c.json({ error: "photo_delete_failed", message: "写真の削除に失敗しました" }, 500);
  }
});

app.post("/api/items/:id/photos/sync-to-square", async (c) => {
  const itemId = c.req.param("id");
  if (!isValidItemId(itemId)) return c.json({ error: "invalid_item_id", message: "商品IDが不正です" }, 400);
  try {
    const squareObjectId = await getItemSquareObjectId(supabaseConfig(c.env), itemId);
    if (!squareObjectId) {
      return c.json({ error: "item_not_registered", message: "先に商品をSquareへ登録してください" }, 409);
    }
    const result = await syncItemPhotosToSquare(c.env, itemId, squareObjectId);
    if (result.failures.length) {
      return c.json({
        error: "square_image_sync_failed",
        message: "一部の写真をSquareへ反映できませんでした",
        synced: result.synced,
      }, 502);
    }
    return c.json({ ok: true, synced: result.synced });
  } catch (error) {
    console.error("Square image sync failed", error);
    return c.json({ error: "square_image_sync_failed", message: "写真をSquareへ反映できませんでした" }, 502);
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
    let imageSyncWarning: string | undefined;
    if (parsed.data.hasPhotos) {
      try {
        const imageSync = await syncItemPhotosToSquare(c.env, itemId, result.squareObjectId);
        if (imageSync.failures.length) {
          imageSyncWarning = "商品は登録しましたが、一部の写真をSquareへ反映できませんでした";
        }
      } catch (error) {
        console.error("Square item created but image sync failed", error);
        imageSyncWarning = "商品は登録しましたが、写真をSquareへ反映できませんでした";
      }
    }
    return c.json({
      ...result,
      ...(imageSyncWarning ? { imageSyncWarning } : {}),
    }, 201);
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

app.post("/api/items/:id/sync-from-square", async (c) => {
  const itemId = c.req.param("id");
  if (!isValidItemId(itemId)) {
    return c.json({ error: "invalid_item_id", message: "商品IDが不正です" }, 400);
  }

  try {
    const database = supabaseConfig(c.env);
    const squareObjectId = await getItemSquareObjectId(database, itemId);
    if (!squareObjectId) {
      return c.json({ error: "item_not_registered", message: "この商品はSquareに登録されていません" }, 409);
    }

    // Supabaseに保存済みのSquare商品IDだけを取得対象にし、SKU検索による別商品の
    // 誤更新を避ける。
    const snapshot = await retrieveSquareItem(squareConfig(c.env), squareObjectId);
    const syncedAt = new Date().toISOString();
    await updateItemBySquareId(database, squareObjectId, snapshot.isDeleted
      ? {
          square_version: snapshot.version,
          square_synced_at: syncedAt,
          square_deleted_at: syncedAt,
          updated_at: syncedAt,
        }
      : {
          ...(snapshot.mgmtNo ? { mgmt_no: snapshot.mgmtNo } : {}),
          ...(snapshot.title ? { title: snapshot.title } : {}),
          ...(snapshot.price !== undefined ? { price: snapshot.price } : {}),
          description: snapshot.description ?? null,
          ...(snapshot.squareVariationId ? { square_variation_id: snapshot.squareVariationId } : {}),
          square_version: snapshot.version,
          square_synced_at: syncedAt,
          square_deleted_at: null,
          updated_at: syncedAt,
        });

    return c.json({
      item: {
        squareObjectId: snapshot.squareObjectId,
        isDeleted: snapshot.isDeleted,
        ...(snapshot.mgmtNo ? { mgmtNo: snapshot.mgmtNo } : {}),
        ...(snapshot.title ? { title: snapshot.title } : {}),
        ...(snapshot.price !== undefined ? { price: snapshot.price } : {}),
        description: snapshot.description ?? null,
      },
      syncedAt,
    });
  } catch (error) {
    if (error instanceof SquareApiError) {
      console.error("Square item fetch failed", error.status, error.errors);
      return c.json({ error: "square_api_error", message: "Squareの最新情報を取得できませんでした" }, 502);
    }
    console.error("Square item sync failed", error);
    return c.json({ error: "sync_failed", message: "Squareの最新情報を保存できませんでした" }, 500);
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
