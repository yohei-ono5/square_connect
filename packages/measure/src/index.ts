import type { MeasurementResult } from "@clothes-check/shared";

export type MeasureGarmentInput = {
  imageDataUrl: string;
  garmentType: "tshirt";
  matProfileId: string;
};

// 以下は未実装のスタブ。ロジックは ../../../mvp_prototype.html から移植する（ファイル自体は改修せず参照のみ）。

// mvp_prototype.html の AR.Dictionary / AR.Detector を移植する
export function detectMarkers(_imageDataUrl: string): unknown {
  throw new Error("not implemented — port AR.Dictionary / AR.Detector from mvp_prototype.html");
}

// mvp_prototype.html の solveHomography / applyH を移植する
export function solveHomography(_src: unknown, _dst: unknown): unknown {
  throw new Error("not implemented — port solveHomography / applyH from mvp_prototype.html");
}

// mvp_prototype.html の autoLandmarks / placeLandmarks / computeMeas を移植する
export function measureGarment(_input: MeasureGarmentInput): MeasurementResult {
  throw new Error(
    "not implemented — port autoLandmarks / placeLandmarks / computeMeas from mvp_prototype.html",
  );
}
