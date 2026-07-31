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
クイック登録では複数写真をまとめて選択でき、選択後の追加・個別削除にも対応する。
表示順の1枚目を正面写真（`main`）、2枚目以降を追加写真（`sub`）として保存する。
複数枚のアップロード途中で失敗した場合は、作成済みの一時商品と保存済み写真を破棄する。

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

クイック登録画面は、商品番号・商品名・金額を「必須項目」、大カテゴリ・中カテゴリ・写真を
「任意項目」としてセクション分けする。
Squareの商品名には商品名だけを登録し、商品番号はバリエーションのSKUへ別項目として登録する。
写真は任意で、添付されていない場合はSquare画像同期を実行せず、画像に関する警告も表示しない。
写真を添付した場合だけSquareへ画像を同期し、画像同期に失敗したときは、商品登録自体が
成功したことと画像だけが未反映であることを商品一覧に警告表示する。
金額欄は0〜9の数字のみ入力でき、小数点・マイナス・指数表記などは受け付けない。
同じ店舗内で商品番号が重複した場合は、画面上の事前チェックとSupabaseの一意制約の
どちらで検出しても「商品番号（SKU）が重複しています。」と
`ERR-ITEM-001`を表示する。

`VITE_DEFAULT_STORE_ID`が未設定の場合は`stores`の最初の店舗を使う。
店舗が1件もない場合は、検証用の企業・店舗を自動作成する。
現在の1社運用では、選択された店舗の`stores.company_name`を商品一覧の見出しに表示する。

### Squareの販売チャネル運用

Square Dashboardの「商品と在庫 → 商品 → 設定 → 商品の初期設定」で、
オンラインチャネル「Rosso&Nero（赤と黒の店）」を未選択にして運用する。
これにより、このアプリから登録した新規商品はPOSレジだけで利用し、ECサイトへは
自動掲載しない。ECサイトへ掲載する商品は、Square登録後にSquare Dashboardの商品詳細または
一括編集から対象のオンラインチャネルを選択する。

現在のSquare公式APIでは、商品のオンラインチャネル割り当ては読み取り専用であり、
このアプリからECサイトへの掲載・非掲載を変更できない。`present_at_all_locations`は
Squareロケーションでの利用可否を表す設定で、ECサイトの公開設定ではない。
Square側の初期設定を変更しても既存商品のチャネルは変わらないため、必要に応じて
Square Dashboardで既存商品の販売チャネルも変更する。

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

商品詳細の基本情報は、連携範囲が分かるよう画面上で次の2区分に分ける。

- 「Square連携項目（Squareに直接反映されます）」：商品番号（SKU）、商品名、カテゴリ、価格
- 「アプリ管理項目（Squareには反映されません）」：対象、表記サイズ、コンディション

アプリ管理項目はSupabaseへ保存する。表記サイズとコンディションはSquare Catalogの
専用フィールドには連携せず、生成した商品説明文の一部としてSquareへ反映する。対象は
現時点ではSquareへ送信しない。表記サイズはXXS〜XXXL、FREEのプルダウンを基本とし、
「その他」では38、W32、Kids 150など任意の表記を入力できる。既存の任意サイズも失わず
そのまま表示・編集する。
商品詳細の説明文タブでは、SKU・サイズ・採寸・コンディションなどから生成した本文を
「自動で作成（Squareには反映されません）」として表示する。「本文をコピー」を押すと全文をクリップボードへコピーし、
スマートフォンからSquareなどへ貼り付けられる。

新規登録画面のカテゴリは任意項目とし、Workerの
`GET /api/square/categories`を通してSquare Catalog APIから取得する。
選択欄は「大カテゴリ」「中カテゴリ」の連動する2段階プルダウンとし、大カテゴリを
選ぶとその配下だけを中カテゴリへ表示する。中カテゴリは任意で、大カテゴリだけ、または
カテゴリ未設定のままでも下書き保存・Square登録ができる。選択したカテゴリ名は
Supabaseの`items.category`へ保存し、選択したSquareカテゴリIDは商品登録APIへ渡す。
大カテゴリのみの場合は`CatalogItem.categories`と`reporting_category`の両方へ大カテゴリIDを
設定する。中カテゴリを選んだ場合は`categories`へ中カテゴリID、`reporting_category`へ
大カテゴリIDを設定し、Squareの商品画面でも分類とレポートカテゴリを分けて表示する。カテゴリIDは
`items.square_category_id`にも保存し、商品詳細画面での下書き保存・Square登録・Square更新でも
同じ2段階選択とIDを再利用する。カテゴリ一覧は画面セッション中に1回だけ取得して再利用する。

既存DBには`supabase/migrations/0003_item_square_category.sql`を適用する。

カテゴリの表示順は、ブラウザの現在月（春=3〜5月、夏=6〜8月、秋=9〜11月、冬=12〜2月）
から判定した季節との相性、商品一覧での利用回数、カテゴリ名の日本語順の順で決める。
大カテゴリは、配下の中カテゴリの季節評価と利用回数を集約して並べる。たとえば夏は
Tシャツ・ショートパンツなどを上位、ダウン・コート・ニットなどを下位にする。

金額は入力した円の整数をSquareの固定価格へそのまま送信し、アプリ内では消費税の加算・
逆算や税IDの設定を行わない。税込・税別の扱いはSquare側の税設定に従う。

最新情報取得はSKU検索ではなく、対象商品のSquare IDを直接使うため、別商品を誤って取り込まない。

Square側の変更は`catalog.version.updated` Webhookを
`POST /api/webhooks/square`で受信し、前回同期時刻以降の変更をSupabaseへ反映する。
利用前に以下を行う。

1. `supabase/migrations/0001_init.sql`、`0002_item_photos_square_image.sql`、
   `0003_item_square_category.sql`を順番に適用する
2. Workerへ`SUPABASE_URL`、`SUPABASE_SECRET_KEY`（SupabaseのSecret key）、
   `SQUARE_WEBHOOK_SIGNATURE_KEY`、`SQUARE_WEBHOOK_NOTIFICATION_URL`を設定する
3. Square Developer Consoleで、上記通知URLを`catalog.version.updated`へ登録する

`SUPABASE_SECRET_KEY`にはSupabaseの新しいSecret key（`sb_secret_...`）を使用し、
Legacy API Keysの`service_role`は使用しない。Secret keyはCloudflare Workerの
「設定 → 変数とシークレット」へ`SUPABASE_SECRET_KEY`の名前で保存し、
リポジトリ、Build variables、フロントエンドには含めない。

Webhook通知URLは署名生成に含まれるため、Square Developer ConsoleのURLと
`SQUARE_WEBHOOK_NOTIFICATION_URL`を完全に一致させる。

商品一覧と詳細には、`Square未登録`、`Square未反映`、`Square反映済み`、
`Square側で削除済み`の4状態を表示する。登録済み商品を下書き保存した場合や、
Squareへ未反映の写真がある場合は`Square未反映`になる。Square更新または最新情報取得が
成功すると`Square反映済み`へ戻る。この表示は最後にSquareへ送信またはSquareから取得した
時点で反映されていたことを表す。Squareの最終確認日時は、商品一覧では状態バッジの下、
商品詳細では商品名の下に表示する。商品詳細の上部は商品名だけを主情報として表示し、
商品番号と金額は基本情報タブで確認・編集する。
商品詳細を開いた時点から入力内容が変わっていない場合は、不要な保存日時更新を防ぐため
「下書き保存」と登録済み商品の「Squareを更新」を無効にする。下書き保存後は、
Squareへ未反映の変更が残るため「Squareを更新」だけを有効にする。

Square側の編集はWebhookでSupabaseへ反映する。ブラウザへ戻った際はSupabaseを自動再読込し、
登録済みの商品詳細を開いた際と、別画面から商品詳細へ戻った際は、保存済みSquare商品IDから
最新情報を自動取得する（連続取得を避けるため30秒間隔）。商品詳細の
「Squareの最新情報を取得」から手動更新することもできる。同期エラー履歴の表示と定期照合は
未実装である。

商品一覧の「Squareから一覧更新」は、Supabase上で未アーカイブかつSquare登録済みの商品IDだけを
`BatchRetrieveCatalogObjects`へ最大1,000件ずつ渡し、商品情報と削除状態を一括更新する。
Square全カタログやアーカイブ済み商品、Square未登録商品は取得対象にしない。
取得前のSupabaseの値と比較して変更あり・差分なし・削除済み・未検出の件数を表示し、
差分がない場合も最終確認日時は更新する。
スマートフォンで商品を多く表示できるよう統計ダッシュボードは置かず、商品名・SKUの
キーワード検索、大カテゴリ・中カテゴリの2段階絞り込み、商品番号・価格・商品名の
並べ替えだけをコンパクトに配置する。対象（メンズ／レディース／ユニセックス）の
絞り込みは商品一覧に表示しない。大カテゴリを選ぶと配下の商品全体、中カテゴリを選ぶと
該当カテゴリの商品だけを表示する。並び替えは検索結果件数と同じ行に置き、
商品番号は「商品番号 昇順」「商品番号 降順」と表記する。

### 採寸

商品詳細の採寸タブでは、写真の有無にかかわらず、着丈・身幅・肩幅・袖丈を手動入力できる。
各項目は空欄でも保存でき、0〜300cmを0.1cm単位で入力する。写真からの自動採寸は試験機能として
残し、検出結果は候補として表示する。「この値を手動入力欄へ反映」を押すまでは、入力済みの
採寸値を上書きしない。

写真を添付した時点ではR2とSupabaseへの保存だけを行い、Squareへは送信しない。Square登録済み
商品の写真は`Square未反映`として扱い、商品詳細の「Squareを更新」を押したときに商品情報と
まとめてSquareへ反映する。Squareへの反映に失敗した場合も、この更新操作の結果として表示する。

### 商品のアーカイブ

商品一覧の「アーカイブ」はSupabaseの`items.deleted_at`を設定し、通常の一覧から非表示にする。
Square側の商品・写真とR2の写真は削除しない。SKUはアーカイブ後も使用済みとして保持し、
同じ店舗では再利用できない。Square商品を削除する機能は、誤削除による事業影響を避けるため実装しない。

### エラー表示

ユーザー画面には、対処方法が分かる日本語メッセージと固定のエラーコードを表示する。
Supabase、Square API、通信処理などが返した技術的な詳細は画面へ直接表示せず、
同じエラーコードとともにブラウザのコンソールへ記録する。

| エラーコード | 内容 |
| --- | --- |
| `ERR-CONFIG-001` | システム設定 |
| `ERR-NET-001` | 通信 |
| `ERR-DATA-001` | 店舗情報 |
| `ERR-ITEM-001`〜`005` | SKU重複、商品読込・保存・アーカイブ・未検出 |
| `ERR-PHOTO-001`〜`004` | 写真読込・保存・削除・Square同期 |
| `ERR-SQUARE-001`〜`006` | Square登録・更新・取得・一覧更新・カテゴリ・連携結果保存 |
| `ERR-COPY-001` | 説明文のコピー |

エラーコードは原因の種類を表す固定値とし、ユーザーからの問い合わせと
ブラウザコンソールの詳細ログを対応付けるために使用する。

## ビルド・型チェック・テスト

```bash
pnpm build       # 全パッケージをビルド
pnpm typecheck   # 全パッケージを型チェック
pnpm test        # 全パッケージのテストを実行
```

## 現状

- 商品本体とSquareの商品IDはSupabaseへ永続化する
- 商品写真はCloudflare R2へ保存し、`item_photos`の情報から再読み込み後も表示する
- クイック登録は必須・任意項目を分け、複数写真を一度に登録できる
- R2の商品写真をSquare Catalogの商品画像として添付・削除同期する
- 商品詳細からSquareの最新商品情報をID指定で取得し、Supabaseと画面へ反映する
- 商品情報と写真の反映状況を「Square未反映／Square反映済み」など4状態と最終確認日時で表示する
- `stores.company_name`を商品一覧の見出しに表示する
- 採寸は写真なしでも手動入力でき、自動採寸は確認後に反映する試験機能として提供する
- 商品アーカイブではSquareとR2を変更せず、SKUを使用済みのまま保持する
- Supabase Authは未使用で、テスト運用向け公開RLSを使用している
