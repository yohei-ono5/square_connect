import { describe, expect, it } from "vitest";
import { buildDescription } from "@square-connect/shared";

describe("buildDescription", () => {
  it("starts with the product name and does not include the SKU", () => {
    const item = {
      title: "STUSSY Tシャツ",
      mgmtNo: "01269",
      size: "L",
      condition: "B" as const,
      measurements: null,
    };
    const description = buildDescription(item);

    expect(description.split("\n")[0]).toBe("STUSSY Tシャツ");
    expect(description).not.toContain("01269");
  });
});
