# clothes_check

古着Tシャツの採寸・商品登録を効率化し、Squareへ商品登録するためのアプリ。設計の詳細・ロードマップは [clothes_check_architecture.md](./clothes_check_architecture.md) を参照（元要件は [docs/clothes_check_plan.md](./docs/clothes_check_plan.md)）。

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
  migrations/  DBスキーマ・RLSポリシー
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
