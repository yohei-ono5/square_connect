-- 写真削除を「削除予定」と「Square反映済み」に分ける。
-- pending_delete_at は下書き保存後、Squareへはまだ反映していない状態。
-- deleted_at はSquareから削除済みで、通常画面には表示しない状態。
-- 復元できるようR2のファイル本体は削除せず、storage_pathを保持する。
alter table item_photos
  add column pending_delete_at timestamptz,
  add column deleted_at timestamptz;

create index item_photos_active_item_id_index
  on item_photos (item_id)
  where deleted_at is null;
