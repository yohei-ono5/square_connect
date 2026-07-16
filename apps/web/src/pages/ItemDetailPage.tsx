import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONDITION_LABELS, GENDER_LABELS, buildDescription, type Condition, type Gender } from "@clothes-check/shared";
import {
  calculateMeasurements,
  detectInitialMeasurePoints,
  DEFAULT_MEASURE_POINTS,
  type MeasurePointKey,
} from "@clothes-check/measure";
import { useItems, type PhotoRole } from "../store/ItemsContext";
import { StatusBadge } from "../components/StatusBadge";

type TabKey = "photo" | "measure" | "basic" | "desc";
const TABS: { key: TabKey; label: string }[] = [
  { key: "photo", label: "写真" },
  { key: "measure", label: "採寸" },
  { key: "basic", label: "基本情報" },
  { key: "desc", label: "説明文" },
];

const POINT_LABELS: Record<MeasurePointKey, string> = {
  shoulderL: "左肩",
  shoulderR: "右肩",
  pitL: "左脇",
  pitR: "右脇",
  collar: "首元",
  hem: "裾",
  cuffL: "袖先",
};

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getItem, updateItem, addPhoto, removePhoto } = useItems();
  const item = id ? getItem(id) : undefined;
  const [tab, setTab] = useState<TabKey>("photo");
  const [pendingRole, setPendingRole] = useState<PhotoRole | null>(null);
  const [activePoint, setActivePoint] = useState<MeasurePointKey | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [detected, setDetected] = useState<boolean | null>(null);
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
  const currentItem = item;

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

  async function runAutoMeasure() {
    if (!id || !mainPhoto) return;
    setMeasuring(true);
    try {
      const { points, detected: matched } = await detectInitialMeasurePoints(mainPhoto.previewUrl);
      updateItem(id, { measurePoints: points, measurements: calculateMeasurements(points) });
      setDetected(matched);
    } finally {
      setMeasuring(false);
    }
  }

  function updateMeasurePoint(key: MeasurePointKey, clientX: number, clientY: number, element: HTMLDivElement) {
    if (!id) return;
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    const nextPoints = { ...(currentItem.measurePoints ?? DEFAULT_MEASURE_POINTS), [key]: { x, y } };
    updateItem(id, { measurePoints: nextPoints, measurements: calculateMeasurements(nextPoints) });
  }

  function handleMeasureStagePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!activePoint) return;
    updateMeasurePoint(activePoint, e.clientX, e.clientY, e.currentTarget);
  }

  function endPointDrag() {
    setActivePoint(null);
  }

  const mainPhoto = item.photos.find((p) => p.role === "main");
  const subPhotos = item.photos.filter((p) => p.role === "sub");
  const measurePoints = item.measurePoints ?? DEFAULT_MEASURE_POINTS;

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
          <p className="field-heading">正面写真（採寸に使用）</p>
          <div className="photo-grid">
            {mainPhoto ? (
              <div className="photo-slot filled">
                <img src={mainPhoto.previewUrl} alt="正面" />
                <span className="photo-slot-label">正面</span>
                <button
                  type="button"
                  className="btn"
                  style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 12 }}
                  onClick={() => removePhoto(id!, mainPhoto.id)}
                >
                  削除
                </button>
              </div>
            ) : (
              <button type="button" className="photo-slot empty" onClick={() => openPicker("main")}>
                <span>＋</span>
                <span style={{ fontSize: 12 }}>正面写真を追加</span>
              </button>
            )}
          </div>

          <p className="field-heading" style={{ marginTop: 20 }}>
            追加写真（任意・撮る場合だけでOK）
          </p>
          <div className="photo-grid">
            {subPhotos.map((photo) => (
              <div key={photo.id} className="photo-slot filled">
                <img src={photo.previewUrl} alt="追加写真" />
                <button
                  type="button"
                  className="btn"
                  style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 12 }}
                  onClick={() => removePhoto(id!, photo.id)}
                >
                  削除
                </button>
              </div>
            ))}
            <button type="button" className="photo-slot empty" onClick={() => openPicker("sub")}>
              <span>＋</span>
              <span style={{ fontSize: 12 }}>写真を追加</span>
            </button>
          </div>
          <p className="hint">
            背面・タグ・襟元・ダメージなど、決まったカテゴリはありません。撮った分だけ自由に追加してください。写真は0枚でも保存できます。
          </p>
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
                      <p style={{ fontSize: 13, margin: 0 }}>
                        {detected === false ? "Tシャツを検出できませんでした" : "Tシャツを検出して仮配置しました"}
                      </p>
                      <p
                        style={{
                          fontSize: 12,
                          color: detected === false ? "var(--warning-text)" : "var(--accent)",
                          margin: "2px 0 0",
                        }}
                      >
                        {detected === false ? "中央に仮配置・要確認" : "検出精度は目安・要確認"}
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 13, margin: 0 }}>{measuring ? "検出中…" : "まだ計測していません"}</p>
                  )}
                </div>
                <button type="button" className="btn" onClick={runAutoMeasure} disabled={measuring}>
                  {item.measurements ? "再検出" : "自動検出を実行"}
                </button>
              </div>

              {item.measurements && (
                <>
                  <div
                    className="measure-stage"
                    onPointerMove={handleMeasureStagePointerMove}
                    onPointerUp={endPointDrag}
                    onPointerCancel={endPointDrag}
                    onPointerLeave={endPointDrag}
                  >
                    <img src={mainPhoto.previewUrl} alt="採寸用正面写真" />
                    <svg className="measure-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <line
                        x1={measurePoints.shoulderL.x}
                        y1={measurePoints.shoulderL.y}
                        x2={measurePoints.shoulderR.x}
                        y2={measurePoints.shoulderR.y}
                        className="measure-line shoulder"
                      />
                      <line
                        x1={measurePoints.pitL.x}
                        y1={measurePoints.pitL.y}
                        x2={measurePoints.pitR.x}
                        y2={measurePoints.pitR.y}
                        className="measure-line chest"
                      />
                      <line
                        x1={measurePoints.collar.x}
                        y1={measurePoints.collar.y}
                        x2={measurePoints.hem.x}
                        y2={measurePoints.hem.y}
                        className="measure-line length"
                      />
                      <line
                        x1={measurePoints.shoulderL.x}
                        y1={measurePoints.shoulderL.y}
                        x2={measurePoints.cuffL.x}
                        y2={measurePoints.cuffL.y}
                        className="measure-line sleeve"
                      />
                    </svg>
                    {(Object.keys(measurePoints) as MeasurePointKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`measure-point ${activePoint === key ? "active" : ""}`}
                        style={{ left: `${measurePoints[key].x}%`, top: `${measurePoints[key].y}%` }}
                        aria-label={`${POINT_LABELS[key]}の位置`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setActivePoint(key);
                          updateMeasurePoint(key, e.clientX, e.clientY, e.currentTarget.closest(".measure-stage") as HTMLDivElement);
                        }}
                        onPointerMove={(e) => {
                          if (activePoint !== key) return;
                          updateMeasurePoint(key, e.clientX, e.clientY, e.currentTarget.closest(".measure-stage") as HTMLDivElement);
                        }}
                        onPointerUp={endPointDrag}
                        onPointerCancel={endPointDrag}
                      />
                    ))}
                  </div>

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
                </>
              )}
              <p className="hint">画像上の点をドラッグして位置を確認・調整できます。数値を直接編集することもできます。</p>
            </>
          )}
        </div>
      )}

      {tab === "basic" && (
        <div className="content">
          <div className="field">
            <label htmlFor="gender">対象</label>
            <select
              id="gender"
              className="select"
              value={item.gender ?? ""}
              onChange={(e) => updateItem(id!, { gender: (e.target.value || null) as Gender })}
            >
              <option value="">未設定</option>
              {(Object.keys(GENDER_LABELS) as (keyof typeof GENDER_LABELS)[]).map((key) => (
                <option key={key} value={key}>
                  {GENDER_LABELS[key]}
                </option>
              ))}
            </select>
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
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={() => showToast("保存しました")}
        >
          下書き保存
        </button>
        <button
          type="button"
          className="btn"
          style={{ flex: 1 }}
          onClick={() => showToast("モック環境のため実際のSquareへは登録されません")}
        >
          Squareに登録
        </button>
      </div>
      {toast && <p className="toast">{toast}</p>}
    </div>
  );
}
