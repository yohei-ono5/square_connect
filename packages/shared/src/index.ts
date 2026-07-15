import { z } from "zod";

export const ConditionSchema = z.enum(["S", "A", "B", "C", "D"]).nullable();
export type Condition = z.infer<typeof ConditionSchema>;

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
  brand: z.string().nullable(),
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

export type MeasurementResult = {
  lengthCm: number;
  chestWidthCm: number;
  shoulderWidthCm: number;
  sleeveLengthCm: number;
  confidence: number;
};
