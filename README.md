# square_connect

古着Tシャツの採寸・商品登録を効率化し、Squareへ商品登録するためのアプリ。設計の詳細・ロードマップは [square_connect_architecture.md](./square_connect_architecture.md) を参照（元要件は [docs/square_connect_plan.md](./docs/square_connect_plan.md)）。

## 構成

pnpmモノレポ。

```
apps/
  web/      Vite + React + TypeScript（スタッフ向けSPA）
  worker/   Cloudflare Workers + Hono（Square/メルカリ連携、SKU重複チェックなど秘密を扱う処理）
packages/
  shared/   共有型・zodスキーマ
  measure/  採寸ロジック（docs/mvp_prototype.html から移植。現状は未実装のスタブ）
supabase/
  migrations/  DBスキーマ・テスト運用向け公開RLSポリシー
docs/       アプリの実行には不要な資料（元要件・動くプロトタイプ）
```

## セットアップ

```bash
pnpm install
```

## 開発

```bash
pnpm dev:web      # Webアプリ（Vite、既定 http://localhost:5173）
pnpm dev:worker   # Cloudflare Worker（wrangler dev、既定 http://localhost:8787）
```

`apps/web`は`.env.example`、`apps/worker`は`.dev.vars.example`をコピーして値を埋める（`.env`・`.dev.vars`はgitignore対象）。

```bash
cp apps/web/.env.example apps/web/.env
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

Squareなどの秘密情報は本番では`wrangler secret put`で登録し、リポジトリには置かない。

### テスト運用中のアクセス

初期段階ではSupabase Authによるログインを使用しない。URLを知っている利用者は、
ブラウザのanonキーを通じて`stores`、`items`、`item_photos`を読み書きできる。
Square同期用テーブルは公開せず、Service Roleを持つWorkerだけが操作する。

この公開設定はテスト運用専用とし、本運用前にログインと店舗単位のRLSへ切り替える。

### Square双方向同期

登録済み商品を詳細画面で保存すると、WorkerがSquareの最新CatalogObjectを取得し、
商品名・SKU・価格・説明文を保持フィールドごとUpsertする。

Square側の変更は`catalog.version.updated` Webhookを
`POST /api/webhooks/square`で受信し、前回同期時刻以降の変更をSupabaseへ反映する。
利用前に以下を行う。

1. `supabase/migrations/0001_init.sql`を適用する
2. Workerへ`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、
   `SQUARE_WEBHOOK_SIGNATURE_KEY`、`SQUARE_WEBHOOK_NOTIFICATION_URL`を設定する
3. Square Developer Consoleで、上記通知URLを`catalog.version.updated`へ登録する

Webhook通知URLは署名生成に含まれるため、Square Developer ConsoleのURLと
`SQUARE_WEBHOOK_NOTIFICATION_URL`を完全に一致させる。

## ビルド・型チェック・テスト

```bash
pnpm build       # 全パッケージをビルド
pnpm typecheck   # 全パッケージを型チェック
pnpm test        # 全パッケージのテストを実行
```

## 現状

- `apps/web`・`apps/worker`とも最小限のプレースホルダー実装（画面・エンドポイントはまだ本実装ではない）
- `packages/measure`は未実装のスタブ。`docs/mvp_prototype.html`の採寸ロジック（マーカー検出・ホモグラフィ・自動採寸）の移植が必要
- Supabase・Cloudflareの実プロジェクトはまだ紐付けていない
