-- 店舗（将来はテナント単位）
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- スタッフ（Supabase Authのユーザーと1:1、1店舗に複数名）
create table app_users (
  id uuid primary key references auth.users (id),
  store_id uuid not null references stores (id),
  name text not null,
  role text not null default 'staff'
);

-- 商品の下書き本体。必須は mgmt_no / title / price のみ、それ以外はNULL可（後から追記編集）
create table items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'pushed')),
  mgmt_no text not null,
  title text not null,
  price integer not null,
  brand text,
  category text,
  size text,
  condition text check (condition in ('S', 'A', 'B', 'C', 'D')),
  m_shoulder numeric,
  m_chest numeric,
  m_length numeric,
  m_sleeve numeric,
  description text,
  square_object_id text,
  created_by uuid references app_users (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, mgmt_no)
);

-- 写真（採寸メイン＋背面・襟・タグ・ダメージ）。0枚でも登録可
create table item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  role text not null check (role in ('main', 'back', 'collar', 'tag', 'damage')),
  storage_path text not null,
  width integer,
  height integer,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

alter table app_users enable row level security;
alter table items enable row level security;
alter table item_photos enable row level security;

-- スタッフは自分の store_id 配下のみ閲覧・操作できる
create policy "self app_user" on app_users
  for all using (id = auth.uid());

create policy "store scoped items" on items
  for all using (
    store_id in (select store_id from app_users where id = auth.uid())
  );

create policy "store scoped item_photos" on item_photos
  for all using (
    item_id in (
      select id from items
      where store_id in (select store_id from app_users where id = auth.uid())
    )
  );
