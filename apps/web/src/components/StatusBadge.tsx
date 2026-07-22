import type { MockItem } from "../store/ItemsContext";

export type SquareSyncStatus = "unregistered" | "pending" | "synced" | "deleted";

export function getSquareSyncStatus(item: MockItem): SquareSyncStatus {
  if (!item.squareObjectId) return "unregistered";
  if (item.squareDeletedAt) return "deleted";

  const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
  const syncedAt = item.squareSyncedAt ? Date.parse(item.squareSyncedAt) : Number.NaN;
  const itemPending = !Number.isFinite(syncedAt) || (Number.isFinite(updatedAt) && updatedAt > syncedAt);
  const photoPending = item.photos.some((photo) => photo.squareImageId === null);
  return itemPending || photoPending ? "pending" : "synced";
}

export function StatusBadge({ item }: { item: MockItem }) {
  const status = getSquareSyncStatus(item);
  if (status === "synced") return <span className="badge badge-success">Square同期済み</span>;
  if (status === "pending") return <span className="badge badge-warning">Square未反映</span>;
  if (status === "deleted") return <span className="badge badge-danger">Square側で削除済み</span>;
  return <span className="badge badge-neutral">Square未登録</span>;
}
