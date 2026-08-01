import type { MockItem } from "../store/ItemsContext";

export type SquareSyncStatus = "unregistered" | "pending" | "reflected" | "deleted";

export function getSquareSyncStatus(item: MockItem): SquareSyncStatus {
  if (!item.squareObjectId) return "unregistered";
  if (item.squareDeletedAt) return "deleted";

  const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
  const syncedAt = item.squareSyncedAt ? Date.parse(item.squareSyncedAt) : Number.NaN;
  const itemPending = !Number.isFinite(syncedAt) || (Number.isFinite(updatedAt) && updatedAt > syncedAt);
  const photoPending = item.photos.some((photo) => photo.squareImageId === null || photo.pendingDelete);
  return itemPending || photoPending ? "pending" : "reflected";
}

function formatSquareCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未確認";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SquareCheckedAt({
  item,
  className = "",
}: {
  item: MockItem;
  className?: string;
}) {
  if (!item.squareObjectId) return null;

  return (
    <time
      className={`square-checked-at ${className}`.trim()}
      dateTime={item.squareSyncedAt ?? undefined}
    >
      Squareの最終確認: {item.squareSyncedAt ? formatSquareCheckedAt(item.squareSyncedAt) : "未確認"}
    </time>
  );
}

export function StatusBadge({
  item,
  showCheckedAt = true,
}: {
  item: MockItem;
  showCheckedAt?: boolean;
}) {
  const status = getSquareSyncStatus(item);
  const badge = status === "reflected"
    ? <span className="badge badge-success">Square反映済み</span>
    : status === "pending"
      ? <span className="badge badge-warning">Square未反映</span>
      : status === "deleted"
        ? <span className="badge badge-danger">Square側で削除済み</span>
        : <span className="badge badge-neutral">Square未登録</span>;

  return (
    <span className="square-status">
      {badge}
      {showCheckedAt && <SquareCheckedAt item={item} />}
    </span>
  );
}
