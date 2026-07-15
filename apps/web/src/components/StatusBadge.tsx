import type { MockItem } from "../store/ItemsContext";
import { isDetailComplete } from "../store/ItemsContext";

export function StatusBadge({ item }: { item: MockItem }) {
  if (!isDetailComplete(item)) {
    return <span className="badge badge-warning">詳細未設定あり</span>;
  }
  return <span className="badge badge-neutral">詳細入力済み</span>;
}
