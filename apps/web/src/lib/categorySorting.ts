type Category = {
  id: string;
  name: string;
  parentName: string | null;
};

type CategorizedItem = {
  category: string | null;
};

type Season = "spring" | "summer" | "autumn" | "winter";

const SEASONAL_KEYWORDS: Record<Season, { preferred: string[]; outOfSeason: string[] }> = {
  spring: {
    preferred: ["カーディガン", "シャツ", "スウェット", "パーカー", "薄手", "ライトアウター"],
    outOfSeason: ["ダウン", "水着", "サンダル", "マフラー", "手袋"],
  },
  summer: {
    preferred: [
      "Tシャツ",
      "半袖",
      "タンクトップ",
      "ノースリーブ",
      "ショートパンツ",
      "ショーツ",
      "ハーフパンツ",
      "水着",
      "サンダル",
      "アロハ",
    ],
    outOfSeason: ["ダウン", "コート", "ニット", "セーター", "フリース", "マフラー", "手袋"],
  },
  autumn: {
    preferred: ["カーディガン", "シャツ", "スウェット", "パーカー", "ニット", "ライトアウター"],
    outOfSeason: ["ダウン", "水着", "サンダル"],
  },
  winter: {
    preferred: ["ダウン", "コート", "ニット", "セーター", "フリース", "マフラー", "手袋"],
    outOfSeason: ["タンクトップ", "ノースリーブ", "ショートパンツ", "水着", "サンダル", "アロハ"],
  },
};

function seasonForMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function seasonalRank(category: Category, season: Season): number {
  const label = category.parentName ? `${category.parentName} ${category.name}` : category.name;
  const keywords = SEASONAL_KEYWORDS[season];
  if (keywords.outOfSeason.some((keyword) => label.includes(keyword))) return -1;
  if (keywords.preferred.some((keyword) => label.includes(keyword))) return 1;
  return 0;
}

/**
 * 新規登録で選びやすい順にカテゴリを並べる。
 * 現在の季節との相性、過去の利用回数を優先し、同順位はカテゴリ名の名前順にする。
 */
export function sortCategoriesForRegistration(
  categories: Category[],
  items: CategorizedItem[],
  now: Date = new Date(),
): Category[] {
  const usageCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.category) continue;
    usageCounts.set(item.category, (usageCounts.get(item.category) ?? 0) + 1);
  }

  const season = seasonForMonth(now.getMonth() + 1);
  return [...categories].sort((a, b) => {
    const seasonalDifference = seasonalRank(b, season) - seasonalRank(a, season);
    if (seasonalDifference !== 0) return seasonalDifference;

    const usageDifference = (usageCounts.get(b.name) ?? 0) - (usageCounts.get(a.name) ?? 0);
    if (usageDifference !== 0) return usageDifference;

    const nameDifference = a.name.localeCompare(b.name, "ja");
    if (nameDifference !== 0) return nameDifference;

    return (a.parentName ?? "").localeCompare(b.parentName ?? "", "ja");
  });
}

/**
 * 大カテゴリは、配下にある中カテゴリ全体の季節評価と利用回数を集約して並べる。
 */
export function sortParentCategoriesForRegistration(
  categories: Category[],
  items: CategorizedItem[],
  now: Date = new Date(),
): Category[] {
  const parents = categories.filter((category) => category.parentName === null);
  const usageCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.category) continue;
    usageCounts.set(item.category, (usageCounts.get(item.category) ?? 0) + 1);
  }

  const season = seasonForMonth(now.getMonth() + 1);
  const groupFor = (parent: Category) => [
    parent,
    ...categories.filter((category) => category.parentName === parent.name),
  ];

  return [...parents].sort((a, b) => {
    const aGroup = groupFor(a);
    const bGroup = groupFor(b);
    const aSeasonalRank = Math.max(...aGroup.map((category) => seasonalRank(category, season)));
    const bSeasonalRank = Math.max(...bGroup.map((category) => seasonalRank(category, season)));
    if (aSeasonalRank !== bSeasonalRank) return bSeasonalRank - aSeasonalRank;

    const aUsage = [...new Set(aGroup.map((category) => category.name))]
      .reduce((total, name) => total + (usageCounts.get(name) ?? 0), 0);
    const bUsage = [...new Set(bGroup.map((category) => category.name))]
      .reduce((total, name) => total + (usageCounts.get(name) ?? 0), 0);
    if (aUsage !== bUsage) return bUsage - aUsage;

    return a.name.localeCompare(b.name, "ja");
  });
}
