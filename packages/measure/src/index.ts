export type MeasurePointKey = "shoulderL" | "shoulderR" | "pitL" | "pitR" | "collar" | "hem" | "cuffL";
export type MeasurePoint = { x: number; y: number };
export type MeasurePoints = Record<MeasurePointKey, MeasurePoint>;

// 座標・寸法はすべて画像の幅・高さに対する 0-100 のパーセンテージで表す。
export type Bounds = { left: number; top: number; width: number; height: number };

// mvp_prototype.html の実測値と、そのとき採寸点が置かれていた領域（下記 REFERENCE_BOUNDS）。
// マーカー付きマットを使わない現行フローでは実寸換算の基準がないため、この基準点からの
// 相対的な比率をそのまま使う（≒プロポーションは正しいが絶対値は目安）。
export const BASELINE_MEASUREMENT_CM = { shoulderCm: 44.9, chestCm: 51.0, lengthCm: 67.4, sleeveCm: 17.1 };

export const DEFAULT_MEASURE_POINTS: MeasurePoints = {
  shoulderL: { x: 34, y: 30 },
  shoulderR: { x: 66, y: 30 },
  pitL: { x: 28, y: 46 },
  pitR: { x: 72, y: 46 },
  collar: { x: 50, y: 24 },
  hem: { x: 50, y: 82 },
  cuffL: { x: 18, y: 49 },
};

// DEFAULT_MEASURE_POINTS が前提としている「Tシャツが占める領域」。各点はこの範囲内の
// 相対位置として定義されているとみなし、実際に検出した領域へ比例配置し直す。
export const REFERENCE_BOUNDS: Bounds = { left: 18, top: 24, width: 54, height: 58 };

function pointDistance(points: MeasurePoints, from: MeasurePointKey, to: MeasurePointKey): number {
  const a = points[from];
  const b = points[to];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// apps/web 側の Item.measurements（shoulderCm/chestCm/lengthCm/sleeveCm）とキー名を揃えてある。
export function calculateMeasurements(points: MeasurePoints): {
  shoulderCm: number;
  chestCm: number;
  lengthCm: number;
  sleeveCm: number;
} {
  const ratio = (from: MeasurePointKey, to: MeasurePointKey, baseline: number) =>
    Number(
      ((pointDistance(points, from, to) / pointDistance(DEFAULT_MEASURE_POINTS, from, to)) * baseline).toFixed(1),
    );
  return {
    shoulderCm: ratio("shoulderL", "shoulderR", BASELINE_MEASUREMENT_CM.shoulderCm),
    chestCm: ratio("pitL", "pitR", BASELINE_MEASUREMENT_CM.chestCm),
    lengthCm: ratio("collar", "hem", BASELINE_MEASUREMENT_CM.lengthCm),
    sleeveCm: ratio("shoulderL", "cuffL", BASELINE_MEASUREMENT_CM.sleeveCm),
  };
}

function remapPoint(p: MeasurePoint, from: Bounds, to: Bounds): MeasurePoint {
  return {
    x: to.left + ((p.x - from.left) / from.width) * to.width,
    y: to.top + ((p.y - from.top) / from.height) * to.height,
  };
}

// REFERENCE_BOUNDS を前提に定義された DEFAULT_MEASURE_POINTS を、実際に検出した領域(bounds)へ
// 比例配置し直す。マーカーによる遠近補正は行わないため、写真がほぼ真上から撮られている前提。
export function placeLandmarksFromBounds(bounds: Bounds): MeasurePoints {
  const out = {} as MeasurePoints;
  (Object.keys(DEFAULT_MEASURE_POINTS) as MeasurePointKey[]).forEach((key) => {
    out[key] = remapPoint(DEFAULT_MEASURE_POINTS[key], REFERENCE_BOUNDS, bounds);
  });
  return out;
}

const BACKGROUND_SAMPLE_MARGIN = 0.04;
const COLOR_DISTANCE_THRESHOLD = 45;
const ROW_COL_NOISE_RATIO = 0.05;
const MIN_SIZE_RATIO = 0.1;
const MAX_SIZE_RATIO = 0.98;

/**
 * 背景差分による簡易シルエット検出。撮影ガイド通り「無地の背景の上に置いた服」を前提に、
 * 画像の外周を背景色サンプルとして扱い、そこから色距離が離れた画素を前景（服）とみなして
 * 外接矩形を求める。マーカーもポーズ推定も使わない目安の検出であり、背景が服と近い色・
 * 柄がある・服が縁まではみ出す、といった場合は検出できず null を返す（呼び出し側は
 * DEFAULT_MEASURE_POINTS にフォールバックする）。
 */
export function computeForegroundBounds(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
): Bounds | null {
  if (width < 4 || height < 4) return null;

  const marginX = Math.max(1, Math.round(width * BACKGROUND_SAMPLE_MARGIN));
  const marginY = Math.max(1, Math.round(height * BACKGROUND_SAMPLE_MARGIN));

  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgCount = 0;
  for (let y = 0; y < height; y++) {
    const onBorderRow = y < marginY || y >= height - marginY;
    for (let x = 0; x < width; x++) {
      if (!onBorderRow && x >= marginX && x < width - marginX) continue;
      const i = (y * width + x) * 4;
      bgR += pixels[i];
      bgG += pixels[i + 1];
      bgB += pixels[i + 2];
      bgCount++;
    }
  }
  if (bgCount === 0) return null;
  bgR /= bgCount;
  bgG /= bgCount;
  bgB /= bgCount;

  const colCounts = new Array<number>(width).fill(0);
  const rowCounts = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dr = pixels[i] - bgR;
      const dg = pixels[i + 1] - bgG;
      const db = pixels[i + 2] - bgB;
      if (Math.sqrt(dr * dr + dg * dg + db * db) > COLOR_DISTANCE_THRESHOLD) {
        colCounts[x]++;
        rowCounts[y]++;
      }
    }
  }

  const colMax = Math.max(...colCounts);
  const rowMax = Math.max(...rowCounts);
  if (colMax === 0 || rowMax === 0) return null;

  const colThreshold = colMax * ROW_COL_NOISE_RATIO;
  const rowThreshold = rowMax * ROW_COL_NOISE_RATIO;

  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x++) {
    if (colCounts[x] > colThreshold) {
      if (left === -1) left = x;
      right = x;
    }
  }
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > rowThreshold) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (left === -1 || top === -1) return null;

  const boundsWidth = right - left;
  const boundsHeight = bottom - top;
  if (boundsWidth < width * MIN_SIZE_RATIO || boundsHeight < height * MIN_SIZE_RATIO) return null;
  if (boundsWidth > width * MAX_SIZE_RATIO && boundsHeight > height * MAX_SIZE_RATIO) return null;

  return {
    left: (left / width) * 100,
    top: (top / height) * 100,
    width: (boundsWidth / width) * 100,
    height: (boundsHeight / height) * 100,
  };
}

const MAX_ANALYSIS_DIMENSION = 240;

async function loadImagePixels(
  imageUrl: string,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_ANALYSIS_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        const data = ctx.getImageData(0, 0, width, height);
        resolve({ pixels: data.data, width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

export async function detectGarmentBounds(imageUrl: string): Promise<Bounds | null> {
  const loaded = await loadImagePixels(imageUrl);
  if (!loaded) return null;
  return computeForegroundBounds(loaded.pixels, loaded.width, loaded.height);
}

export async function detectInitialMeasurePoints(
  imageUrl: string,
): Promise<{ points: MeasurePoints; bounds: Bounds | null; detected: boolean }> {
  let bounds: Bounds | null = null;
  try {
    bounds = await detectGarmentBounds(imageUrl);
  } catch {
    bounds = null;
  }
  return {
    points: bounds ? placeLandmarksFromBounds(bounds) : DEFAULT_MEASURE_POINTS,
    bounds,
    detected: bounds !== null,
  };
}
