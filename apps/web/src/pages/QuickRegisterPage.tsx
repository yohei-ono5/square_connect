import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useItems } from "../store/ItemsContext";

const WORKER_BASE_URL = (import.meta.env.VITE_WORKER_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");

export function QuickRegisterPage() {
  const { addItem, updateItem } = useItems();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = title.trim().length > 0 && price.trim().length > 0 && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);

    const item = addItem({ title: title.trim(), price: Number(price), photoPreviewUrl: photoPreviewUrl ?? undefined });
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
      navigate("/");
    } catch (error) {
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
          ← 下書き一覧に戻る
        </Link>
        <h1>クイック登録</h1>
        <p className="subtitle">商品名と金額でSquareへ非公開登録します。写真は任意で追加できます。</p>
      </div>

      <form className="content" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="title">商品名</label>
          <input
            id="title"
            className="input"
            placeholder="例：ディズニー Tシャツ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
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
        <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
          {submitting ? "登録中…" : "登録"}
        </button>
        {errorMessage && <p className="form-error">{errorMessage}</p>}
        <p className="hint">
          対象（メンズ/レディース/ユニセックス）・カテゴリ・サイズ・写真・採寸・コンディションはあとから商品詳細編集画面で追加できます。
        </p>
      </form>
    </div>
  );
}
