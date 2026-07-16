import { describe, expect, it } from "vitest";
import { computeForegroundBounds, placeLandmarksFromBounds, REFERENCE_BOUNDS, DEFAULT_MEASURE_POINTS } from "./index";

function makeImage(
  width: number,
  height: number,
  bg: [number, number, number],
  rect: { left: number; top: number; right: number; bottom: number; color: [number, number, number] },
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inRect = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      const [r, g, b] = inRect ? rect.color : bg;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

describe("computeForegroundBounds", () => {
  it("finds the bounding box of a contrasting rectangle against a uniform background", () => {
    const width = 100;
    const height = 100;
    const pixels = makeImage(width, height, [230, 230, 230], {
      left: 20,
      top: 30,
      right: 79,
      bottom: 89,
      color: [20, 20, 20],
    });

    const bounds = computeForegroundBounds(pixels, width, height);

    expect(bounds).not.toBeNull();
    expect(bounds!.left).toBeCloseTo(20, 0);
    expect(bounds!.top).toBeCloseTo(30, 0);
    expect(bounds!.width).toBeCloseTo(59, 0);
    expect(bounds!.height).toBeCloseTo(59, 0);
  });

  it("returns null when the image is a uniform color (no contrasting subject)", () => {
    const width = 60;
    const height = 60;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200;
      pixels[i + 1] = 200;
      pixels[i + 2] = 200;
      pixels[i + 3] = 255;
    }

    expect(computeForegroundBounds(pixels, width, height)).toBeNull();
  });

  it("returns null when the detected region is too small to be a real subject", () => {
    const width = 100;
    const height = 100;
    // 3x3 speck — well under the 10% minimum size ratio in both dimensions
    const pixels = makeImage(width, height, [230, 230, 230], {
      left: 50,
      top: 50,
      right: 52,
      bottom: 52,
      color: [10, 10, 10],
    });

    expect(computeForegroundBounds(pixels, width, height)).toBeNull();
  });
});

describe("placeLandmarksFromBounds", () => {
  it("returns the defaults unchanged when given REFERENCE_BOUNDS itself", () => {
    const points = placeLandmarksFromBounds(REFERENCE_BOUNDS);
    (Object.keys(DEFAULT_MEASURE_POINTS) as (keyof typeof DEFAULT_MEASURE_POINTS)[]).forEach((key) => {
      expect(points[key].x).toBeCloseTo(DEFAULT_MEASURE_POINTS[key].x, 5);
      expect(points[key].y).toBeCloseTo(DEFAULT_MEASURE_POINTS[key].y, 5);
    });
  });

  it("shifts and scales points proportionally into a different bounds", () => {
    const bounds = { left: 0, top: 0, width: 100, height: 100 };
    const points = placeLandmarksFromBounds(bounds);

    // collar's relative position within REFERENCE_BOUNDS should carry over unchanged
    const expectedCollarX = ((DEFAULT_MEASURE_POINTS.collar.x - REFERENCE_BOUNDS.left) / REFERENCE_BOUNDS.width) * 100;
    expect(points.collar.x).toBeCloseTo(expectedCollarX, 5);
    // collar (near the neckline) should still sit above the hem after remapping
    expect(points.collar.y).toBeLessThan(points.hem.y);
    // all points should now fall within the (0,0)-(100,100) bounds
    Object.values(points).forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    });
  });
});
