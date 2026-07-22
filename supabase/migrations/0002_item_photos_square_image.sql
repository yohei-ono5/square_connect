-- R2の写真とSquare CatalogImageの対応を保持し、二重アップロードと削除漏れを防ぐ。
alter table item_photos
  add column square_image_id text;

create unique index item_photos_square_image_id_unique
  on item_photos (square_image_id)
  where square_image_id is not null;
