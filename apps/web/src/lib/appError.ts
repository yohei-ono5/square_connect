export const ERROR_DEFINITIONS = {
  CONFIG: {
    code: "ERR-CONFIG-001",
    message: "システム設定に問題があります。管理者へご連絡ください。",
  },
  NETWORK: {
    code: "ERR-NET-001",
    message: "通信に失敗しました。接続を確認して、もう一度お試しください。",
  },
  DATA_STORE: {
    code: "ERR-DATA-001",
    message: "店舗情報を取得できませんでした。時間をおいてもう一度お試しください。",
  },
  ITEM_SKU_DUPLICATE: {
    code: "ERR-ITEM-001",
    message: "商品番号（SKU）が重複しています。",
  },
  ITEM_LOAD: {
    code: "ERR-ITEM-002",
    message: "商品一覧を読み込めませんでした。画面を再読み込みしてください。",
  },
  ITEM_SAVE: {
    code: "ERR-ITEM-003",
    message: "商品を保存できませんでした。入力内容を確認して、もう一度お試しください。",
  },
  ITEM_ARCHIVE: {
    code: "ERR-ITEM-004",
    message: "商品をアーカイブできませんでした。もう一度お試しください。",
  },
  ITEM_NOT_FOUND: {
    code: "ERR-ITEM-005",
    message: "商品が見つかりません。商品一覧を再読み込みしてください。",
  },
  PHOTO_LOAD: {
    code: "ERR-PHOTO-001",
    message: "写真を読み込めませんでした。画面を再読み込みしてください。",
  },
  PHOTO_SAVE: {
    code: "ERR-PHOTO-002",
    message: "写真を保存できませんでした。もう一度お試しください。",
  },
  PHOTO_DELETE: {
    code: "ERR-PHOTO-003",
    message: "写真を削除できませんでした。もう一度お試しください。",
  },
  PHOTO_SYNC: {
    code: "ERR-PHOTO-004",
    message: "写真をSquareへ反映できませんでした。もう一度お試しください。",
  },
  SQUARE_REGISTER: {
    code: "ERR-SQUARE-001",
    message: "Squareへ商品を登録できませんでした。もう一度お試しください。",
  },
  SQUARE_UPDATE: {
    code: "ERR-SQUARE-002",
    message: "Squareの商品を更新できませんでした。もう一度お試しください。",
  },
  SQUARE_ITEM_REFRESH: {
    code: "ERR-SQUARE-003",
    message: "Squareの最新情報を取得できませんでした。もう一度お試しください。",
  },
  SQUARE_LIST_REFRESH: {
    code: "ERR-SQUARE-004",
    message: "Squareの商品一覧を更新できませんでした。もう一度お試しください。",
  },
  SQUARE_CATEGORIES: {
    code: "ERR-SQUARE-005",
    message: "Squareのカテゴリを取得できませんでした。もう一度お試しください。",
  },
  SQUARE_RESULT_SAVE: {
    code: "ERR-SQUARE-006",
    message: "Squareの連携結果を保存できませんでした。商品一覧を確認してください。",
  },
  COPY: {
    code: "ERR-COPY-001",
    message: "本文をコピーできませんでした。本文を長押ししてコピーしてください。",
  },
} as const;

export type AppErrorKey = keyof typeof ERROR_DEFINITIONS;

export class AppError extends Error {
  readonly code: string;
  readonly originalError: unknown;

  constructor(
    readonly key: AppErrorKey,
    originalError?: unknown,
    message?: string,
  ) {
    const definition = ERROR_DEFINITIONS[key];
    super(message ?? definition.message);
    this.name = "AppError";
    this.code = definition.code;
    this.originalError = originalError;
  }
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "Failed to fetch" ||
    error.message.includes("NetworkError") ||
    error.message.includes("Load failed")
  );
}

export function codedUserMessage(key: AppErrorKey): string {
  const definition = ERROR_DEFINITIONS[key];
  return `${definition.message}\nエラーコード：${definition.code}`;
}

export function toUserErrorMessage(error: unknown, fallbackKey: AppErrorKey): string {
  const appError = error instanceof AppError
    ? error
    : new AppError(isNetworkError(error) ? "NETWORK" : fallbackKey, error);

  console.error(`[${appError.code}] ${appError.message}`, appError.originalError ?? error);
  return `${appError.message}\nエラーコード：${appError.code}`;
}
