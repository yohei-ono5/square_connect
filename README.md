# Square Connect

古着Tシャツの採寸・商品登録を効率化し、Squareへ商品登録するためのアプリ。ブラウザの表示名も「Square Connect」に統一している。設計の詳細・ロードマップは [square_connect_architecture.md](./square_connect_architecture.md) を参照（元要件は [docs/square_connect_plan.md](./docs/square_connect_plan.md)）。

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
ブラウザのPublishable keyを通じて`stores`、`items`、`item_photos`を読み書きできる。
Square同期用テーブルは公開せず、Secret keyを持つWorkerだけが操作する。

この公開設定はテスト運用専用とし、本運用前にログインと店舗単位のRLSへ切り替える。

### 商品登録フロー

商品登録画面では、最初にSupabaseの`items`へ下書きを作成し、その`item_id`（UUID）を
Square登録リクエストの冪等性キーに利用する。Square登録成功後、返された
`square_object_id`と`square_variation_id`を同じ商品行へ保存する。
「Squareに登録」が失敗した場合は、この一時商品と写真を破棄してフォーム画面に留まり、
明示的に「下書き保存」を押した商品だけを下書きとして一覧へ残す。
下書き保存・Square登録の成功後はいずれも商品一覧へ戻り、連続して次の商品を登録できる。

写真は任意で、添付されていない場合はSquare画像同期を実行せず、画像に関する警告も表示しない。
写真を添付した場合だけSquareへ画像を同期し、画像同期に失敗したときは、商品登録自体が
成功したことと画像だけが未反映であることを商品一覧に警告表示する。
金額欄は0〜9の数字のみ入力でき、小数点・マイナス・指数表記などは受け付けない。

`VITE_DEFAULT_STORE_ID`が未設定の場合は`stores`の最初の店舗を使う。
店舗が1件もない場合は、検証用の企業・店舗を自動作成する。

Cloudflareの本番ビルドには`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`
をBuild variablesとして設定する。`VITE_SUPABASE_ANON_KEY`は既存の環境変数名を
維持しているが、値にはLegacy `anon`ではなくSupabaseのPublishable keyを使用する。

### UIテーマ

導入店舗のテーマカラーに合わせ、主要ボタン、リンク、選択中タブ、チェックボックスなどの
アクセントカラーは`RGB(234, 51, 37)`（`#EA3325`）で統一する。ライト・ダーク表示とも
赤地に白文字を使用する。

### Square双方向同期

商品詳細画面の保存操作は明確に分ける。

- 「下書き保存」：Supabaseだけを更新し、Squareには反映しない
- 「Squareに登録」：未登録商品をSquareへ新規登録する
- 「Squareを更新」：登録済み商品の商品名・SKU・価格・説明文と未同期写真をSquareへ反映する
- 「Squareの最新情報を取得」：保存済みの`square_object_id`を直接指定し、Squareの商品名・SKU・価格・説明文をSupabaseと表示中の画面へ反映する

最新情報取得はSKU検索ではなく、対象商品のSquare IDを直接使うため、別商品を誤って取り込まない。

Square側の変更は`catalog.version.updated` Webhookを
`POST /api/webhooks/square`で受信し、前回同期時刻以降の変更をSupabaseへ反映する。
利用前に以下を行う。

1. `supabase/migrations/0001_init.sql`と`0002_item_photos_square_image.sql`を順番に適用する
2. Workerへ`SUPABASE_URL`、`SUPABASE_SECRET_KEY`（SupabaseのSecret key）、
   `SQUARE_WEBHOOK_SIGNATURE_KEY`、`SQUARE_WEBHOOK_NOTIFICATION_URL`を設定する
3. Square Developer Consoleで、上記通知URLを`catalog.version.updated`へ登録する

`SUPABASE_SECRET_KEY`にはSupabaseの新しいSecret key（`sb_secret_...`）を使用し、
Legacy API Keysの`service_role`は使用しない。Secret keyはCloudflare Workerの
「設定 → 変数とシークレット」へ`SUPABASE_SECRET_KEY`の名前で保存し、
リポジトリ、Build variables、フロントエンドには含めない。

Webhook通知URLは署名生成に含まれるため、Square Developer ConsoleのURLと
`SQUARE_WEBHOOK_NOTIFICATION_URL`を完全に一致させる。

商品一覧と詳細には、`Square未登録`、`Square未反映`、`Square同期済み`、
`Square側で削除済み`の4状態を表示する。登録済み商品を下書き保存した場合や、
Squareへ未反映の写真がある場合は`Square未反映`になる。Square更新または最新情報取得が
成功すると`Square同期済み`へ戻る。

Square側の編集はWebhookでSupabaseへ反映する。ブラウザへ戻った際はSupabaseを自動再読込し、
登録済みの商品詳細を開いた際は保存済みSquare商品IDから最新情報を自動取得する。
商品詳細の「Squareの最新情報を取得」から手動更新することもできる。最終照合日時と
同期エラーの履歴を一覧に表示する機能、定期照合は未実装である。

### 商品のアーカイブ

商品一覧の「アーカイブ」はSupabaseの`items.deleted_at`を設定し、通常の一覧から非表示にする。
Square側の商品・写真とR2の写真は削除しない。SKUはアーカイブ後も使用済みとして保持し、
同じ店舗では再利用できない。Square商品を削除する機能は、誤削除による事業影響を避けるため実装しない。

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
- 商品詳細からSquareの最新商品情報をID指定で取得し、Supabaseと画面へ反映する
- 商品情報と写真の同期状況を「Square未反映／Square同期済み」など4状態で表示する
- 商品アーカイブではSquareとR2を変更せず、SKUを使用済みのまま保持する
- Supabase Authは未使用で、テスト運用向け公開RLSを使用している
