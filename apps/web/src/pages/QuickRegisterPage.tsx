import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useItems } from "../store/ItemsContext";

const WORKER_BASE_URL = (import.meta.env.VITE_WORKER_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");

export function QuickRegisterPage() {
  const { addItem, updateItem, isMgmtNoTaken } = useItems();
  const navigate = useNavigate();
  const [mgmtNo, setMgmtNo] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = mgmtNo.trim().length > 0 && title.trim().length > 0 && price.trim().length > 0 && !submitting;

  // Square側の重複チェック（Square検索）とは別に、まだSquareに送っていない下書き同士の
  // SKU衝突もここで先に防ぐ。
  function checkMgmtNoAvailable(): boolean {
    if (isMgmtNoTaken(mgmtNo)) {
      setErrorMessage(`商品番号「${mgmtNo.trim()}」は既に商品一覧に存在します`);
      return false;
    }
    return true;
  }

  function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setErrorMessage(null);
    if (!checkMgmtNoAvailable()) return;
    const item = addItem({
      mgmtNo: mgmtNo.trim(),
      title: title.trim(),
      price: Number(price),
      photoPreviewUrl: photoPreviewUrl ?? undefined,
    });
    // 時間に余裕があるスタッフはそのまま詳細編集画面で続きを入力できるよう、一覧ではなく詳細へ遷移する。
    navigate(`/items/${item.id}`);
  }

  async function handleRegisterToSquare(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    if (!checkMgmtNoAvailable()) {
      setSubmitting(false);
      return;
    }

    const item = addItem({
      mgmtNo: mgmtNo.trim(),
      title: title.trim(),
      price: Number(price),
      photoPreviewUrl: photoPreviewUrl ?? undefined,
    });
    try {
      const response = await fetch(`${WORKER_BASE_URL}/api/items/${item.id}/register-to-square`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mgmtNo: item.mgmtNo,
          title: item.title,
          price: item.price,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { squareObjectId?: string; message?: string }
        | null;

      if (!response.ok || !result?.squareObjectId) {
        throw new Error(result?.message ?? "Squareへの登録に失敗しました");
      }

      updateItem(item.id, { squareObjectId: result.squareObjectId });
      navigate(`/items/${item.id}`);
    } catch (error) {
      // 商品自体はローカルに作成済みなので、失敗しても商品一覧からは見える。再登録は詳細編集画面の「Squareに登録」から。
      setErrorMessage(error instanceof Error ? error.message : "Squareへの登録に失敗しました");
      setSubmitting(false);
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function removePhoto() {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
  }

  return (
    <div className="screen">
      <div className="header">
        <Link to="/" className="back-link">
          ← 商品一覧に戻る
        </Link>
        <h1>クイック登録</h1>
        <p className="subtitle">商品番号・商品名・金額でSquareへ非公開登録します。写真は任意で追加できます。</p>
      </div>

      <form className="content" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="mgmtNo">商品番号（SKU）</label>
          <input
            id="mgmtNo"
            className="input"
            placeholder="例：01041"
            inputMode="numeric"
            value={mgmtNo}
            onChange={(e) => setMgmtNo(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="title">商品名</label>
          <input
            id="title"
            className="input"
            placeholder="例：ディズニー Tシャツ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="price">金額（円）</label>
          <input
            id="price"
            className="input"
            type="number"
            min={0}
            placeholder="例：3000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="quick-photo">写真（任意）</label>
          <input
            id="quick-photo"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handlePhotoChange}
          />
          {photoPreviewUrl ? (
            <div className="quick-photo-preview">
              <img src={photoPreviewUrl} alt="登録する写真" />
              <div className="quick-photo-actions">
                <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                  変更
                </button>
                <button type="button" className="btn" onClick={removePhoto}>
                  削除
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="photo-upload-btn" onClick={() => fileInputRef.current?.click()}>
              <span>＋</span>
              <span>写真を追加</span>
            </button>
          )}
        </div>
        <div className="footer-bar" style={{ padding: 0, border: "none" }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveDraft} disabled={!canSubmit}>
            下書き保存
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={handleRegisterToSquare} disabled={!canSubmit}>
            {submitting ? "登録中…" : "Squareに登録"}
          </button>
        </div>
        {errorMessage && <p className="form-error">{errorMessage}</p>}
        <p className="hint">
          対象（メンズ/レディース/ユニセックス）・カテゴリ・サイズ・写真・採寸・コンディションはあとから商品詳細編集画面で追加できます。
        </p>
      </form>
    </div>
  );
}
