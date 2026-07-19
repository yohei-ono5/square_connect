import type { MockItem } from "../store/ItemsContext";

export function StatusBadge({ item }: { item: MockItem }) {
  if (item.squareObjectId !== null) {
    return <span className="badge badge-neutral">Square登録済み</span>;
  }
  return <span className="badge badge-warning">Square未登録</span>;
}
