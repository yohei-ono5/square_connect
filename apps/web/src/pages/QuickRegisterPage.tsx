import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useItems } from "../store/ItemsContext";
import { WORKER_BASE_URL } from "../lib/config";
import { SQUARE_IMAGE_ACCEPT, validateSquareImage } from "../lib/itemRepository";
import {
  sortCategoriesForRegistration,
  sortParentCategoriesForRegistration,
} from "../lib/categorySorting";
import {
  AppError,
  codedUserMessage,
  toUserErrorMessage,
} from "../lib/appError";

export function QuickRegisterPage() {
  const {
    addItem,
    discardItem,
    saveSquareRegistration,
    isMgmtNoTaken,
    items,
    squareCategories,
    categoriesLoading,
    categoriesError,
    loadSquareCategories,
  } = useItems();
  const navigate = useNavigate();
  const [mgmtNo, setMgmtNo] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [parentCategoryName, setParentCategoryName] = useState("");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parentCategories = useMemo(
    () => sortParentCategoriesForRegistration(squareCategories ?? [], items),
    [items, squareCategories],
  );
  const childCategories = useMemo(
    () => sortCategoriesForRegistration(
      (squareCategories ?? []).filter((candidate) => candidate.parentName === parentCategoryName),
      items,
    ),
    [items, parentCategoryName, squareCategories],
  );

  const canSubmit = mgmtNo.trim().length > 0 && title.trim().length > 0 && price.trim().length > 0 && !submitting;
  const photoPreviewUrls = useMemo(
    () => photoFiles.map((file) => URL.createObjectURL(file)),
    [photoFiles],
  );

  useEffect(() => () => {
    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [photoPreviewUrls]);

  useEffect(() => {
    loadSquareCategories();
  }, [loadSquareCategories]);

  // Square側の重複チェック（Square検索）とは別に、まだSquareに送っていない下書き同士の
  // SKU衝突もここで先に防ぐ。
  function checkMgmtNoAvailable(): boolean {
    if (isMgmtNoTaken(mgmtNo)) {
      setErrorMessage(codedUserMessage("ITEM_SKU_DUPLICATE"));
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
        category: category || null,
        categoryId: categoryId || null,
        photoFiles,
      });
      navigate("/", { state: { notice: "下書きに保存しました", noticeType: "success" } });
    } catch (error) {
      setErrorMessage(toUserErrorMessage(error, "ITEM_SAVE"));
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
        category: category || null,
        categoryId: categoryId || null,
        photoFiles,
      });
      temporaryItemId = item.id;
      const response = await fetch(`${WORKER_BASE_URL}/api/items/${item.id}/register-to-square`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mgmtNo: item.mgmtNo,
          title: item.title,
          price: item.price,
          categoryId: categoryId || undefined,
          reportingCategoryId: parentCategories.find(
            (parent) => parent.name === parentCategoryName,
          )?.id,
          hasPhotos: photoFiles.length > 0,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            squareObjectId?: string;
            squareVariationId?: string;
            error?: string;
            message?: string;
            imageSyncWarning?: string;
          }
        | null;

      if (!response.ok || !result?.squareObjectId || !result.squareVariationId) {
        if (result?.error === "sku_already_exists") {
          throw new AppError("ITEM_SKU_DUPLICATE", result);
        }
        throw new AppError("SQUARE_REGISTER", result, result?.message);
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
      let message = toUserErrorMessage(error, "SQUARE_REGISTER");
      if (temporaryItemId && !squareRegistered) {
        try {
          await discardItem(temporaryItemId);
        } catch (cleanupError) {
          console.error("Failed registration cleanup failed", cleanupError);
          message += "\n一時データの削除にも失敗したため、商品一覧を確認してください。";
        }
      } else if (squareRegistered) {
        message += "\nSquareへの商品登録は成功していますが、保存処理に失敗しました。商品一覧を確認してください。";
      }
      setErrorMessage(message);
      setSubmitting(false);
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    for (const file of files) {
      const validationMessage = validateSquareImage(file);
      if (validationMessage) {
        setErrorMessage(`${file.name}：${validationMessage}`);
        return;
      }
    }
    setErrorMessage(null);
    setPhotoFiles((current) => [...current, ...files]);
  }

  function removePhoto(index: number) {
    setPhotoFiles((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }

  function handleParentCategoryChange(nextParentName: string) {
    const nextParent = parentCategories.find((parent) => parent.name === nextParentName);
    setParentCategoryName(nextParentName);
    setCategory(nextParentName);
    setCategoryId(nextParent?.id ?? "");
  }

  function handleChildCategoryChange(nextCategoryId: string) {
    const nextCategory = [
      parentCategories.find((parent) => parent.name === parentCategoryName),
      ...childCategories,
    ].find((candidate) => candidate?.id === nextCategoryId);
    setCategoryId(nextCategoryId);
    if (nextCategory) {
      setCategory(nextCategory.name);
      return;
    }
    setCategory("");
  }

  return (
    <div className="screen">
      <div className="header">
        <Link to="/" className="back-link">
          ← 商品一覧に戻る
        </Link>
        <h1>クイック登録</h1>
        <p className="subtitle">必須項目を入力して、下書き保存またはSquareへ登録します。</p>
      </div>

      <form className="content" onSubmit={(e) => e.preventDefault()}>
        <section className="quick-section">
          <div className="quick-section-heading">
            <h2>必須項目</h2>
          </div>
          <div className="field">
            <label htmlFor="mgmtNo">商品番号（SKU）</label>
            <input
              id="mgmtNo"
              className="input"
              placeholder="例：01041"
              inputMode="numeric"
              value={mgmtNo}
              onChange={(e) => setMgmtNo(e.target.value)}
              required
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
              required
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
              required
            />
          </div>
        </section>

        <section className="quick-section">
          <div className="quick-section-heading">
            <h2>任意項目</h2>
          </div>
          <div className="field">
            <label htmlFor="quick-parent-category">大カテゴリ</label>
            <select
              id="quick-parent-category"
              className="select"
              value={parentCategoryName}
              onChange={(e) => handleParentCategoryChange(e.target.value)}
              disabled={categoriesLoading}
            >
              <option value="">未設定</option>
              {parentCategories.map((parent) => (
                <option key={parent.id} value={parent.name}>
                  {parent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="quick-child-category">中カテゴリ</label>
            <select
              id="quick-child-category"
              className="select"
              value={categoryId}
              onChange={(e) => handleChildCategoryChange(e.target.value)}
              disabled={categoriesLoading || !parentCategoryName || childCategories.length === 0}
            >
              {!parentCategoryName && <option value="">先に大カテゴリを選択</option>}
              {parentCategoryName && (
                <option value={parentCategories.find((parent) => parent.name === parentCategoryName)?.id ?? ""}>
                  {childCategories.length === 0
                    ? "中カテゴリなし"
                    : `指定なし（${parentCategoryName}のみ）`}
                </option>
              )}
              {childCategories.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </select>
            {categoriesLoading && <p className="hint">Squareのカテゴリを取得中…</p>}
            {categoriesError && <p className="form-error">{categoriesError}</p>}
            {squareCategories?.length === 0 && !categoriesLoading && !categoriesError && (
              <p className="hint">Squareにカテゴリが登録されていません</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="quick-photo">写真</label>
            <input
              id="quick-photo"
              ref={fileInputRef}
              type="file"
              accept={SQUARE_IMAGE_ACCEPT}
              multiple
              style={{ display: "none" }}
              onChange={handlePhotoChange}
            />
            <div className="photo-grid">
              {photoPreviewUrls.map((previewUrl, index) => (
                <div key={previewUrl} className="photo-slot filled">
                  <img src={previewUrl} alt={index === 0 ? "メイン写真" : `追加写真 ${index + 1}`} />
                  {index === 0 && <span className="photo-slot-label">メイン</span>}
                  <button
                    type="button"
                    className="btn quick-photo-remove"
                    onClick={() => removePhoto(index)}
                    aria-label={`${index === 0 ? "メイン写真" : `追加写真 ${index + 1}`}を削除`}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button type="button" className="photo-slot empty" onClick={() => fileInputRef.current?.click()}>
                <span>＋</span>
                <span className="quick-photo-add-label">
                  {photoFiles.length === 0 ? "写真を選択" : "写真を追加"}
                </span>
              </button>
            </div>
            <p className="hint">
              1枚目がメイン写真になります。JPEG・PJPEG・PNG・GIF（各15MB以下）に対応しています。
            </p>
          </div>
        </section>
        <div className="footer-bar" style={{ padding: 0, border: "none" }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveDraft} disabled={!canSubmit}>
            下書き保存
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={handleRegisterToSquare} disabled={!canSubmit}>
            {submitting ? "登録中…" : "Squareに登録"}
          </button>
        </div>
        {errorMessage && <p className="form-error">{errorMessage}</p>}
      </form>
    </div>
  );
}
