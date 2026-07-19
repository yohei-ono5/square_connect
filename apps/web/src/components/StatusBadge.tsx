import type { MockItem } from "../store/ItemsContext";
import { getMissingFieldLabels } from "../store/ItemsContext";

const MAX_SHOWN = 2;

export function StatusBadge({ item }: { item: MockItem }) {
  const missing = getMissingFieldLabels(item);
  if (missing.length === 0) {
    return <span className="badge badge-neutral">詳細入力済み</span>;
  }
  const shown = missing.slice(0, MAX_SHOWN).join("・");
  const label = missing.length > MAX_SHOWN ? `${shown}など未設定` : `${shown}未設定`;
  return <span className="badge badge-warning">{label}</span>;
}
