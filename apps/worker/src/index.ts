import { Hono } from "hono";
import { RegisterToSquareInputSchema } from "@clothes-check/shared";
import { DuplicateSkuError, registerItemInSquare, SquareApiError } from "./square";

type Bindings = {
  SQUARE_ACCESS_TOKEN: string;
  SQUARE_ENV: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true }));

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
      `clothes-check-item-${itemId}`,
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

export default app;
