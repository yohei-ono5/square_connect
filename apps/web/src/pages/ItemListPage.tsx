import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { GENDER_LABELS, type Gender } from "@square-connect/shared";
import { useItems, type MockItem } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

type SortKey = "mgmtNoAsc" | "mgmtNoDesc" | "priceAsc" | "priceDesc" | "title";
type GenderFilter = "all" | NonNullable<Gender>;

function matchesQuery(item: MockItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.mgmtNo.toLowerCase().includes(q)
  );
}

export function ItemListPage() {
  const location = useLocation();
  const navigationNotice = (location.state as {
    notice?: string;
    noticeType?: "success" | "warning";
  } | null);
  const {
    items,
    itemsLoading,
    itemsError,
    reloadItems,
    archiveItem,
    refreshActiveItemsFromSquare,
    squareCategories,
    loadSquareCategories,
  } = useItems();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("mgmtNoAsc");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [squareRefreshing, setSquareRefreshing] = useState(false);
  const [squareRefreshNotice, setSquareRefreshNotice] = useState<string | null>(null);
  const [squareRefreshError, setSquareRefreshError] = useState<string | null>(null);

  useEffect(() => {
    loadSquareCategories();
  }, [loadSquareCategories]);

  useEffect(() => {
    const handleFocus = () => {
      void reloadItems().catch((error: unknown) => {
        console.error("Item list refresh on focus failed", error);
      });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [reloadItems]);

  const categoryOptions = useMemo(
    () => [...new Set([
      ...(squareCategories ?? []).map((category) => category.name),
      ...items.flatMap((item) => item.category ? [item.category] : []),
    ])].sort((a, b) => a.localeCompare(b, "ja")),
    [items, squareCategories],
  );

  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) => {
      if (!matchesQuery(it, query)) return false;
      if (categoryFilter !== "all" && it.category !== categoryFilter) return false;
      if (genderFilter !== "all" && it.gender !== genderFilter) return false;
      return true;
    });
    // mgmtNoは数字のみの想定（先頭ゼロは表示用の文字列としてのみ保持）なので、
    // 並べ替えの比較には数値化したものを使う。
    if (sortKey === "mgmtNoAsc") filtered.sort((a, b) => Number(a.mgmtNo) - Number(b.mgmtNo));
    if (sortKey === "mgmtNoDesc") filtered.sort((a, b) => Number(b.mgmtNo) - Number(a.mgmtNo));
    if (sortKey === "priceAsc") filtered.sort((a, b) => a.price - b.price);
    if (sortKey === "priceDesc") filtered.sort((a, b) => b.price - a.price);
    if (sortKey === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "ja"));
    return filtered;
  }, [items, query, categoryFilter, genderFilter, sortKey]);

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

  function openArchiveDialog() {
    if (selectedIds.size === 0) return;
    setArchiveError(null);
    setArchiveDialogOpen(true);
  }

  function closeArchiveDialog() {
    if (archiving) return;
    setArchiveDialogOpen(false);
    setArchiveError(null);
  }

  async function handleBulkArchive() {
    const count = selectedIds.size;
    if (count === 0) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await Promise.all([...selectedIds].map((id) => archiveItem(id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
      setArchiveDialogOpen(false);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "商品のアーカイブに失敗しました");
    } finally {
      setArchiving(false);
    }
  }

  async function handleSquareListRefresh() {
    if (squareRefreshing) return;
    setSquareRefreshing(true);
    setSquareRefreshNotice(null);
    setSquareRefreshError(null);
    try {
      const result = await refreshActiveItemsFromSquare();
      if (result.targeted === 0) {
        setSquareRefreshNotice("Square登録済みの更新対象商品はありません");
        return;
      }
      const details = [
        `${result.updated}件を更新`,
        ...(result.deleted > 0 ? [`${result.deleted}件がSquare側で削除済み`] : []),
        ...(result.missing > 0 ? [`${result.missing}件がSquareで見つかりません`] : []),
      ];
      setSquareRefreshNotice(`Squareの最新情報を取得しました（${details.join("、")}）`);
    } catch (error) {
      setSquareRefreshError(error instanceof Error ? error.message : "Squareの商品一覧を更新できませんでした");
    } finally {
      setSquareRefreshing(false);
    }
  }

  return (
    <div className="screen">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h1>商品一覧</h1>
          <div className="header-actions">
            {selectionMode ? (
              <>
                <button type="button" className="btn" onClick={toggleSelectionMode}>
                  キャンセル
                </button>
                <button type="button" className="btn btn-archive" disabled={selectedIds.size === 0} onClick={openArchiveDialog}>
                  アーカイブ
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={handleSquareListRefresh}
                  disabled={squareRefreshing || itemsLoading || !items.some((item) => item.squareObjectId)}
                  aria-label="Squareから商品一覧を更新"
                  title="Squareから商品一覧を更新"
                >
                  {squareRefreshing ? "更新中…" : "↻ 更新"}
                </button>
                <button type="button" className="btn" onClick={toggleSelectionMode} disabled={visibleItems.length === 0}>
                  選択
                </button>
                <Link to="/items/new" className="btn btn-primary">
                  ＋登録
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="content" style={{ paddingBottom: 0 }}>
        {navigationNotice?.notice && (
          <p
            className={`list-notice ${navigationNotice.noticeType === "warning" ? "list-notice-warning" : ""}`}
            role="status"
          >
            {navigationNotice.notice}
          </p>
        )}
        {squareRefreshNotice && (
          <p className="list-notice" role="status">
            {squareRefreshNotice}
          </p>
        )}
        {squareRefreshError && (
          <p className="form-error" role="alert">
            {squareRefreshError}
          </p>
        )}
        <div className="filter-bar">
          <input
            className="input"
            placeholder="商品名・SKUで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filter-options">
            <select
              className="select"
              aria-label="カテゴリで絞り込み"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">カテゴリ：すべて</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select
              className="select"
              aria-label="対象で絞り込み"
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value as GenderFilter)}
            >
              <option value="all">対象：すべて</option>
              {(Object.keys(GENDER_LABELS) as NonNullable<Gender>[]).map((gender) => (
                <option key={gender} value={gender}>
                  {GENDER_LABELS[gender]}
                </option>
              ))}
            </select>
            <select
              className="select filter-sort"
              aria-label="商品の並び順"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="mgmtNoAsc">商品番号順（昇順）</option>
              <option value="mgmtNoDesc">商品番号順（降順）</option>
              <option value="priceAsc">価格が安い順</option>
              <option value="priceDesc">価格が高い順</option>
              <option value="title">商品名順（あいうえお）</option>
            </select>
          </div>
        </div>
      </div>

      {itemsLoading ? (
        <div className="content">
          <p style={{ color: "var(--text-secondary)" }}>商品一覧を読み込んでいます…</p>
        </div>
      ) : itemsError ? (
        <div className="content">
          <p className="form-error">{itemsError}</p>
        </div>
      ) : items.length === 0 ? (
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

      {archiveDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeArchiveDialog}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="archive-dialog-title" className="dialog-title">商品をアーカイブしますか？</h2>
            <p className="dialog-message">
              選択した{selectedIds.size}件を商品一覧から非表示にします。
            </p>
            <p className="dialog-note">
              Square側の商品・写真は削除されず、そのまま残ります。
            </p>
            {archiveError && <p className="form-error" role="alert">{archiveError}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={closeArchiveDialog} disabled={archiving}>
                キャンセル
              </button>
              <button type="button" className="btn btn-archive-solid" onClick={handleBulkArchive} disabled={archiving}>
                {archiving ? "アーカイブ中…" : "アーカイブする"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
