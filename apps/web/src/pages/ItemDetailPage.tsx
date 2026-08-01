import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { CONDITION_LABELS, GENDER_LABELS, buildDescription, type Condition, type Gender } from "@square-connect/shared";
import {
  calculateMeasurements,
  detectInitialMeasurePoints,
  DEFAULT_MEASURE_POINTS,
  type MeasurePointKey,
  type MeasurePoints,
} from "@square-connect/measure";
import { useItems, type MockItem, type PhotoRole } from "../store/ItemsContext";
import { getSquareSyncStatus, SquareCheckedAt, StatusBadge } from "../components/StatusBadge";
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

type TabKey = "photo" | "measure" | "basic" | "desc";
const STANDARD_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "FREE"] as const;
const CUSTOM_SIZE_VALUE = "__custom__";
const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "基本情報" },
  { key: "photo", label: "写真" },
  { key: "measure", label: "採寸" },
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

type MeasureLineKey = "length" | "chest" | "shoulder" | "sleeve";

// index.css の .measure-line.{key} と同じ色。テーブルの色見本・画像上のラベルの両方から参照する。
const MEASURE_LINE_COLORS: Record<MeasureLineKey, string> = {
  length: "#4f9a4a",
  chest: "#d6a21f",
  shoulder: "#ce3b2b",
  sleeve: "#d57a2b",
};

const MEASURE_ROWS: { label: string; key: "lengthCm" | "chestCm" | "shoulderCm" | "sleeveCm"; lineKey: MeasureLineKey }[] = [
  { label: "着丈", key: "lengthCm", lineKey: "length" },
  { label: "身幅", key: "chestCm", lineKey: "chest" },
  { label: "肩幅", key: "shoulderCm", lineKey: "shoulder" },
  { label: "袖丈", key: "sleeveCm", lineKey: "sleeve" },
];
type MeasurementKey = (typeof MEASURE_ROWS)[number]["key"];
type AutoMeasureResult = {
  points: MeasurePoints;
  measurements: ReturnType<typeof calculateMeasurements>;
  detected: boolean;
};

function editableItemSignature(item: MockItem): string {
  return JSON.stringify({
    mgmtNo: item.mgmtNo,
    title: item.title,
    price: item.price,
    inventoryCount: item.inventoryCount,
    gender: item.gender,
    category: item.category,
    categoryId: item.categoryId,
    size: item.size,
    condition: item.condition,
    measurements: item.measurements,
    description: item.description,
  });
}

type EditableItemPatch = Pick<
  MockItem,
  | "mgmtNo"
  | "title"
  | "price"
  | "inventoryCount"
  | "gender"
  | "category"
  | "categoryId"
  | "size"
  | "condition"
  | "measurements"
  | "description"
  | "measurePoints"
>;

function editableItemPatch(item: MockItem): EditableItemPatch {
  return {
    mgmtNo: item.mgmtNo,
    title: item.title,
    price: item.price,
    inventoryCount: item.inventoryCount,
    gender: item.gender,
    category: item.category,
    categoryId: item.categoryId,
    size: item.size,
    condition: item.condition,
    measurements: item.measurements ? { ...item.measurements } : null,
    description: item.description,
    measurePoints: item.measurePoints
      ? Object.fromEntries(
          Object.entries(item.measurePoints).map(([key, point]) => [key, { ...point }]),
        ) as MeasurePoints
      : undefined,
  };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigationNotice = (location.state as { notice?: string } | null)?.notice;
  const {
    getItem,
    itemsLoading,
    itemsError,
    updateItem,
    saveItem,
    saveSquareRegistration,
    syncPhotosToSquare,
    refreshItemFromSquare,
    markSquareSynced,
    addPhoto,
    isMgmtNoTaken,
    items,
    squareCategories,
    categoriesLoading,
    categoriesError,
    loadSquareCategories,
  } = useItems();
  const item = id ? getItem(id) : undefined;
  const squareSyncStatus = item ? getSquareSyncStatus(item) : null;
  const [tab, setTab] = useState<TabKey>("basic");
  const [pendingRole, setPendingRole] = useState<PhotoRole | null>(null);
  const [activePoint, setActivePoint] = useState<MeasurePointKey | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [detected, setDetected] = useState<boolean | null>(null);
  const [autoMeasureResult, setAutoMeasureResult] = useState<AutoMeasureResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<"draft" | "square" | null>(null);
  const [refreshingSquare, setRefreshingSquare] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [pendingPhotoDeletionIds, setPendingPhotoDeletionIds] = useState<string[]>([]);
  const [photoDeleteCandidateId, setPhotoDeleteCandidateId] = useState<string | null>(null);
  const [descriptionCopyState, setDescriptionCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [customSizeSelected, setCustomSizeSelected] = useState(false);
  const [savedBaseline, setSavedBaseline] = useState<{
    itemId: string;
    signature: string;
    photoDeletionSignature: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const automaticSquareRefreshRef = useRef<{ squareObjectId: string; requestedAt: number } | null>(null);
  const updateItemRef = useRef(updateItem);
  const persistedEditableItemRef = useRef<{ itemId: string; patch: EditableItemPatch } | null>(null);
  const saving = savingAction !== null;
  const persistedPhotoDeletionSignature = item
    ? item.photos.filter((photo) => photo.pendingDelete).map((photo) => photo.id).sort().join(",")
    : "";
  const photoDeletionDraftSignature = [...pendingPhotoDeletionIds].sort().join(",");
  const hasLocalPhotoDeletionChanges =
    Boolean(item) && persistedPhotoDeletionSignature !== photoDeletionDraftSignature;
  const parentCategories = useMemo(
    () => sortParentCategoriesForRegistration(squareCategories ?? [], items),
    [items, squareCategories],
  );
  const selectedSquareCategory = useMemo(() => {
    if (!item || !squareCategories) return undefined;
    if (item.categoryId) {
      return squareCategories.find((category) => category.id === item.categoryId);
    }
    if (!item.category) return undefined;
    const nameMatches = squareCategories.filter((category) => category.name === item.category);
    return nameMatches.length === 1 ? nameMatches[0] : undefined;
  }, [item?.category, item?.categoryId, squareCategories]);
  const selectedParentCategory = useMemo(() => {
    if (!selectedSquareCategory) return undefined;
    const parentName = selectedSquareCategory.parentName ?? selectedSquareCategory.name;
    return parentCategories.find((category) => category.name === parentName);
  }, [parentCategories, selectedSquareCategory]);
  const childCategories = useMemo(
    () => sortCategoriesForRegistration(
      (squareCategories ?? []).filter(
        (category) => category.parentName === selectedParentCategory?.name,
      ),
      items,
    ),
    [items, selectedParentCategory?.name, squareCategories],
  );

  useEffect(() => {
    loadSquareCategories();
  }, [loadSquareCategories]);

  useEffect(() => {
    updateItemRef.current = updateItem;
  }, [updateItem]);

  // 旧データはカテゴリ名だけを保持している。名前が一意にSquareカテゴリへ
  // 対応するときだけIDを補完し、「その他」のような同名カテゴリは自動推測しない。
  useEffect(() => {
    if (!id || !item || item.categoryId || !selectedSquareCategory) return;
    updateItem(id, { categoryId: selectedSquareCategory.id });
  }, [id, item, selectedSquareCategory, updateItem]);

  useEffect(() => {
    if (!item) {
      setSavedBaseline(null);
      return;
    }
    persistedEditableItemRef.current = {
      itemId: item.id,
      patch: editableItemPatch(item),
    };
    setSavedBaseline({
      itemId: item.id,
      signature: editableItemSignature(item),
      photoDeletionSignature: item.photos
        .filter((photo) => photo.pendingDelete)
        .map((photo) => photo.id)
        .sort()
        .join(","),
    });
    // 入力中はupdatedAtが変わらず、保存またはSquareから再取得した時だけ基準を更新する。
  }, [item?.id, item?.updatedAt]);

  // 入力中の値は共有の商品一覧stateにも反映されるため、保存せずに詳細画面を
  // 離れた場合は、最後に保存または取得できた値へ戻す。
  useEffect(() => () => {
    const persistedItem = persistedEditableItemRef.current;
    if (!id || persistedItem?.itemId !== id) return;
    updateItemRef.current(id, persistedItem.patch);
  }, [id]);

  useEffect(() => {
    setCustomSizeSelected(false);
    setPendingPhotoDeletionIds(
      item?.photos.filter((photo) => photo.pendingDelete).map((photo) => photo.id) ?? [],
    );
    setPhotoDeleteCandidateId(null);
  }, [item?.id]);

  useEffect(() => {
    const squareObjectId = item?.squareObjectId;
    if (
      !id
      || !squareObjectId
      || squareSyncStatus !== "reflected"
      || hasLocalPhotoDeletionChanges
    ) return;

    const refreshIfStale = () => {
      if (document.visibilityState === "hidden" || refreshingSquare) return;
      const lastRequest = automaticSquareRefreshRef.current;
      if (
        lastRequest?.squareObjectId === squareObjectId &&
        Date.now() - lastRequest.requestedAt < 30_000
      ) return;

      automaticSquareRefreshRef.current = { squareObjectId, requestedAt: Date.now() };
      setRefreshingSquare(true);
      refreshItemFromSquare(id)
        .catch((error: unknown) => {
          // 自動確認の一時的な失敗では、最後に取得できた商品情報と確認日時を
          // そのまま表示する。エンドユーザーには通知せず、開発者向けログだけを残す。
          toUserErrorMessage(error, "SQUARE_ITEM_REFRESH");
        })
        .finally(() => setRefreshingSquare(false));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };

    refreshIfStale();
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    id,
    item?.squareObjectId,
    squareSyncStatus,
    refreshItemFromSquare,
    refreshingSquare,
    hasLocalPhotoDeletionChanges,
  ]);

  if (!item && itemsLoading) {
    return (
      <div className="screen">
        <div className="content">
          <p style={{ color: "var(--text-secondary)" }}>商品を読み込んでいます…</p>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="screen">
        <div className="header">
          <Link to="/" className="back-link">
            ← 商品一覧に戻る
          </Link>
          <h1>商品が見つかりません</h1>
          {itemsError && <p className="form-error">{itemsError}</p>}
        </div>
      </div>
    );
  }
  const currentItem = item;
  const sizeSelectValue = customSizeSelected
    ? CUSTOM_SIZE_VALUE
    : currentItem.size === null
      ? ""
      : STANDARD_SIZE_OPTIONS.includes(currentItem.size as (typeof STANDARD_SIZE_OPTIONS)[number])
        ? currentItem.size
        : CUSTOM_SIZE_VALUE;
  const hasUnsavedChanges =
    savedBaseline?.itemId === currentItem.id &&
    (
      savedBaseline.signature !== editableItemSignature(currentItem)
      || savedBaseline.photoDeletionSignature !== photoDeletionDraftSignature
    );
  const hasPendingSquareChanges =
    currentItem.squareObjectId === null ||
    hasUnsavedChanges ||
    squareSyncStatus === "pending";

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  }

  async function handleRefreshFromSquare() {
    if (!id || saving || refreshingSquare || !currentItem.squareObjectId) return;
    setRefreshingSquare(true);
    setSaveError(null);
    try {
      await refreshItemFromSquare(id);
      showToast("Squareの最新情報を取得しました");
    } catch (error) {
      setSaveError(toUserErrorMessage(error, "SQUARE_ITEM_REFRESH"));
    } finally {
      setRefreshingSquare(false);
    }
  }

  async function handleSaveDraft() {
    if (!id || saving || refreshingSquare || mgmtNoConflict || !hasUnsavedChanges) return;
    setSavingAction("draft");
    setSaveError(null);
    try {
      await saveItem(id, pendingPhotoDeletionIds);
      persistedEditableItemRef.current = {
        itemId: id,
        patch: editableItemPatch(currentItem),
      };
      showToast("下書きを保存しました。Squareには反映されていません");
    } catch (error) {
      setSaveError(toUserErrorMessage(error, "ITEM_SAVE"));
    } finally {
      setSavingAction(null);
    }
  }

  async function handleSaveToSquare() {
    if (!id || saving || refreshingSquare || mgmtNoConflict || !hasPendingSquareChanges) return;
    setSavingAction("square");
    setSaveError(null);
    try {
      const squareDescription = buildDescription(currentItem);
      await saveItem(id, pendingPhotoDeletionIds);
      if (currentItem.squareObjectId) {
        const response = await fetch(`${WORKER_BASE_URL}/api/items/${id}/square`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            squareObjectId: currentItem.squareObjectId,
            mgmtNo: currentItem.mgmtNo,
            title: currentItem.title,
            price: currentItem.price,
            inventoryCount: currentItem.inventoryCount,
            categoryId: currentItem.categoryId,
            reportingCategoryId: selectedParentCategory?.id ?? null,
            description: squareDescription,
          }),
        });
        const result = (await response.json().catch(() => null)) as { message?: string } | null;
        if (!response.ok) throw new AppError("SQUARE_UPDATE", result, result?.message);
        const photoResult = await syncPhotosToSquare(id);
        await markSquareSynced(id, squareDescription);
        persistedEditableItemRef.current = {
          itemId: id,
          patch: editableItemPatch({ ...currentItem, description: squareDescription }),
        };
        setPendingPhotoDeletionIds([]);
        setSavedBaseline({
          itemId: id,
          signature: editableItemSignature({ ...currentItem, description: squareDescription }),
          photoDeletionSignature: "",
        });
        if (photoResult.deleted > 0 && photoResult.synced > 0) {
          showToast(`写真${photoResult.synced}枚を追加し、${photoResult.deleted}枚をSquareから削除しました`);
        } else if (photoResult.deleted > 0) {
          showToast(`写真${photoResult.deleted}枚をSquareから削除しました`);
        } else if (photoResult.synced > 0) {
          showToast(`写真${photoResult.synced}枚を含めてSquareを更新しました`);
        } else {
          showToast("Squareを更新しました");
        }
      } else {
        const activePhotoCount = currentItem.photos.filter(
          (photo) => !pendingPhotoDeletionIds.includes(photo.id),
        ).length;
        const response = await fetch(`${WORKER_BASE_URL}/api/items/${id}/register-to-square`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mgmtNo: currentItem.mgmtNo,
            title: currentItem.title,
            price: currentItem.price,
            inventoryCount: currentItem.inventoryCount,
            description: squareDescription,
            categoryId: currentItem.categoryId,
            reportingCategoryId: selectedParentCategory?.id ?? null,
            hasPhotos: activePhotoCount > 0,
          }),
        });
        const result = (await response.json().catch(() => null)) as
          | {
              squareObjectId?: string;
              squareVariationId?: string;
              error?: string;
              message?: string;
              imageSyncWarning?: string;
              inventorySyncWarning?: string;
            }
          | null;
        if (!response.ok || !result?.squareObjectId || !result.squareVariationId) {
          if (result?.error === "sku_already_exists") {
            throw new AppError("ITEM_SKU_DUPLICATE", result);
          }
          throw new AppError("SQUARE_REGISTER", result, result?.message);
        }
        await saveSquareRegistration(
          id,
          result.squareObjectId,
          result.squareVariationId,
          squareDescription,
        );
        persistedEditableItemRef.current = {
          itemId: id,
          patch: editableItemPatch({ ...currentItem, description: squareDescription }),
        };
        setPendingPhotoDeletionIds([]);
        const warnings = [result.inventorySyncWarning, result.imageSyncWarning].filter(Boolean);
        showToast(warnings.length > 0
          ? warnings.join("\n")
          : activePhotoCount > 0
            ? "商品と写真をSquareへ登録し、Supabaseへ保存しました"
            : "商品をSquareへ登録し、Supabaseへ保存しました");
      }
    } catch (error) {
      setSaveError(toUserErrorMessage(
        error,
        currentItem.squareObjectId ? "SQUARE_UPDATE" : "SQUARE_REGISTER",
      ));
    } finally {
      setSavingAction(null);
    }
  }

  function openPicker(role: PhotoRole) {
    setPendingRole(role);
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const role = pendingRole;
    setPendingRole(null);
    if (!file || !role || !id) return;
    const validationMessage = validateSquareImage(file);
    if (validationMessage) {
      setPhotoError(validationMessage);
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await addPhoto(id, role, file);
    } catch (error) {
      setPhotoError(toUserErrorMessage(error, "PHOTO_SAVE"));
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleRemovePhoto(photoId: string) {
    if (photoBusy) return;
    if (pendingPhotoDeletionIds.includes(photoId)) {
      setPendingPhotoDeletionIds((current) => current.filter((candidate) => candidate !== photoId));
      return;
    }
    setPhotoDeleteCandidateId(photoId);
  }

  function confirmPhotoDeletion() {
    if (!photoDeleteCandidateId) return;
    setPendingPhotoDeletionIds((current) =>
      current.includes(photoDeleteCandidateId) ? current : [...current, photoDeleteCandidateId],
    );
    setPhotoDeleteCandidateId(null);
  }

  async function runAutoMeasure() {
    if (!id || !mainPhoto) return;
    setMeasuring(true);
    try {
      const { points, detected: matched } = await detectInitialMeasurePoints(mainPhoto.previewUrl);
      setAutoMeasureResult({ points, measurements: calculateMeasurements(points), detected: matched });
    } finally {
      setMeasuring(false);
    }
  }

  function applyAutoMeasure() {
    if (!id || !autoMeasureResult) return;
    updateItem(id, {
      measurePoints: autoMeasureResult.points,
      measurements: autoMeasureResult.measurements,
    });
    setDetected(autoMeasureResult.detected);
    setAutoMeasureResult(null);
  }

  function updateManualMeasurement(key: MeasurementKey, rawValue: string) {
    if (!id) return;
    const currentMeasurements = currentItem.measurements ?? {
      shoulderCm: null,
      chestCm: null,
      lengthCm: null,
      sleeveCm: null,
    };
    if (rawValue === "") {
      updateItem(id, { measurements: { ...currentMeasurements, [key]: null } });
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 300) return;
    updateItem(id, { measurements: { ...currentMeasurements, [key]: value } });
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

  async function handleCopyDescription() {
    const description = buildDescription(currentItem);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(description);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = description;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Copy command failed");
      }
      setDescriptionCopyState("copied");
    } catch {
      setDescriptionCopyState("error");
    }
    window.setTimeout(() => setDescriptionCopyState("idle"), 2000);
  }

  const mgmtNoConflict = item.mgmtNo.trim().length > 0 && isMgmtNoTaken(item.mgmtNo, item.id);
  const mainPhoto = item.photos.find((p) => p.role === "main");
  const subPhotos = item.photos.filter((p) => p.role === "sub");
  const measurePoints = item.measurePoints ?? DEFAULT_MEASURE_POINTS;

  // 各線の中点。ラベルはSVG内ではなくHTML要素として重ねる
  // （viewBoxをpreserveAspectRatio="none"で非一様に拡大するため、SVG text だと文字が歪む）。
  const lineMidpoints: Record<MeasureLineKey, { x: number; y: number }> = {
    shoulder: midpoint(measurePoints.shoulderL, measurePoints.shoulderR),
    chest: midpoint(measurePoints.pitL, measurePoints.pitR),
    length: midpoint(measurePoints.collar, measurePoints.hem),
    sleeve: midpoint(measurePoints.shoulderL, measurePoints.cuffL),
  };

  return (
    <div className="screen">
      <input type="file" accept={SQUARE_IMAGE_ACCEPT} ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />

      <div className="header">
        <Link to="/" className="back-link">
          ← 商品一覧に戻る
        </Link>
        <div className="item-detail-header-row">
          <div className="item-detail-title">
            <p style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>{item.title || "（商品名未設定）"}</p>
            <SquareCheckedAt item={item} className="item-detail-checked-at" />
          </div>
          <div className="item-detail-square-actions">
            <StatusBadge item={item} showCheckedAt={false} />
            {item.squareObjectId && (
              <button
                type="button"
                className="btn"
                style={{ minHeight: 30, padding: "4px 8px", fontSize: 12 }}
                onClick={handleRefreshFromSquare}
                disabled={saving || refreshingSquare}
              >
                {refreshingSquare ? "取得中…" : "Squareの最新情報を取得"}
              </button>
            )}
          </div>
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
              <div className={`photo-slot filled ${pendingPhotoDeletionIds.includes(mainPhoto.id) ? "pending-delete" : ""}`}>
                <img src={mainPhoto.previewUrl} alt="正面" />
                <span className="photo-slot-label">正面</span>
                {pendingPhotoDeletionIds.includes(mainPhoto.id) && (
                  <span className="photo-delete-status">削除予定</span>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 12 }}
                  onClick={() => handleRemovePhoto(mainPhoto.id)}
                  disabled={photoBusy}
                >
                  {pendingPhotoDeletionIds.includes(mainPhoto.id) ? "元に戻す" : "削除"}
                </button>
              </div>
            ) : (
              <button type="button" className="photo-slot empty" onClick={() => openPicker("main")} disabled={photoBusy}>
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
              <div
                key={photo.id}
                className={`photo-slot filled ${pendingPhotoDeletionIds.includes(photo.id) ? "pending-delete" : ""}`}
              >
                <img src={photo.previewUrl} alt="追加写真" />
                {pendingPhotoDeletionIds.includes(photo.id) && (
                  <span className="photo-delete-status">削除予定</span>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ position: "absolute", top: 6, right: 6, padding: "2px 8px", fontSize: 12 }}
                  onClick={() => handleRemovePhoto(photo.id)}
                  disabled={photoBusy}
                >
                  {pendingPhotoDeletionIds.includes(photo.id) ? "元に戻す" : "削除"}
                </button>
              </div>
            ))}
            <button type="button" className="photo-slot empty" onClick={() => openPicker("sub")} disabled={photoBusy}>
              <span>＋</span>
              <span style={{ fontSize: 12 }}>写真を追加</span>
            </button>
          </div>
          <p className="hint">
            背面・タグ・襟元・ダメージなど、決まったカテゴリはありません。JPEG・PJPEG・PNG・GIF（各15MB以下）を保存できます。写真は0枚でも保存できます。
          </p>
          {pendingPhotoDeletionIds.length > 0 && (
            <p className="photo-delete-hint">
              削除予定の写真はまだ削除されていません。下書き保存後もSquareと画像原本には残り、
              「Squareを更新」を押した時にSquareへ反映されます。
            </p>
          )}
          {photoBusy && <p className="hint">写真を保存しています…</p>}
          {photoError && <p className="form-error">{photoError}</p>}
        </div>
      )}

      {tab === "measure" && (
        <div className="content">
          <p className="field-heading">手動入力</p>
          <p className="hint" style={{ marginTop: 0 }}>
            写真がなくても入力・保存できます。測っていない項目は空欄のままで構いません。
          </p>
          <table className="measure-table manual-measure-table">
            <tbody>
              {MEASURE_ROWS.map(({ label, key, lineKey }) => (
                <tr key={key}>
                  <td style={{ color: "var(--text-secondary)" }}>
                    <span
                      className="measure-color-dot"
                      style={{ background: MEASURE_LINE_COLORS[lineKey] }}
                      aria-hidden="true"
                    />
                    <label htmlFor={`measurement-${key}`}>{label}</label>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      id={`measurement-${key}`}
                      className="input"
                      style={{ width: 100, textAlign: "right", display: "inline-block" }}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="300"
                      step="0.1"
                      value={currentItem.measurements?.[key] ?? ""}
                      onChange={(event) => updateManualMeasurement(key, event.target.value)}
                    />{" "}
                    cm
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">0〜300cmの範囲で、0.1cm単位まで入力できます。</p>

          <div className="measure-section-divider" />
          <p className="field-heading">写真から自動入力（試験機能）</p>
          {!mainPhoto ? (
            <p className="hint" style={{ margin: 0 }}>
              自動入力を試す場合は正面写真が必要です。手動入力だけで保存することもできます。
              <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setTab("photo")}>
                写真タブへ
              </button>
            </p>
          ) : (
            <>
              <div className="measure-card">
                <img src={mainPhoto.previewUrl} alt="正面" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, margin: 0 }}>
                    {measuring ? "検出中…" : autoMeasureResult ? "自動入力の候補を作成しました" : "写真から採寸候補を作成します"}
                  </p>
                  <p className="hint" style={{ margin: "2px 0 0" }}>
                    候補は確認してから手動入力欄へ反映します
                  </p>
                </div>
                <button type="button" className="btn" onClick={runAutoMeasure} disabled={measuring}>
                  {autoMeasureResult || currentItem.measurePoints ? "再検出" : "自動検出"}
                </button>
              </div>

              {autoMeasureResult && (
                <div className="measure-suggestion">
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {autoMeasureResult.detected
                      ? "Tシャツを検出しました。数値を確認してください。"
                      : "Tシャツを検出できなかったため、中央に仮配置した参考値です。"}
                  </p>
                  <div className="measure-suggestion-values">
                    {MEASURE_ROWS.map(({ label, key }) => (
                      <span key={key}>{label} {autoMeasureResult.measurements[key]}cm</span>
                    ))}
                  </div>
                  <button type="button" className="btn btn-primary" onClick={applyAutoMeasure}>
                    この値を手動入力欄へ反映
                  </button>
                </div>
              )}

              {currentItem.measurePoints && (
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
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setActivePoint(key);
                        updateMeasurePoint(
                          key,
                          event.clientX,
                          event.clientY,
                          event.currentTarget.closest(".measure-stage") as HTMLDivElement,
                        );
                      }}
                      onPointerMove={(event) => {
                        if (activePoint !== key) return;
                        updateMeasurePoint(
                          key,
                          event.clientX,
                          event.clientY,
                          event.currentTarget.closest(".measure-stage") as HTMLDivElement,
                        );
                      }}
                      onPointerUp={endPointDrag}
                      onPointerCancel={endPointDrag}
                    />
                  ))}
                  {MEASURE_ROWS.map(({ label, lineKey }) => (
                    <span
                      key={lineKey}
                      className="measure-line-label"
                      style={{
                        left: `${lineMidpoints[lineKey].x}%`,
                        top: `${lineMidpoints[lineKey].y}%`,
                        color: MEASURE_LINE_COLORS[lineKey],
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <p className="hint">
                自動入力は参考値です。反映後も手動入力欄の修正を優先してください。
                {detected !== null && (detected ? " 写真上の点も調整できます。" : " 検出できなかった場合は手動入力を使用してください。")}
              </p>
            </>
          )}
        </div>
      )}

      {tab === "basic" && (
        <div className="content">
          <section className="basic-section">
            <h2>Square連携項目（Squareに直接反映されます）</h2>
            <div className="field">
              <label htmlFor="mgmtNo">商品番号（SKU）</label>
              <input
                id="mgmtNo"
                className="input"
                inputMode="numeric"
                value={item.mgmtNo}
                onChange={(e) => updateItem(id!, { mgmtNo: e.target.value })}
              />
              {mgmtNoConflict && (
                <p className="form-error">{codedUserMessage("ITEM_SKU_DUPLICATE")}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="itemTitle">商品名</label>
              <input
                id="itemTitle"
                className="input"
                value={item.title}
                onChange={(e) => updateItem(id!, { title: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="parent-category">大カテゴリ</label>
              <select
                id="parent-category"
                className="select"
                value={selectedParentCategory?.id ?? ""}
                onChange={(e) => {
                  const parent = parentCategories.find((category) => category.id === e.target.value);
                  updateItem(id!, {
                    category: parent?.name ?? null,
                    categoryId: parent?.id ?? null,
                  });
                }}
                disabled={categoriesLoading}
              >
                <option value="">未設定</option>
                {parentCategories.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="child-category">中カテゴリ</label>
              <select
                id="child-category"
                className="select"
                value={selectedSquareCategory?.id ?? selectedParentCategory?.id ?? ""}
                onChange={(e) => {
                  const category = [
                    selectedParentCategory,
                    ...childCategories,
                  ].find((candidate) => candidate?.id === e.target.value);
                  if (category) {
                    updateItem(id!, { category: category.name, categoryId: category.id });
                  }
                }}
                disabled={categoriesLoading || !selectedParentCategory || childCategories.length === 0}
              >
                {!selectedParentCategory && <option value="">先に大カテゴリを選択</option>}
                {selectedParentCategory && (
                  <option value={selectedParentCategory.id}>
                    {childCategories.length === 0
                      ? "中カテゴリなし"
                      : `指定なし（${selectedParentCategory.name}のみ）`}
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
              <label htmlFor="price">価格（円）</label>
              <input
                id="price"
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={item.price}
                onChange={(e) => {
                  if (/^\d*$/.test(e.target.value)) {
                    updateItem(id!, { price: Number(e.target.value) || 0 });
                  }
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="inventoryCount">在庫数</label>
              <input
                id="inventoryCount"
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={item.inventoryCount}
                onChange={(e) => {
                  if (/^\d{0,6}$/.test(e.target.value)) {
                    updateItem(id!, { inventoryCount: Number(e.target.value) || 0 });
                  }
                }}
              />
              <p className="hint">Squareの店舗在庫へ反映されます。</p>
            </div>
          </section>

          <section className="basic-section">
            <h2>アプリ管理項目（Squareには反映されません）</h2>
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
              <label htmlFor="size">表記サイズ</label>
              <select
                id="size"
                className="select"
                value={sizeSelectValue}
                onChange={(e) => {
                  const isCustom = e.target.value === CUSTOM_SIZE_VALUE;
                  setCustomSizeSelected(isCustom);
                  updateItem(id!, {
                    size: isCustom ? null : e.target.value || null,
                  });
                }}
              >
                <option value="">未設定</option>
                {STANDARD_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
                <option value={CUSTOM_SIZE_VALUE}>その他（自由入力）</option>
              </select>
              {sizeSelectValue === CUSTOM_SIZE_VALUE && (
                <input
                  className="input custom-size-input"
                  aria-label="その他の表記サイズ"
                  placeholder="例：38、W32、Kids 150"
                  value={item.size ?? ""}
                  onChange={(e) => updateItem(id!, { size: e.target.value || null })}
                />
              )}
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
          </section>
        </div>
      )}

      {tab === "desc" && (
        <div className="content">
          <div className="description-heading">
            <h2>自動で作成（Squareへの登録・更新時に反映されます）</h2>
            <button
              type="button"
              className="btn description-copy-btn"
              onClick={handleCopyDescription}
            >
              {descriptionCopyState === "copied" ? "コピーしました" : "本文をコピー"}
            </button>
          </div>
          <div className="description-preview" id="generated-description">
            {buildDescription(item)}
          </div>
          {descriptionCopyState === "error" && (
            <p className="form-error" role="status">
              {codedUserMessage("COPY")}
            </p>
          )}
        </div>
      )}

      <div className="footer-bar item-detail-footer">
        <button
          type="button"
          className="btn btn-primary item-detail-footer-button"
          onClick={handleSaveDraft}
          disabled={saving || refreshingSquare || mgmtNoConflict || !hasUnsavedChanges}
        >
          {savingAction === "draft" ? "保存中…" : "下書き保存"}
        </button>
        <button
          type="button"
          className="btn item-detail-footer-button"
          onClick={handleSaveToSquare}
          disabled={saving || refreshingSquare || mgmtNoConflict || !hasPendingSquareChanges}
        >
          {savingAction === "square" ? "反映中…" : item.squareObjectId ? "Squareを更新" : "Squareに登録"}
        </button>
      </div>
      {saveError && <p className="form-error" style={{ margin: "0 16px 12px" }}>{saveError}</p>}
      {navigationNotice && <p className="form-error" style={{ margin: "0 16px 12px" }}>{navigationNotice}</p>}
      {toast && <p className="toast">{toast}</p>}
      {photoDeleteCandidateId && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="photo-delete-title">
            <h2 className="dialog-title" id="photo-delete-title">この写真を削除予定にしますか？</h2>
            <p className="dialog-message">
              保存するまではSquare・Square Connectのどちらからも削除されません。
            </p>
            <p className="dialog-note">
              削除予定にした後も「元に戻す」で取り消せます。
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setPhotoDeleteCandidateId(null)}>
                キャンセル
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmPhotoDeletion}>
                削除予定にする
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
