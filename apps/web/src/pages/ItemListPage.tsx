import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isDetailComplete, useItems, type MockItem } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

type StatusFilter = "all" | "incomplete" | "complete";
type SortKey = "newest" | "oldest" | "priceDesc" | "priceAsc";

function matchesQuery(item: MockItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.mgmtNo.toLowerCase().includes(q) ||
    (item.brand ?? "").toLowerCase().includes(q)
  );
}

export function ItemListPage() {
  const { items } = useItems();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const stats = useMemo(() => {
    const incomplete = items.filter((it) => !isDetailComplete(it)).length;
    return { total: items.length, incomplete, complete: items.length - incomplete };
  }, [items]);

  const visibleItems = useMemo(() => {
    // 登録順（newest）はaddItemが先頭に追加していく前提の並び。oldestはその逆順。
    const base = sortKey === "oldest" ? [...items].reverse() : [...items];
    const filtered = base.filter((it) => {
      if (!matchesQuery(it, query)) return false;
      if (statusFilter === "incomplete") return !isDetailComplete(it);
      if (statusFilter === "complete") return isDetailComplete(it);
      return true;
    });
    if (sortKey === "priceDesc") filtered.sort((a, b) => b.price - a.price);
    if (sortKey === "priceAsc") filtered.sort((a, b) => a.price - b.price);
    return filtered;
  }, [items, query, statusFilter, sortKey]);

  return (
    <div className="screen">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>下書き一覧</h1>
          <Link to="/items/new" className="btn btn-primary">
            + 新規登録
          </Link>
        </div>
      </div>

      <div className="content" style={{ paddingBottom: 0 }}>
        <div className="stat-grid">
          <div className="stat-card">
            <p className="stat-label">総数</p>
            <p className="stat-value">{stats.total}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">詳細未設定あり</p>
            <p className="stat-value" style={{ color: "var(--warning-text)" }}>
              {stats.incomplete}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">詳細入力済み</p>
            <p className="stat-value">{stats.complete}</p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="input"
            placeholder="商品名・ブランド・SKUで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">すべての状態</option>
            <option value="incomplete">詳細未設定あり</option>
            <option value="complete">詳細入力済み</option>
          </select>
          <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="newest">登録が新しい順</option>
            <option value="oldest">登録が古い順</option>
            <option value="priceDesc">価格が高い順</option>
            <option value="priceAsc">価格が安い順</option>
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="content">
          <p style={{ color: "var(--text-secondary)" }}>まだ商品がありません。「+ 新規登録」から最初の1件を登録してください。</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="content">
          <p style={{ color: "var(--text-secondary)" }}>条件に一致する商品がありません。</p>
        </div>
      ) : (
        <ul className="list">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <Link to={`/items/${item.id}`} className="list-item">
                <div className="list-item-row">
                  <div>
                    <p style={{ margin: 0, fontSize: 14 }}>{item.title || "（商品名未設定）"}</p>
                    <p className="subtitle">
                      SKU {item.mgmtNo} ・ ¥{item.price.toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge item={item} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
