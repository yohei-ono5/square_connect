import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useItems, type MockItem } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

type StatusFilter = "all" | "registered" | "unregistered";
type SortKey = "mgmtNo" | "priceAsc" | "priceDesc" | "title";

function matchesQuery(item: MockItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.mgmtNo.toLowerCase().includes(q) ||
    (item.category ?? "").toLowerCase().includes(q)
  );
}

export function ItemListPage() {
  const { items, deleteItem } = useItems();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("mgmtNo");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const stats = useMemo(() => {
    // squareObjectIdは「Squareに登録」のAPI呼び出しが成功した時だけセットされるため、
    // それをそのまま登録済み判定に使う（詳細はArchitectureドキュメント参照）。
    const squareRegistered = items.filter((it) => it.squareObjectId !== null).length;
    return {
      total: items.length,
      squareRegistered,
      squareUnregistered: items.length - squareRegistered,
    };
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) => {
      if (!matchesQuery(it, query)) return false;
      if (statusFilter === "registered") return it.squareObjectId !== null;
      if (statusFilter === "unregistered") return it.squareObjectId === null;
      return true;
    });
    // mgmtNoは数字のみの想定（先頭ゼロは表示用の文字列としてのみ保持）なので、
    // 並べ替えの比較には数値化したものを使う。
    if (sortKey === "mgmtNo") filtered.sort((a, b) => Number(a.mgmtNo) - Number(b.mgmtNo));
    if (sortKey === "priceAsc") filtered.sort((a, b) => a.price - b.price);
    if (sortKey === "priceDesc") filtered.sort((a, b) => b.price - a.price);
    if (sortKey === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "ja"));
    return filtered;
  }, [items, query, statusFilter, sortKey]);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleItems]);

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleBulkDelete() {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`選択した${count}件を商品一覧から削除しますか？`)) return;
    selectedIds.forEach((id) => deleteItem(id));
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  return (
    <div className="screen">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>商品一覧</h1>
          <div className="header-actions">
            {selectionMode ? (
              <>
                <button type="button" className="btn" onClick={toggleSelectionMode}>
                  キャンセル
                </button>
                <button type="button" className="btn btn-danger" disabled={selectedIds.size === 0} onClick={handleBulkDelete}>
                  削除
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={toggleSelectionMode} disabled={visibleItems.length === 0}>
                  選択
                </button>
                <Link to="/items/new" className="btn btn-primary">
                  + 新規登録
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="content" style={{ paddingBottom: 0 }}>
        <div className="stat-grid">
          <div className="stat-card">
            <p className="stat-label">総数</p>
            <p className="stat-value">{stats.total}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Square登録済み</p>
            <p className="stat-value" style={{ color: "var(--accent)" }}>
              {stats.squareRegistered}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Square未登録</p>
            <p className="stat-value">{stats.squareUnregistered}</p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="input"
            placeholder="商品名・カテゴリ・SKUで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">すべての状態</option>
            <option value="registered">Square登録済み</option>
            <option value="unregistered">Square未登録</option>
          </select>
          <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="mgmtNo">商品番号順</option>
            <option value="priceAsc">価格が安い順</option>
            <option value="priceDesc">価格が高い順</option>
            <option value="title">商品名（あいうえお順）</option>
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
              <div className={`list-item ${selectionMode ? "selecting" : ""}`}>
                {selectionMode && (
                  <label className="select-check" aria-label={`${item.title || item.mgmtNo}を選択`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </label>
                )}
                <Link
                  to={`/items/${item.id}`}
                  className="list-item-main"
                  onClick={(e) => {
                    if (!selectionMode) return;
                    e.preventDefault();
                    toggleSelected(item.id);
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 14 }}>{item.title || "（商品名未設定）"}</p>
                    <p className="subtitle">
                      {item.mgmtNo} ・ ¥{item.price.toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge item={item} />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
