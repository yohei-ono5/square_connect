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

### 商品写真（Cloudflare R2）

商品写真のファイル本体は非公開のR2バケット`square-connect-images`へ保存し、
保存先と写真の役割（正面=`main`、追加=`sub`）をSupabaseの`item_photos`へ保存する。
初回デプロイ前にバケットを1回だけ作成する。

```bash
cd apps/worker
npx wrangler r2 bucket create square-connect-images
```

Workerの`ITEM_IMAGES`バインディングを経由してアップロード・表示・削除するため、
R2のアクセスキーや公開URLをブラウザへ設定する必要はない。
画像条件はSquare Catalog APIに合わせ、JPEG・PJPEG・PNG・GIF、1ファイル15MB以下とする。
WebPは受け付けず、ファイル形式を変換せずにR2へ保存する。

商品をSquareへ登録すると、R2の正面写真をプライマリ画像、追加写真を通常画像として
Square Catalogへ添付し、返された画像IDを`item_photos.square_image_id`へ保存する。
登録済み商品の写真追加・削除もSquareへ同期する。既存DBでは
`supabase/migrations/0002_item_photos_square_image.sql`を追加で適用する。
写真削除はSquareのCatalogImageを先に削除し、成功後にR2とSupabaseを削除する。

### テスト運用中のアクセス

初期段階ではSupabase Authによるログインを使用しない。URLを知っている利用者は、
ブラウザのanonキーを通じて`stores`、`items`、`item_photos`を読み書きできる。
Square同期用テーブルは公開せず、Service Roleを持つWorkerだけが操作する。

この公開設定はテスト運用専用とし、本運用前にログインと店舗単位のRLSへ切り替える。

### 商品登録フロー

商品登録画面では、最初にSupabaseの`items`へ下書きを作成し、その`item_id`（UUID）を
Square登録リクエストの冪等性キーに利用する。Square登録成功後、返された
`square_object_id`と`square_variation_id`を同じ商品行へ保存する。
「Squareに登録」が失敗した場合は、この一時商品と写真を破棄してフォーム画面に留まり、
明示的に「下書き保存」を押した商品だけを下書きとして一覧へ残す。

`VITE_DEFAULT_STORE_ID`が未設定の場合は`stores`の最初の店舗を使う。
店舗が1件もない場合は、検証用の企業・店舗を自動作成する。

Cloudflareの本番ビルドには`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`
（SupabaseのPublishable key）をBuild variablesとして設定する。

### Square双方向同期

登録済み商品を詳細画面で保存すると、WorkerがSquareの最新CatalogObjectを取得し、
商品名・SKU・価格・説明文を保持フィールドごとUpsertする。

Square側の変更は`catalog.version.updated` Webhookを
`POST /api/webhooks/square`で受信し、前回同期時刻以降の変更をSupabaseへ反映する。
利用前に以下を行う。

1. `supabase/migrations/0001_init.sql`と`0002_item_photos_square_image.sql`を順番に適用する
2. Workerへ`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、
   `SQUARE_WEBHOOK_SIGNATURE_KEY`、`SQUARE_WEBHOOK_NOTIFICATION_URL`を設定する
3. Square Developer Consoleで、上記通知URLを`catalog.version.updated`へ登録する

Webhook通知URLは署名生成に含まれるため、Square Developer ConsoleのURLと
`SQUARE_WEBHOOK_NOTIFICATION_URL`を完全に一致させる。

現在の商品一覧にある「Square登録済み」は`items.square_object_id`の有無を表す。
Squareとの最終照合日時・未同期・同期エラーを一覧に表示する機能は未実装で、
手動照合と定期照合を含む同期状態の可視化を次の実装対象とする。

## ビルド・型チェック・テスト

```bash
pnpm build       # 全パッケージをビルド
pnpm typecheck   # 全パッケージを型チェック
pnpm test        # 全パッケージのテストを実行
```

## 現状

- 商品本体とSquareの商品IDはSupabaseへ永続化する
- 商品写真はCloudflare R2へ保存し、`item_photos`の情報から再読み込み後も表示する
- R2の商品写真をSquare Catalogの商品画像として添付・削除同期する
- Supabase Authは未使用で、テスト運用向け公開RLSを使用している
