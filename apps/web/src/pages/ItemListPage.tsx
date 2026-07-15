import { Link } from "react-router-dom";
import { useItems } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

export function ItemListPage() {
  const { items } = useItems();

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

      {items.length === 0 ? (
        <div className="content">
          <p style={{ color: "var(--text-secondary)" }}>まだ商品がありません。「+ 新規登録」から最初の1件を登録してください。</p>
        </div>
      ) : (
        <ul className="list">
          {items.map((item) => (
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
