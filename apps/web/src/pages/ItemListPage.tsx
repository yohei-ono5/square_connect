import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useItems, type MockItem, type SquareCategory } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";
import {
  sortCategoriesForRegistration,
  sortParentCategoriesForRegistration,
} from "../lib/categorySorting";
import { toUserErrorMessage } from "../lib/appError";

type SortKey = "mgmtNoAsc" | "mgmtNoDesc" | "priceAsc" | "priceDesc" | "title";
type CategoryOption = Pick<SquareCategory, "id" | "name" | "parentName">;

function matchesQuery(item: MockItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.mgmtNo.toLowerCase().includes(q)
  );
}

function matchesCategory(
  item: MockItem,
  parent: CategoryOption | undefined,
  child: CategoryOption | undefined,
  categories: SquareCategory[],
): boolean {
  if (!parent) return true;

  if (child) {
    return item.categoryId === child.id || (!item.categoryId && item.category === child.name);
  }

  if (item.categoryId) {
    const itemCategory = categories.find((category) => category.id === item.categoryId);
    return itemCategory?.id === parent.id || itemCategory?.parentId === parent.id;
  }

  if (!item.category) return false;
  return categories.some(
    (category) =>
      category.name === item.category &&
      (category.id === parent.id || category.parentId === parent.id),
  );
}

export function ItemListPage() {
  const location = useLocation();
  const navigationNotice = (location.state as {
    notice?: string;
    noticeType?: "success" | "warning";
  } | null);
  const {
    companyName,
    items,
    itemsLoading,
    itemsError,
    reloadItems,
    archiveItem,
    refreshActiveItemsFromSquare,
    squareCategories,
    categoriesLoading,
    categoriesError,
    loadSquareCategories,
  } = useItems();
  const [query, setQuery] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [childCategoryId, setChildCategoryId] = useState("");
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

  const parentCategories = useMemo(
    () => sortParentCategoriesForRegistration(squareCategories ?? [], items),
    [items, squareCategories],
  );
  const selectedParentCategory = useMemo(
    () => parentCategories.find((category) => category.id === parentCategoryId),
    [parentCategories, parentCategoryId],
  );
  const childCategories = useMemo(
    () => sortCategoriesForRegistration(
      (squareCategories ?? []).filter(
        (category) => category.parentId === selectedParentCategory?.id,
      ),
      items,
    ),
    [items, selectedParentCategory?.id, squareCategories],
  );
  const selectedChildCategory = useMemo(
    () => childCategories.find((category) => category.id === childCategoryId),
    [childCategories, childCategoryId],
  );

  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) => {
      if (!matchesQuery(it, query)) return false;
      if (!matchesCategory(
        it,
        selectedParentCategory,
        selectedChildCategory,
        squareCategories ?? [],
      )) return false;
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
  }, [items, query, selectedParentCategory, selectedChildCategory, sortKey, squareCategories]);

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
      setArchiveError(toUserErrorMessage(error, "ITEM_ARCHIVE"));
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
      if (result.changed === 0) {
        const details = [
          `${result.unchanged}件に差分なし`,
          ...(result.missing > 0 ? [`${result.missing}件がSquareで見つかりません`] : []),
        ];
        setSquareRefreshNotice(`Square側の変更はありませんでした（${details.join("、")}）`);
        return;
      }
      const details = [
        ...(result.deleted > 0 ? [`うち${result.deleted}件がSquare側で削除済み`] : []),
        ...(result.unchanged > 0 ? [`${result.unchanged}件は差分なし`] : []),
        ...(result.missing > 0 ? [`${result.missing}件がSquareで見つかりません`] : []),
      ];
      setSquareRefreshNotice(
        `Squareの変更を${result.changed}件反映しました${details.length > 0 ? `（${details.join("、")}）` : ""}`,
      );
    } catch (error) {
      setSquareRefreshError(toUserErrorMessage(error, "SQUARE_LIST_REFRESH"));
    } finally {
      setSquareRefreshing(false);
    }
  }

  return (
    <div className="screen">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h1 className="item-list-title">
            {companyName && <span className="item-list-company-name">{companyName}</span>}
            <span>商品一覧</span>
          </h1>
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
                  {squareRefreshing ? "更新中…" : "更新"}
                </button>
                <button type="button" className="btn" onClick={toggleSelectionMode} disabled={visibleItems.length === 0}>
                  選択
                </button>
                <Link to="/items/new" className="btn btn-primary">
                  登録
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
              aria-label="大カテゴリで絞り込み"
              value={parentCategoryId}
              onChange={(e) => {
                setParentCategoryId(e.target.value);
                setChildCategoryId("");
              }}
              disabled={categoriesLoading}
            >
              <option value="">大カテゴリ：すべて</option>
              {parentCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <select
              className="select"
              aria-label="中カテゴリで絞り込み"
              value={childCategoryId}
              onChange={(e) => setChildCategoryId(e.target.value)}
              disabled={categoriesLoading || !selectedParentCategory || childCategories.length === 0}
            >
              <option value="">
                {!selectedParentCategory
                  ? "中カテゴリ：すべて"
                  : childCategories.length === 0
                    ? "中カテゴリなし"
                    : "中カテゴリ：すべて"}
              </option>
              {childCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-meta">
            <span className="filter-count">{visibleItems.length}件</span>
            <label className="filter-sort-label">
              <span>並び替え</span>
              <select
                className="select filter-sort"
                aria-label="商品の並び順"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="mgmtNoAsc">商品番号 昇順</option>
                <option value="mgmtNoDesc">商品番号 降順</option>
                <option value="priceAsc">価格が安い順</option>
                <option value="priceDesc">価格が高い順</option>
                <option value="title">商品名順</option>
              </select>
            </label>
          </div>
          {categoriesLoading && <p className="filter-message">Squareのカテゴリを取得中…</p>}
          {categoriesError && <p className="form-error filter-message">{categoriesError}</p>}
          {squareCategories?.length === 0 && !categoriesLoading && !categoriesError && (
            <p className="filter-message">Squareにカテゴリが登録されていません</p>
          )}
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
