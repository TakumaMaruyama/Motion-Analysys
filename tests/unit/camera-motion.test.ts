import { describe, expect, it } from "vitest";

import {
  estimateCameraTranslation,
  type CameraMotionThumbnail,
} from "@/lib/video/camera-motion";

function texturedThumbnail(
  width = 48,
  height = 28,
): CameraMotionThumbnail {
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      luma[y * width + x] =
        (x * 37 + y * 61 + ((x * y) % 17) * 11) % 256;
    }
  }
  return { width, height, luma };
}

function shifted(
  source: CameraMotionThumbnail,
  shiftX: number,
  shiftY: number,
): CameraMotionThumbnail {
  const luma = new Uint8Array(source.luma.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = x + shiftX;
      const targetY = y + shiftY;
      if (
        targetX >= 0 &&
        targetX < source.width &&
        targetY >= 0 &&
        targetY < source.height
      ) {
        luma[targetY * source.width + targetX] =
          source.luma[y * source.width + x];
      }
    }
  }
  return { width: source.width, height: source.height, luma };
}

describe("camera translation estimation", () => {
  it("detects coherent whole-frame translation", () => {
    const baseline = texturedThumbnail();
    const estimate = estimateCameraTranslation(
      baseline,
      shifted(baseline, 3, -2),
    );

    expect(estimate.assessed).toBe(true);
    expect(estimate.shiftX).toBe(3);
    expect(estimate.shiftY).toBe(-2);
    expect(estimate.improvement).toBeGreaterThan(0.22);
  });

  it("does not classify local swimmer-like motion as camera translation", () => {
    const baseline = texturedThumbnail();
    const luma = new Uint8Array(baseline.luma);
    for (let y = 10; y < 17; y += 1) {
      for (let x = 18; x < 30; x += 1) {
        luma[y * baseline.width + x] =
          255 - luma[y * baseline.width + x];
      }
    }
    const estimate = estimateCameraTranslation(baseline, {
      ...baseline,
      luma,
    });

    expect(estimate.assessed).toBe(true);
    expect([estimate.shiftX, estimate.shiftY]).toEqual([0, 0]);
  });

  it("leaves textureless water-or-wall frames inconclusive", () => {
    const luma = new Uint8Array(48 * 28).fill(32);
    const estimate = estimateCameraTranslation(
      { width: 48, height: 28, luma },
      { width: 48, height: 28, luma: new Uint8Array(luma) },
    );

    expect(estimate).toEqual({
      assessed: false,
      shiftX: 0,
      shiftY: 0,
      improvement: 0,
    });
  });
});
