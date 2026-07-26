-- Squareのカテゴリ名だけでは、親ごとに存在する「その他」などを一意に識別できない。
-- 選択したCatalogCategory IDを保持し、商品登録・更新時にSquareへ確実に反映する。
alter table items
  add column if not exists square_category_id text;
