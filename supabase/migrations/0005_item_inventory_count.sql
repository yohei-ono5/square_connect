-- Square Inventory APIへ反映する店舗在庫数。
-- 古着の一点物を前提に、新規商品の既定値は1とする。
alter table items
  add column inventory_count integer not null default 1
  check (inventory_count >= 0 and inventory_count <= 999999);
