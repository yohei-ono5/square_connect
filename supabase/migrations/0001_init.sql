-- 企業・店舗（小規模運用を前提に1テーブルで管理。同じ企業が複数店舗を持つ場合は
-- company_id / company_name を共有する）
create table stores (
  store_id uuid primary key default gen_random_uuid(),
  company_id uuid not null default gen_random_uuid(),
  company_name text not null,
  store_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_company_id_index on stores (company_id);

-- 商品の下書き本体。必須は mgmt_no / title / price のみ、それ以外はNULL可（後から追記編集）
create table items (
  item_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (store_id),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'pushed')),
  mgmt_no text not null,
  title text not null,
  price integer not null,
  gender text check (gender in ('mens', 'womens', 'unisex')),
  category text,
  size text,
  condition text check (condition in ('S', 'A', 'B', 'C', 'D')),
  m_shoulder numeric,
  m_chest numeric,
  m_length numeric,
  m_sleeve numeric,
  description text,
  square_object_id text,
  square_variation_id text,
  square_version bigint,
  square_synced_at timestamptz,
  square_deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, mgmt_no)
);

-- 写真（正面=main は採寸トリガーとして特別扱い。それ以外は撮る/撮らないが商品次第なので
-- 背面・タグ・襟元…のような固定カテゴリは設けず、sub として自由に何枚でも追加できる）。0枚でも登録可
create table item_photos (
  item_photo_id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (item_id) on delete cascade,
  role text not null check (role in ('main', 'sub')),
  storage_path text not null,
  width integer,
  height integer,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index items_square_object_id_unique
  on items (square_object_id)
  where square_object_id is not null;

-- catalog.version.updatedは変更オブジェクト自体を含まないため、前回のSquareカタログ
-- 更新時刻を保持し、SearchCatalogObjects(begin_time)の起点にする。
create table square_sync_state (
  merchant_id text primary key,
  last_catalog_updated_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- SquareがWebhookを再送しても同じイベントを安全に扱えるようイベントIDを記録する。
create table square_webhook_events (
  square_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table stores enable row level security;
alter table items enable row level security;
alter table item_photos enable row level security;
alter table square_sync_state enable row level security;
alter table square_webhook_events enable row level security;

-- テスト運用中はSupabase Authを使わず、Publishable keyを持つブラウザから
-- anonデータベースロールで店舗・商品・写真を読み書きできるようにする。
-- 本運用時はこの3ポリシーを店舗スコープの認証ポリシーへ置き換える。
create policy "public stores during pilot" on stores
  for all to anon using (true) with check (true);

create policy "public items during pilot" on items
  for all to anon using (true) with check (true);

create policy "public item_photos during pilot" on item_photos
  for all to anon using (true) with check (true);

grant select, insert, update, delete on stores, items, item_photos to anon;

-- Square同期用の2テーブルはSecret keyを持つWorkerだけが操作するため、
-- ブラウザ向けRLSポリシーは作らない。
