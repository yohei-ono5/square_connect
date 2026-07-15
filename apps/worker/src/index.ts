import { Hono } from "hono";

type Bindings = {
  SQUARE_ACCESS_TOKEN: string;
  SQUARE_ENV: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true }));

// SKU重複チェック（SearchCatalogObjects）→ Square非公開作成（UpsertCatalogObject）の実装はここに追加していく
app.post("/api/items/:id/register-to-square", async (c) => {
  return c.json({ error: "not implemented yet" }, 501);
});

export default app;
