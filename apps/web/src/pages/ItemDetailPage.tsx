import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONDITION_LABELS, buildDescription, type Condition } from "@clothes-check/shared";
import { useItems, type PhotoRole } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

const PHOTO_ROLES: { role: PhotoRole; label: string }[] = [
  { role: "main", label: "正面" },
  { role: "back", label: "背面" },
  { role: "tag", label: "タグ" },
  { role: "collar", label: "襟元" },
  { role: "damage", label: "ダメージ" },
];

type TabKey = "photo" | "measure" | "basic" | "desc";
const TABS: { key: TabKey; label: string }[] = [
  { key: "photo", label: "写真" },
  { key: "measure", label: "採寸" },
  { key: "basic", label: "基本情報" },
  { key: "desc", label: "説明文" },
];

// mvp_prototype.html の実測値。packages/measure が実装されるまでの仮の自動採寸結果。
const MOCK_MEASUREMENT = { shoulderCm: 44.9, chestCm: 51.0, lengthCm: 67.4, sleeveCm: 17.1 };

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getItem, updateItem, addPhoto, removePhoto } = useItems();
  const item = id ? getItem(id) : undefined;
  const [tab, setTab] = useState<TabKey>("photo");
  const [pendingRole, setPendingRole] = useState<PhotoRole | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!item) {
    return (
      <div className="screen">
        <div className="header">
          <Link to="/" className="back-link">
            ← 下書き一覧に戻る
          </Link>
          <h1>商品が見つかりません</h1>
        </div>
      </div>
    );
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  }

  function openPicker(role: PhotoRole) {
    setPendingRole(role);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingRole || !id) return;
    const url = URL.createObjectURL(file);
    addPhoto(id, pendingRole, url);
    setPendingRole(null);
  }

  function runAutoMeasure() {
    if (!id) return;
    setMeasuring(true);
    setTimeout(() => {
      updateItem(id, { measurements: MOCK_MEASUREMENT });
      setMeasuring(false);
    }, 600);
  }

  const mainPhoto = item.photos.find((p) => p.role === "main");

  return (
    <div className="screen">
      <input type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />

      <div className="header">
        <Link to="/" className="back-link">
          ← 下書き一覧に戻る
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>{item.title || "（商品名未設定）"}</p>
            <p className="subtitle">
              SKU {item.mgmtNo} ・ ¥{item.price.toLocaleString()}
            </p>
          </div>
          <StatusBadge item={item} />
        </div>
      </div>

      <div className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "photo" && (
        <div className="content">
          <div className="photo-grid">
            {PHOTO_ROLES.map(({ role, label }) => {
              const photo = item.photos.find((p) => p.role === role);
              return photo ? (
                <div key={role} className="photo-slot filled">
                  <img src={photo.previewUrl} alt={label} />
                  <span className="photo-slot-label">{label}</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 12 }}
                    onClick={() => removePhoto(id!, role)}
                  >
                    削除
                  </button>
                </div>
              ) : (
                <button key={role} type="button" className="photo-slot empty" onClick={() => openPicker(role)}>
                  <span>＋</span>
                  <span style={{ fontSize: 12 }}>{label}を追加</span>
                </button>
              );
            })}
          </div>
          <p className="hint">写真は0枚でも保存できます。正面写真を追加すると自動採寸が使えます。</p>
        </div>
      )}

      {tab === "measure" && (
        <div className="content">
          {!mainPhoto ? (
            <p className="hint" style={{ margin: 0 }}>
              正面写真をアップロードすると自動採寸が使えます。<button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setTab("photo")}>写真タブへ</button>
            </p>
          ) : (
            <>
              <div className="measure-card">
                <img src={mainPhoto.previewUrl} alt="正面" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
                <div style={{ flex: 1 }}>
                  {item.measurements ? (
                    <>
                      <p style={{ fontSize: 13, margin: 0 }}>正面写真から自動計測済み</p>
                      <p style={{ fontSize: 12, color: "var(--accent)", margin: "2px 0 0" }}>信頼度 高</p>
                    </>
                  ) : (
                    <p style={{ fontSize: 13, margin: 0 }}>{measuring ? "計測中…" : "まだ計測していません"}</p>
                  )}
                </div>
                <button type="button" className="btn" onClick={runAutoMeasure} disabled={measuring}>
                  {item.measurements ? "再計測" : "自動採寸を実行"}
                </button>
              </div>

              {item.measurements && (
                <table className="measure-table">
                  <tbody>
                    {(
                      [
                        ["着丈", "lengthCm"],
                        ["身幅", "chestCm"],
                        ["肩幅", "shoulderCm"],
                        ["袖丈", "sleeveCm"],
                      ] as const
                    ).map(([label, key]) => (
                      <tr key={key}>
                        <td style={{ color: "var(--text-secondary)" }}>{label}</td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            className="input"
                            style={{ width: 90, textAlign: "right", display: "inline-block" }}
                            type="number"
                            step="0.1"
                            value={item.measurements![key] ?? ""}
                            onChange={(e) =>
                              updateItem(id!, {
                                measurements: { ...item.measurements!, [key]: e.target.value === "" ? null : Number(e.target.value) },
                              })
                            }
                          />{" "}
                          cm
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="hint">数値を直接編集すると手動で修正できます。</p>
            </>
          )}
        </div>
      )}

      {tab === "basic" && (
        <div className="content">
          <div className="field">
            <label htmlFor="brand">ブランド</label>
            <input
              id="brand"
              className="input"
              placeholder="例：ディズニー"
              value={item.brand ?? ""}
              onChange={(e) => updateItem(id!, { brand: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="category">カテゴリ</label>
            <input
              id="category"
              className="input"
              placeholder="例：キャラクターTシャツ"
              value={item.category ?? ""}
              onChange={(e) => updateItem(id!, { category: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="size">表記サイズ</label>
            <input
              id="size"
              className="input"
              placeholder="例：XL"
              value={item.size ?? ""}
              onChange={(e) => updateItem(id!, { size: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="price">価格（円）</label>
            <input
              id="price"
              className="input"
              type="number"
              min={0}
              value={item.price}
              onChange={(e) => updateItem(id!, { price: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label htmlFor="condition">コンディション</label>
            <select
              id="condition"
              className="select"
              value={item.condition ?? ""}
              onChange={(e) => updateItem(id!, { condition: (e.target.value || null) as Condition })}
            >
              <option value="">未設定（後で設定）</option>
              {(Object.keys(CONDITION_LABELS) as (keyof typeof CONDITION_LABELS)[]).map((key) => (
                <option key={key} value={key}>
                  {key}：{CONDITION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab === "desc" && (
        <div className="content">
          <div className="description-preview">{buildDescription(item)}</div>
          <p className="hint">未設定の項目は行ごと省略されます。保存するとSquareの商品情報にも反映されます。</p>
        </div>
      )}

      <div className="footer-bar">
        <button
          type="button"
          className="btn"
          style={{ flex: 1 }}
          onClick={() => showToast("モック環境のため実際のSquareへは接続していません")}
        >
          Squareで開く
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={() => showToast("保存しました")}
        >
          変更を保存
        </button>
      </div>
      {toast && <p className="toast">{toast}</p>}
    </div>
  );
}
