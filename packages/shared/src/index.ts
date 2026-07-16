import { z } from "zod";

export const ConditionSchema = z.enum(["S", "A", "B", "C", "D"]).nullable();
export type Condition = z.infer<typeof ConditionSchema>;

// S〜Dの表示順。説明文の凡例やコンディション選択肢の並びに使う。
export const CONDITION_ORDER = ["S", "A", "B", "C", "D"] as const;

export const GenderSchema = z.enum(["mens", "womens", "unisex"]).nullable();
export type Gender = z.infer<typeof GenderSchema>;

export const GENDER_LABELS: Record<NonNullable<Gender>, string> = {
  mens: "メンズ",
  womens: "レディース",
  unisex: "ユニセックス",
};

export const ItemStatusSchema = z.enum(["draft", "confirmed", "pushed"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

// 必須は mgmtNo / title / price のみ。それ以外は登録後に後から埋められる任意項目。
export const ItemSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  status: ItemStatusSchema,
  mgmtNo: z.string(),
  title: z.string(),
  price: z.number().int().nonnegative(),
  gender: GenderSchema,
  category: z.string().nullable(),
  size: z.string().nullable(),
  condition: ConditionSchema,
  measurements: z
    .object({
      shoulderCm: z.number().nullable(),
      chestCm: z.number().nullable(),
      lengthCm: z.number().nullable(),
      sleeveCm: z.number().nullable(),
    })
    .nullable(),
  description: z.string().nullable(),
  squareObjectId: z.string().nullable(),
});
export type Item = z.infer<typeof ItemSchema>;

// クイック登録画面で送るのはこの3項目のみ
export const QuickRegisterInputSchema = z.object({
  title: z.string().min(1),
  price: z.number().int().nonnegative(),
});
export type QuickRegisterInput = z.infer<typeof QuickRegisterInputSchema>;

// SKU採番と下書き保存を終えた後、WorkerからSquareへ登録する際の入力。
export const RegisterToSquareInputSchema = z
  .object({
    mgmtNo: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(512),
    price: z.number().int().nonnegative().safe(),
  })
  .refine(({ title, mgmtNo }) => `${title} ${mgmtNo}`.length <= 512, {
    message: "Squareの商品名はSKUを含めて512文字以内にしてください",
    path: ["title"],
  });
export type RegisterToSquareInput = z.infer<typeof RegisterToSquareInputSchema>;

export type RegisterToSquareResult = {
  squareObjectId: string;
  squareVariationId: string;
};

export type MeasurementResult = {
  lengthCm: number;
  chestWidthCm: number;
  shoulderWidthCm: number;
  sleeveLengthCm: number;
  confidence: number;
};

export const CONDITION_LABELS: Record<NonNullable<Condition>, string> = {
  S: "新品未使用",
  A: "美品・数回使用・ほとんど使用感がない",
  B: "良品・多少の使用感がある",
  C: "通常使用に伴う使用感がある",
  D: "全体的に使用感がある・傷汚れがある",
};

// Square側の商品説明・アプリの説明文プレビュー両方から使う。未設定の項目は行ごと省略する。
export function buildTitle(item: Pick<Item, "title" | "mgmtNo">): string {
  return `${item.title} ${item.mgmtNo}`;
}

export function buildDescription(
  item: Pick<Item, "title" | "mgmtNo" | "size" | "condition" | "measurements">,
): string {
  const lines: string[] = [buildTitle(item), ""];

  const m = item.measurements;
  const hasAnyMeasurement = m != null && Object.values(m).some((v) => v != null);
  if (item.size != null || hasAnyMeasurement) {
    lines.push("▪️商品サイズ（平置き実寸−cm−）");
    if (item.size != null) lines.push(`SIZE：${item.size}`);
    if (m?.shoulderCm != null) lines.push(`肩幅：${m.shoulderCm}cm`);
    if (m?.chestCm != null) lines.push(`身幅：${m.chestCm}cm`);
    if (m?.lengthCm != null) lines.push(`着丈：${m.lengthCm}cm`);
    if (m?.sleeveCm != null) lines.push(`袖丈：${m.sleeveCm}cm`);
    if (hasAnyMeasurement) lines.push("※多少の誤差はご了承ください");
    lines.push("");
  }

  // ECサイトの説明文だけを見た人にも各ランクの意味が伝わるよう、選ばれたランクだけでなくS〜D全ての凡例を載せる。
  lines.push(`■コンディション：${item.condition ?? "未設定（後日追記）"}`);
  for (const rank of CONDITION_ORDER) {
    lines.push(`${rank}：${CONDITION_LABELS[rank]}`);
  }

  return lines.join("\n");
}
