# clothes_check — アーキテクチャ & ロードマップ

中古Tシャツの採寸・撮影から商品登録までを効率化し、Square へ非公開で流し込む。
**まずWebアプリ（画像アップロード型）で最速リリースし、ネイティブアプリ化は後続フェーズ**とする。1店舗マルチデバイスで始め、同じ背骨のままマルチテナント SaaS へ拡張する。

| 項目 | 決定 |
|---|---|
| アプリ（先行） | **Webアプリ**（画像アップロード型、複数端末のブラウザから利用） |
| アプリ（後続） | React Native（ストア審査等の手間があるため後回し） |
| 必須項目 | **管理番号（SKU）・商品名（+SKU）・金額の3つのみ** |
| 任意項目 | ブランド・カテゴリ・サイズ・コンディション・採寸・写真。未入力のままSquare登録を進め、後から追記・編集可 |
| 言語 | **TypeScript**（フロント・サーバー共通） |
| DB | **Supabase**（Postgres / Auth / Storage） |
| サーバー実行環境 | **Cloudflare Workers** — Square/メルカリ連携・SKU重複チェック等のAPIロジックを実行。Squareトークンを秘匿 |
| 連携 | Square Catalog API（非公開作成 → 公開）。SKU重複はAPI側で保証されないためアプリ側で事前チェック |
| 形態 | 1店舗 → SaaS |

> ステータス：**Phase 0 完了 / Phase 1 着手可**（最優先＝Square登録を早期実現し店舗・ECで売れる状態を作る。写真・採寸・コンディションは後回し可）
> 最終更新：2026-07-16

---

## 01. 検証済み（動く根拠）

Web プロトタイプ＝「動く仕様書」。中核パイプラインはヘッドレス実測で確認済み。このロジックはネイティブ移植を待たず、まず本番Webアプリにそのまま活かす。

| 要素 | 結果 | 本番での実装 |
|---|---|---|
| **ArUco マーカー検知** | 4点・ID 正解・中心誤差 **0.5px** | Webアプリ（ブラウザ）でまず実装。将来ネイティブへ移植 |
| **遠近補正（4点ホモグラフィ）** | 傾き画像で実寸復元・誤差 **1e-14** | 同一式をWebアプリに実装（移植不要） |
| **Tシャツ自動点配置** | 身幅 51.0 / 肩 44.9 / 袖 17.1 / 着丈 67.4（実寸 51 / 46 / 18 / 64） | 色分割＋輪郭プロファイルをWebアプリに実装 |
| **UX / 画面フロー** | 採寸 → 情報 → 説明文 → CSV まで一巡 | Webアプリとして本番化。RN移植は後続フェーズ |

---

## 02. 技術スタック（決定事項）

- **APP（先行） — Webアプリ**
  画像アップロード型。スマホの標準カメラで撮影 → Webフォームからアップロード。複数スタッフ・複数端末はブラウザで共通。
- **APP（後続） — React Native**
  ネイティブ化はストア審査等の手間を踏まえて後回し。Webアプリの画面フロー・ロジックをそのまま移植する前提。
- **MEASURE — OpenCV相当のロジック（ArUco＋色分割＋ホモグラフィ）**
  Webプロトで実証済みのロジックをWebアプリでそのまま使用。**写真・採寸は任意項目**：未アップロードでも商品登録を進められ、後から追加・再計測できる。
- **DB — Supabase（Postgres / 認証 / ストレージ）**
  Webアプリの段階から導入。`store_id` でスコープ、RLS で店舗分離。APIロジックは持たず、データストアとしての役割に限定。
- **SERVER — Cloudflare Workers（TypeScript）**
  Square/メルカリ連携、SKU重複チェックなどのAPIロジックを実行する層。Squareトークンをここに秘匿し端末には置かない。SupabaseへはREST/クライアントSDK経由でアクセス。
- **SQUARE — Cloudflare Workers 経由**
  Catalog API で **非公開作成 → 公開**。写真・採寸・コンディションが未入力でも非公開作成は可能な設計とする。**SKU（管理番号）はSquare API側で一意性が保証されないため、作成前にWorkerが`SearchCatalogObjects`（`exact_query`でsku属性を検索）で重複チェックを行い、既存SKUがあれば登録を中断してスタッフに通知する。**

---

## 03. アーキテクチャ層

端末（ブラウザ）はWebアプリを開き、Supabase で全端末が同じ下書きを共有。Square 送信・SKU重複チェックは Cloudflare Workers が代理。

```
┌────────────┐   ┌──────────────┐   ┌──────────────────────┐   ┌────────────────┐
│ 端末(ブラウザ)│⇄  │ Cloudflare    │⇄ │  Supabase             │   │  Square         │
│ 複数スタッフ  │   │ Workers(TS)   │   │  DB   = 共有下書き      │   │  Catalog API    │
│ 複数端末     │   │ Square/       │   │  Storage = 画像        │   │  非公開で作成     │
│ (将来RNへ移行)│   │ メルカリ連携   │   │  Auth = スタッフ        │   │  → 最終確認      │
│             │   │ SKU重複チェック│   │                       │→ │  → 公開          │
└────────────┘   └──────────────┘   └──────────────────────┘   └────────────────┘
```

---

## 04. データモデル（Supabase スキーマ・草案）

最初から `store_id` でスコープ ＝ 1店舗でも将来のマルチテナントでも同じ形。
**必須項目は「管理番号（SKU）」「商品名（+SKU）」「金額」の3つのみ**。ブランド・カテゴリ・サイズ・コンディション・採寸・写真はすべて任意で、登録後にいつでも追記・編集できる。

```sql
-- 店舗（将来はテナント単位）
stores       (id, name, created_at)

-- スタッフ（1店舗に複数名）
app_users    (id, store_id→stores, name, role)

-- 商品の下書き本体
items        (id, store_id→stores, status['draft'|'confirmed'|'pushed'],
              mgmt_no NOT NULL（共有カウンタで自動採番、SKUとして利用）,
              title NOT NULL（商品名。Square登録時は "title + mgmt_no" で表示タイトルを組み立てる）,
              price NOT NULL,
              brand, category, size  -- NULL可（後から追記可）,
              condition NULL可（既定値NULL＝「後で設定」）,
              m_shoulder, m_chest, m_length, m_sleeve  -- すべてNULL可（後から採寸・編集可）,
              description, square_object_id,
              created_by→app_users, updated_at, deleted_at)

-- 写真（採寸メイン＋背面・襟・タグ・ダメージ）— 0枚でも登録可、後から追加可
item_photos  (id, item_id→items, role['main'|'back'|'collar'|'tag'|'damage'],
              storage_path, width, height, sort, created_at)

-- RLS: 全行を store_id でスコープ → スタッフは自店のみ閲覧
-- mgmt_no は共有カウンタで自動採番（端末間の重複を防ぐ）
-- updated_at / deleted_at で同期・論理削除に対応
-- Square トークンは Cloudflare Workers の秘密（Secrets）として保持（端末に置かない）
-- brand / category / size / condition / 採寸4項目 / 写真は未設定のままでも Square へ登録・公開してよい（後から更新すれば Square 側にも反映）
-- 必須は mgmt_no（SKU）／ title（商品名）／ price（金額）の3つのみ
```

---

## 05. マルチデバイス & SaaS への備え

複数スタッフ・複数端末は「共有バックエンドを今から」で解決。Webアプリの段階でもこれは変わらない。
SaaS 化で “変わる所” は薄い層に閉じ込め、コスト源は先送り。

**今から入れる（安い保険）**
- 共有 DB ＝ 全端末で同じ下書きを見る（同期・進捗・番号重複ゼロ）
- Square 接続を **1モジュールに隔離**（後で OAuth へ差し替え）
- 全データに **store_id** ／ 安定 ID・updated_at・論理削除
- Webアプリはレスポンシブで複数端末のブラウザから共通利用（将来RNへ移行してもSupabase/Cloudflare Workersはそのまま使える）

**SaaS フェーズまで作らない**
- 課金・サブスク
- 他店向け OAuth（code → token 交換）
- 店舗オンボーディング／管理コンソール

**ネイティブ化フェーズまで作らない**
- ライブカメラでのリアルタイム検知・撮影ガイド表示（マーカー検出状況・傾き・明るさ・ピントの即時表示）
- Swift/Kotlin・Vision/Core ML・ML Kit・LiteRTでのネイティブ最適化
- ストア審査対応・アプリ配布

---

## 06. フェーズ別ロードマップ（2026-07-16 改訂：Square連携前倒し＋Web先行）

**最優先事項**：Squareへの商品登録を早く実現し、店舗・ECで売れる状態を作ること。そのため
(1) Square連携（旧Phase 3）をPhase 1に前倒しし、
(2) 写真・採寸・コンディションはすべて任意項目にして登録のボトルネックにしない、
(3) ネイティブアプリ化（ストア審査等の手間がある）は後続フェーズに回し、まずWebアプリ（画像アップロード型）でリリースする。

| Phase | 状態 | 内容 |
|---|---|---|
| **0** | ✅ 済 | **パイプライン検証・Web プロト** — マーカー検知／遠近補正／自動配置を実測検証。UX 一巡を実装。 |
| **1** | ▶ 次・最優先 | **Webアプリ化 ＋ Supabase ＋ Square最小連携** — 詳細は下記「Phase 1の作業ブロック」。 |
| **2** | ○ 後 | **採寸・写真ワークフローの充実** — 自動採寸精度向上、追加写真ストリップ、タグOCR等をWebアプリ上で拡充。 |
| **3** | ○ 後 | **ネイティブアプリ化（React Native）** — ライブカメラ検知・リアルタイム撮影ガイド。ストア審査対応。Webアプリの画面フロー・ロジックを移植。 |
| **4** | ○ 後 | **マルチデバイス運用強化・他チャネル在庫連携** — 複数スタッフ・複数端末での競合制御、メルカリShops等の他チャネル在庫同期（詳細は[[square-mercari-api-capabilities]]メモ）。 |
| **5** | ○ 後 | **SaaS 化** — マルチテナント（RLS で既に下地あり）／課金／他店 OAuth・オンボーディング。 |

### Phase 1 の作業ブロック
1. **最小商品登録（最優先）**：必須入力を「管理番号（SKU、自動採番）」「商品名」「金額」の3項目のみに絞り、これだけでSquareへ非公開作成できるルートを最初に通す。ブランド・カテゴリ・サイズ・写真・採寸4項目・コンディションはすべて未入力でよい。
2. **Square 最小連携**：トークンを秘匿する最小 Cloudflare Worker を用意し、Webアプリの「登録」操作から Square Catalog API へ非公開作成→スタッフがSquareで最終確認→公開、の一次ルートを通す。作成前に`SearchCatalogObjects`でSKU重複チェックを行う。Square側の商品タイトルは「商品名 + SKU（管理番号）」を組み合わせて生成する。
3. **写真アップロード＋自動採寸（同フェーズ内で追加）**：スマホの標準カメラで撮った正面写真をWebフォームからアップロード→アップロード後にマーカー検出・遠近補正・自動採寸を実行→結果を確認・修正。ライブ撮影ガイド（リアルタイム表示）はこの段階では実装しない（Phase 3のネイティブ化で対応）。
4. **後追い編集**：ブランド・カテゴリ・サイズ・写真・採寸・コンディションは商品登録後いつでも追記・修正でき、更新時にSquare側の商品情報（タイトル・説明文含む）も反映する。

---

## 06.5 Square Catalog API マッピング（最小登録の3項目）

必須3項目 → Square Catalog APIのオブジェクト構造への対応。`POST /v2/catalog/object`（UpsertCatalogObject）を使用。

| アプリ側 | Squareフィールド | 備考 |
|---|---|---|
| 商品名＋SKU | `CatalogItem.item_data.name` | 「商品名 + 管理番号」を連結（最大512文字） |
| 管理番号（SKU） | `CatalogItemVariation.item_variation_data.sku` | バリエーション側のフィールド |
| 金額 | `CatalogItemVariation.item_variation_data.price_money`（`amount`+`currency`） | `pricing_type: FIXED_PRICING`とセット |

商品は必ず1つ以上のバリエーションが必要 → ITEM（親）＋ITEM_VARIATION（子）を毎回セットで作成する。新規作成時は`#`始まりの一時IDを使い、レスポンスの`id_mappings`で本物のIDを取得して`items.square_object_id`に保存する。

**「非公開作成→確認→公開」の実現方法**：公式ドキュメントいわく「Catalog APIで作成した新規商品は即座に全ロケーションに表示される」のがデフォルト。非公開にするには作成時に明示的に `present_at_all_locations: false` ＋ `present_at_location_ids: []` を指定し、公開時に同オブジェクトを`version`（楽観的排他制御）付きで再Upsertして `present_at_all_locations: true`（または対象ロケーションのみ指定）に更新する。

**SKU重複チェック（Square API側で一意性が保証されないため実装）**：Cloudflare Workerが`UpsertCatalogObject`を呼ぶ前に、`SearchCatalogObjects`を`object_types: ["ITEM_VARIATION"]`・`query.exact_query: {attribute_name: "sku", attribute_value: <mgmt_no>}`で呼び、既存SKUがヒットしたら登録を中断してスタッフにエラー表示する。

**JPY（円）**：ゼロ小数通貨のため`price_money.amount`はそのまま円の整数値（例：3000円→`amount: 3000`）でよい（確認済み）。

**実装前にサンドボックスで要検証**：
- 更新の競合制御（1アカウントにつき同時1件のみ処理、競合はHTTP 429。バッチ登録はリトライ制御が必要）
- 必要OAuthスコープ：`ITEMS_READ` / `ITEMS_WRITE`

---

## 06.6 画面フロー（2026-07-16 改訂：登録優先型）

必須3項目のみで即Square登録できる方針に合わせ、画面フローを「撮影→採寸→情報→Square」の一直線から、**「最小登録→即Square」を最初のゴールにし、写真・採寸・詳細情報は一覧からいつでも後追いできるループ構造**に変更する。旧フロー（撮影ガイド・リアルタイム判定含む）は[clothes_check_plan.md](./clothes_check_plan.md)8〜9章・21章を参照（ネイティブ化フェーズ＝Phase 3で復活）。

```text
[下書き一覧（ホーム）]
   │ ＋新規登録
   ▼
[クイック登録] 商品名・金額を入力（SKUは自動採番・表示のみ）
   │ 登録
   ▼
SKU重複チェック（Square検索）→ Square非公開作成 → Supabaseへ保存
   │
   ▼
[下書き一覧へ戻る]（新規行のステータス＝「Square下書き・詳細未設定」バッジ表示）
   │
   │ ← いつでも・何度でも商品をタップして再訪可能
   ▼
[商品詳細編集]
   ├─ 写真アップロード（正面／背面／タグ／襟元／ダメージ、役割タグ付け、0枚でも保存可）
   │     └─ 正面写真アップロード時のみ：自動採寸（マーカー検出・遠近補正・4項目算出）→ 結果確認・修正
   ├─ 基本情報（ブランド・カテゴリ・サイズ）— 任意
   ├─ コンディション選択（未設定のままでも可）
   └─ 説明文プレビュー（テンプレ自動生成。入力済み項目のみ反映、未設定項目は行ごと省略）
   │ 保存
   ▼
Supabase更新 → Square側の商品情報（タイトル・説明・画像）も更新
   │
   ▼
（任意タイミングで）[Squareで開く] ボタン → スタッフがSquareダッシュボード側で最終確認・公開（アプリ内に公開ボタンは置かない）
```

### 想定画面（改訂）

1. ログイン（スタッフ認証）
2. **下書き一覧（ホーム）** — 各行に状態バッジ（Square下書き／詳細未設定あり／公開済み）を表示。後回しにした項目が放置されないよう、未設定項目の有無を一覧上で可視化する。＋新規登録ボタン。
3. **クイック登録** — 商品名・金額の2フィールドのみ（SKUは自動採番されて表示）。登録＝即Square非公開作成。
4. **商品詳細編集**（タブ構成、いつでも中断・再開可）
   - 4a. 写真管理：アップロード・役割タグ付け・並び替え
   - 4b. 採寸：正面写真アップロード後の自動計測結果・手動修正（マット・マーカーはこの画面でのみ使用）
   - 4c. 基本情報：ブランド・カテゴリ・サイズ・コンディション
   - 4d. 説明文プレビュー：自動生成テンプレートの確認・編集
5. 設定・マット登録（後続）

### 旧フローとの主な違い
- 撮影ガイド画面（マーカー検出・傾き・明るさのリアルタイム表示）はPhase 1では実装しない。Web版は「撮影済みの写真をアップロード→アップロード後にまとめて検出・採寸」という非同期の形になる。
- 情報入力とSquare登録が最初の1ステップに凝縮され、写真・採寸・コンディション・ブランド等は「後で追記できるサブフロー」に切り出された。
- 一覧画面に状態バッジを追加し、「登録は速いが詳細が空のまま」という状態を可視化・追跡できるようにした（写真・採寸が入力されないまま放置されるリスクへの対策）。

### 商品詳細編集画面（画面4）のUI設計

モバイル幅を基準にしたモックアップを作成済み（本セッションのArtifact）。構成は以下の通り。

- **ヘッダー**：戻る導線／商品名・SKU・価格／状態バッジ（例：「詳細未設定あり」）
- **タブ（4つ、単一画面内で切り替え）**
  - **写真**：2列グリッド。埋まっている写真はサムネ＋役割ラベル（正面／背面／タグ／襟元／ダメージ）、未追加の役割は「＋追加」の点線スロットとして表示。0枚でも保存可能な旨を明記。
  - **採寸**：正面写真の有無で分岐。ある場合は自動計測結果（着丈・身幅・肩幅・袖丈）と信頼度、「再計測」ボタンを表示。数値タップで手動修正できる導線。
  - **基本情報**：ブランド・カテゴリ・表記サイズ（テキスト入力）、コンディション（セレクトの先頭に「未設定（後で設定）」を用意）。
  - **説明文**：テンプレートから自動生成した説明文プレビュー。未設定項目は行ごと省略される旨を明記。
- **フッター（常設）**：「Squareで開く」（Squareダッシュボードで最終確認・公開する導線）／「変更を保存」（Supabase更新→Square側にも反映）

### 実装方針：`mvp_prototype.html` の扱い

`mvp_prototype.html`は単一HTMLファイル＋バニラJSの「動く仕様書」（画面遷移は`.screen`のshow/hideとlocalStorage、マーカー検出は自前のARライブラリ実装、バックエンド無し・単一端末前提）。新しい画面構成（下書き一覧⇄クイック登録⇄商品詳細編集、Supabase・Cloudflare Workers連携、複数端末共有）とは前提が大きく異なるため、**このファイルをそのまま本番アプリへ改修していく方針ではない**。

- 新しいWebアプリは別のTypeScriptプロジェクトとして立ち上げる（画面/ルーティング/状態管理/Supabaseクライアント/Cloudflare Workers呼び出しを持つ構成）。
- `mvp_prototype.html`からは**検証済みのアルゴリズム部分だけを移植**する：マーカー辞書・検出（`AR.Dictionary`/`AR.Detector`）、ホモグラフィ（`solveHomography`/`applyH`）、自動ランドマーク配置・採寸計算（`autoLandmarks`/`placeLandmarks`/`computeMeas`）。これらをTypeScriptモジュールとして切り出し、新アプリの「採寸」タブから呼び出す。
- `mvp_prototype.html`自体は仕様確認用の参照物として残し、削除・改修はしない。
---

## 07. コスト感（Supabase）

| 段階 | プラン | 月額の目安 |
|---|---|---|
| 1店舗・検証 | Free（非稼働で自動停止・容量小） | **$0**（本番運用には停止が難点） |
| 1店舗・本番 | Pro（停止なし・DB 8GB・Storage 100GB・帯域 250GB） | **$25** 定額 |
| SaaS・拡大 | Pro＋従量（読取り課金なしで予測可能） | 利用に応じ加算（緩やか） |

定額で予測しやすく、Postgres ゆえ一覧表示が増えても読取り課金が膨らまない。将来の載せ替えコストもゼロ。

---

## 08. プロジェクト構成（2026-07-16 決定：pnpmモノレポ）

社内スタッフ向けツールでSEO等の必要がないため、**Next.jsではなくVite＋React＋TypeScriptのSPA**をフロントに採用（ビルド・実行がシンプルでMVP速度優先の方針に合う）。フロント／サーバー／共有コードをpnpm workspacesの1モノレポにまとめ、型を共有する。

```
clothes_check/
├── apps/
│   ├── web/                 # Vite + React + TypeScript（SPA）
│   │   └── Supabaseクライアントで直接Auth/DB読み書き（RLSで店舗スコープ）
│   │       Cloudflare Pagesへデプロイ
│   └── worker/               # Cloudflare Workers + Hono
│       └── Square/メルカリ連携、SKU重複チェックなど「秘密を扱う」処理のみ担当
│           Squareトークン等はWorkerのSecretsに保持
├── packages/
│   ├── shared/                # 共有型・zodスキーマ（Item, MeasurementResult, Square連携用の型など）
│   └── measure/               # 採寸ロジック（mvp_prototype.htmlから移植：AR.Dictionary/AR.Detector・
│   │                             solveHomography・autoLandmarks/placeLandmarks/computeMeas）
│   │                             apps/web の「採寸」タブから呼び出す（ブラウザ内で完結）
├── supabase/
│   └── migrations/            # items / item_photos / stores / app_users のSQL・RLSポリシー
├── mvp_prototype.html         # 既存。参照用として残す（改修しない）
├── clothes_check_architecture.md
├── clothes_check_plan.md
├── pnpm-workspace.yaml
└── package.json
```

**役割分担の原則**：
- `apps/web`：画面（下書き一覧／クイック登録／商品詳細編集）とSupabaseへの通常のCRUD（RLSで店舗スコープされるため秘密情報を持つ必要がない）
- `apps/worker`：Squareトークンなど**秘密を扱う処理だけ**を担当（Catalog API呼び出し、SKU重複チェック、将来のメルカリ連携）。`apps/web`からはこのWorkerのエンドポイントを介してのみSquareへ書き込む
- `packages/measure`：ブラウザで完結する採寸ロジック。サーバーに画像を送らず処理する非機能要件（元要件19章）にも合致

**テスト**：`apps/web`・`packages/measure`はVitest。`apps/worker`は`@cloudflare/vitest-pool-workers`でWorkers環境を再現してテスト。

**APIの設定・秘密情報はすべて`apps/worker`側に閉じる**：
- Square/メルカリのアクセストークンは**Cloudflare Workers Secrets**として登録（`wrangler secret put SQUARE_ACCESS_TOKEN`）。リポジトリのコードには書かず、実行時に環境変数として注入される。
- Catalog API呼び出し・SKU重複チェックなどのロジックも`apps/worker`のTypeScriptコードに実装する。
- `apps/web`はSquare APIを直接叩かず、`apps/worker`が公開する自前のエンドポイント（例：`POST /api/items/:id/register-to-square`）を呼ぶだけ。
- Sandbox/本番の切り替えなど非秘密の設定は`apps/worker/wrangler.toml`の環境変数（`[vars]`・環境ごとの`[env.xxx]`）で管理する。

---

## 補足メモ

- **App Store 手数料**：物理商品の売買は手数料なし。デジタル課金（アプリ月額）は 15〜30%＋IAP。**Webアプリ配布なら手数料ゼロ**（先行フェーズの利点の一つ）。
- **マーカー**：印刷用シート（辞書 `DICT_ARUCO_ORIGINAL`、ID 0-3、TL/TR/BR/BL）。中心〜中心距離をアプリ設定に cm 登録（0.1cm＝1mm 刻みの小数対応）。マーカーは回転自由・裏返し（鏡像）のみ不可。
- 元要件：[clothes_check_plan.md](./clothes_check_plan.md)（0章に2026-07-16の方針変更まとめあり）
- 動くプロトタイプ：`mvp_prototype.html`
