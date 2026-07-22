import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useItems } from "../store/ItemsContext";
import { WORKER_BASE_URL } from "../lib/config";
import { SQUARE_IMAGE_ACCEPT, validateSquareImage } from "../lib/itemRepository";

export function QuickRegisterPage() {
  const { addItem, discardItem, saveSquareRegistration, isMgmtNoTaken } = useItems();
  const navigate = useNavigate();
  const [mgmtNo, setMgmtNo] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = mgmtNo.trim().length > 0 && title.trim().length > 0 && price.trim().length > 0 && !submitting;

  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  // Square側の重複チェック（Square検索）とは別に、まだSquareに送っていない下書き同士の
  // SKU衝突もここで先に防ぐ。
  function checkMgmtNoAvailable(): boolean {
    if (isMgmtNoTaken(mgmtNo)) {
      setErrorMessage(`商品番号「${mgmtNo.trim()}」は既に商品一覧に存在します`);
      return false;
    }
    return true;
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    if (!checkMgmtNoAvailable()) {
      setSubmitting(false);
      return;
    }
    try {
      await addItem({
        mgmtNo: mgmtNo.trim(),
        title: title.trim(),
        price: Number(price),
        photoFile: photoFile ?? undefined,
      });
      navigate("/", { state: { notice: "下書きに保存しました", noticeType: "success" } });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "商品の保存に失敗しました");
      setSubmitting(false);
    }
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

    let temporaryItemId: string | null = null;
    let squareRegistered = false;
    try {
      // 先にSupabaseへ商品を作り、そのUUIDをSquare登録の冪等性キーに利用する。
      const item = await addItem({
        mgmtNo: mgmtNo.trim(),
        title: title.trim(),
        price: Number(price),
        photoFile: photoFile ?? undefined,
      });
      temporaryItemId = item.id;
      const response = await fetch(`${WORKER_BASE_URL}/api/items/${item.id}/register-to-square`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mgmtNo: item.mgmtNo,
          title: item.title,
          price: item.price,
          hasPhotos: photoFile !== null,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { squareObjectId?: string; squareVariationId?: string; message?: string; imageSyncWarning?: string }
        | null;

      if (!response.ok || !result?.squareObjectId || !result.squareVariationId) {
        throw new Error(result?.message ?? "Squareへの登録に失敗しました");
      }

      squareRegistered = true;
      await saveSquareRegistration(item.id, result.squareObjectId, result.squareVariationId);
      navigate("/", {
        state: {
          notice: result.imageSyncWarning ?? "Squareに登録しました",
          noticeType: result.imageSyncWarning ? "warning" : "success",
        },
      });
    } catch (error) {
      let message = error instanceof Error ? error.message : "Squareへの登録に失敗しました";
      if (temporaryItemId && !squareRegistered) {
        try {
          await discardItem(temporaryItemId);
        } catch (cleanupError) {
          console.error("Failed registration cleanup failed", cleanupError);
          message += "。一時データの削除にも失敗したため、商品一覧を確認してください";
        }
      } else if (squareRegistered) {
        message += "。Squareへの商品登録は成功していますが、Supabaseへの保存に失敗しました";
      }
      setErrorMessage(message);
      setSubmitting(false);
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validationMessage = validateSquareImage(file);
    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }
    setErrorMessage(null);
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function removePhoto() {
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
  }

  return (
    <div className="screen">
      <div className="header">
        <Link to="/" className="back-link">
          ← 商品一覧に戻る
        </Link>
        <h1>クイック登録</h1>
        <p className="subtitle">商品番号・商品名・金額でSquareへ登録します。写真は任意で追加できます。</p>
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
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="例：3000"
            value={price}
            onChange={(e) => {
              if (/^\d*$/.test(e.target.value)) setPrice(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="quick-photo">写真（任意）</label>
          <input
            id="quick-photo"
            ref={fileInputRef}
            type="file"
            accept={SQUARE_IMAGE_ACCEPT}
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
          写真はJPEG・PJPEG・PNG・GIF（15MB以下）に対応しています。対象（メンズ/レディース/ユニセックス）・カテゴリ・サイズ・採寸・コンディションはあとから商品詳細編集画面で追加できます。
        </p>
      </form>
    </div>
  );
}
