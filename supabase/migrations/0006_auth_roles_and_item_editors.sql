-- Supabase Authによる店舗単位アクセス、管理者権限、商品の登録者・最終編集者を追加する。
-- 既存商品は担当者を特定できないため、created_by / last_edited_by はNULLを許容する。

create table profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  last_name text not null,
  first_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_last_name_length check (char_length(btrim(last_name)) between 1 and 100),
  constraint profiles_first_name_length check (char_length(btrim(first_name)) between 1 and 100)
);

create table store_memberships (
  store_id uuid not null references stores (store_id) on delete cascade,
  user_id uuid not null references profiles (user_id) on delete restrict,
  role text not null check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  approved_by uuid references profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  primary key (store_id, user_id)
);

create index store_memberships_user_id_index on store_memberships (user_id)
  where is_active;

-- 店舗管理者から昇格できない、運用者だけが管理するシステム管理者一覧。
create table system_admins (
  user_id uuid primary key references profiles (user_id) on delete restrict,
  created_at timestamptz not null default now()
);

-- 店舗コードは英大文字・数字6文字を使い、SHA-256ハッシュだけを保持する。
-- このテーブルはブラウザへ公開せず、利用申請を受け付けるWorkerだけが参照する。
create table store_registration_codes (
  store_id uuid primary key references stores (store_id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table store_access_requests (
  store_id uuid not null references stores (store_id) on delete cascade,
  user_id uuid not null references profiles (user_id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index store_access_requests_store_status_index
  on store_access_requests (store_id, status, created_at);

alter table items
  add column created_at timestamptz not null default now(),
  add column created_by uuid,
  add column last_edited_by uuid,
  add column last_edited_at timestamptz;

alter table items
  add constraint items_created_by_fkey
    foreign key (created_by) references profiles (user_id) on delete restrict,
  add constraint items_last_edited_by_fkey
    foreign key (last_edited_by) references profiles (user_id) on delete restrict;

-- マイグレーション前から存在するAuthユーザーにもプロフィールを作る。氏名未設定の利用者は
-- ログイン後に本人がプロフィールから修正できるよう、メールのローカル部を暫定表示に使う。
insert into profiles (user_id, last_name, first_name)
select
  id,
  coalesce(nullif(btrim(raw_user_meta_data ->> 'last_name'), ''), split_part(email, '@', 1), '未設定'),
  coalesce(nullif(btrim(raw_user_meta_data ->> 'first_name'), ''), '未設定')
from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, last_name, first_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''), '未設定'),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''), '未設定')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- RLS内で再帰せず所属判定できるよう、権限テーブルを直接参照する関数に集約する。
create or replace function public.is_system_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.system_admins where user_id = check_user_id
  );
$$;

create or replace function public.has_store_access(
  check_store_id uuid,
  allowed_roles text[] default array['admin', 'staff']::text[],
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_system_admin(check_user_id) or exists (
    select 1
    from public.store_memberships
    where store_id = check_store_id
      and user_id = check_user_id
      and is_active
      and role = any(allowed_roles)
  );
$$;

create or replace function public.shares_active_store(
  target_user_id uuid,
  viewer_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships target_membership
    join public.store_memberships viewer_membership
      on viewer_membership.store_id = target_membership.store_id
    where target_membership.user_id = target_user_id
      and target_membership.is_active
      and viewer_membership.user_id = viewer_user_id
      and viewer_membership.is_active
  );
$$;

revoke all on function public.is_system_admin(uuid) from public;
revoke all on function public.has_store_access(uuid, text[], uuid) from public;
revoke all on function public.shares_active_store(uuid, uuid) from public;
grant execute on function public.is_system_admin(uuid) to authenticated;
grant execute on function public.has_store_access(uuid, text[], uuid) to authenticated;
grant execute on function public.shares_active_store(uuid, uuid) to authenticated;

alter table profiles enable row level security;
alter table store_memberships enable row level security;
alter table system_admins enable row level security;
alter table store_registration_codes enable row level security;
alter table store_access_requests enable row level security;

drop policy if exists "public stores during pilot" on stores;
drop policy if exists "public items during pilot" on items;
drop policy if exists "public item_photos during pilot" on item_photos;
revoke all on stores, items, item_photos from anon;

grant select on stores, profiles, store_memberships, system_admins, store_access_requests to authenticated;
grant update (first_name, last_name, updated_at) on profiles to authenticated;
grant select, insert, update, delete on items, item_photos to authenticated;

create policy "members can view their stores" on stores
  for select to authenticated
  using (public.has_store_access(store_id));

create policy "members can read store items" on items
  for select to authenticated
  using (public.has_store_access(store_id));

create policy "members can create store items" on items
  for insert to authenticated
  with check (
    public.has_store_access(store_id)
    and created_by = auth.uid()
    and last_edited_by = auth.uid()
  );

create policy "members can update store items" on items
  for update to authenticated
  using (public.has_store_access(store_id))
  with check (public.has_store_access(store_id));

create policy "members can delete store items" on items
  for delete to authenticated
  using (public.has_store_access(store_id));

create policy "members can read item photos" on item_photos
  for select to authenticated
  using (exists (
    select 1 from items
    where items.item_id = item_photos.item_id
      and public.has_store_access(items.store_id)
  ));

create policy "members can create item photos" on item_photos
  for insert to authenticated
  with check (exists (
    select 1 from items
    where items.item_id = item_photos.item_id
      and public.has_store_access(items.store_id)
  ));

create policy "members can update item photos" on item_photos
  for update to authenticated
  using (exists (
    select 1 from items
    where items.item_id = item_photos.item_id
      and public.has_store_access(items.store_id)
  ));

create policy "members can delete item photos" on item_photos
  for delete to authenticated
  using (exists (
    select 1 from items
    where items.item_id = item_photos.item_id
      and public.has_store_access(items.store_id)
  ));

create policy "members can view store profiles" on profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_system_admin()
    or public.shares_active_store(user_id)
  );

create policy "users can update their profile" on profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can view their memberships" on store_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_system_admin()
    or public.has_store_access(store_id, array['admin']::text[])
  );

create policy "users can view their system admin status" on system_admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_system_admin());

create policy "users can view their access requests" on store_access_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_system_admin()
    or public.has_store_access(store_id, array['admin']::text[])
  );
