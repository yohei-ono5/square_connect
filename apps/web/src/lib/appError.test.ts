import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppError,
  codedUserMessage,
  toUserErrorMessage,
} from "./appError";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appError", () => {
  it("shows a stable code with a known user-facing error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(toUserErrorMessage(
      new AppError("ITEM_SKU_DUPLICATE", new Error("duplicate key")),
      "ITEM_SAVE",
    )).toBe("商品番号（SKU）が重複しています。\nエラーコード：ERR-ITEM-001");
  });

  it("maps browser network failures to the shared network error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(toUserErrorMessage(new TypeError("Failed to fetch"), "ITEM_LOAD"))
      .toContain("ERR-NET-001");
  });

  it("formats validation messages without logging", () => {
    expect(codedUserMessage("ITEM_SKU_DUPLICATE"))
      .toContain("ERR-ITEM-001");
  });
});
