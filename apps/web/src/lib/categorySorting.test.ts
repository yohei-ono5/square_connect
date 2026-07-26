import { describe, expect, it } from "vitest";
import {
  sortCategoriesForRegistration,
  sortParentCategoriesForRegistration,
} from "./categorySorting";

const categories = [
  { id: "down", name: "ダウン", parentName: "アウター" },
  { id: "shirt", name: "シャツ", parentName: "トップス" },
  { id: "tee", name: "Tシャツ", parentName: "トップス" },
  { id: "shorts", name: "ショートパンツ", parentName: "ボトムス" },
];

describe("sortCategoriesForRegistration", () => {
  it("夏向けを上位、季節外のダウンを下位にする", () => {
    const sorted = sortCategoriesForRegistration(
      categories,
      [{ category: "ダウン" }, { category: "ダウン" }, { category: "ダウン" }],
      new Date("2026-07-26T00:00:00+09:00"),
    );

    expect(sorted.map((category) => category.name)).toEqual([
      "Tシャツ",
      "ショートパンツ",
      "シャツ",
      "ダウン",
    ]);
  });

  it("季節評価が同じなら利用回数が多いものを上位にする", () => {
    const sorted = sortCategoriesForRegistration(
      [
        { id: "accessory", name: "アクセサリー", parentName: null },
        { id: "blouse", name: "ブラウス", parentName: null },
      ],
      [{ category: "ブラウス" }, { category: "ブラウス" }],
      new Date("2026-07-26T00:00:00+09:00"),
    );

    expect(sorted.map((category) => category.name)).toEqual(["ブラウス", "アクセサリー"]);
  });

  it("季節評価と利用回数が同じなら表示名の名前順にする", () => {
    const sorted = sortCategoriesForRegistration(
      [
        { id: "b", name: "ブラウス", parentName: null },
        { id: "a", name: "アクセサリー", parentName: null },
      ],
      [],
      new Date("2026-07-26T00:00:00+09:00"),
    );

    expect(sorted.map((category) => category.name)).toEqual(["アクセサリー", "ブラウス"]);
  });
});

describe("sortParentCategoriesForRegistration", () => {
  it("配下の中カテゴリを基に大カテゴリの季節評価と利用回数を集約する", () => {
    const sorted = sortParentCategoriesForRegistration(
      [
        { id: "accessory", name: "accessory", parentName: null },
        { id: "pants", name: "pants", parentName: null },
        { id: "tops", name: "tops", parentName: null },
        { id: "tee", name: "Tシャツ", parentName: "tops" },
        { id: "shorts", name: "ショートパンツ", parentName: "pants" },
      ],
      [{ category: "ショートパンツ" }, { category: "ショートパンツ" }],
      new Date("2026-07-26T00:00:00+09:00"),
    );

    expect(sorted.map((category) => category.name)).toEqual(["pants", "tops", "accessory"]);
  });
});
